-- Migration: 00005_rls_hardening.sql
-- Purpose: Drop exploitable anon RLS policies and add scoped replacements (SEC-03)
--          Add provision_client plpgsql function for atomic provisioning (ORG-03)

-- ============================================================
-- SEC-03: Remove exploitable anonymous RLS policies
-- These policies allow any anon client to insert/update without
-- any org or session validation — active exploit surface.
-- ============================================================

drop policy if exists "sessions_anon_insert" on public.onboarding_sessions;
drop policy if exists "sessions_anon_update" on public.onboarding_sessions;
drop policy if exists "responses_anon_insert" on public.session_responses;

-- Also scope the interaction_log anon insert policy (currently with check (true))
drop policy if exists "interactions_anon_insert" on public.interaction_log;

-- Add scoped replacement: responses can only be inserted for an active session
-- This validates session existence server-side but also adds DB-level protection
create policy "responses_valid_session_insert" on public.session_responses
  for insert with check (
    exists (
      select 1 from public.onboarding_sessions
      where id = session_id
        and status = 'active'
    )
  );

-- Add scoped replacement: interaction_log inserts must reference an existing session
create policy "interactions_valid_session_insert" on public.interaction_log
  for insert with check (
    exists (
      select 1 from public.onboarding_sessions
      where id = session_id
    )
  );

-- NOTE: The sessions_anon_insert and sessions_anon_update policies are dropped
-- and NOT replaced with anon equivalents. Session creation is now ONLY possible
-- via server-side API routes running as service role (bypasses RLS entirely).
-- The authenticated sessions_select policy is NOT touched.

-- ============================================================
-- ORG-03: Atomic client provisioning function
-- Replaces 7 sequential inserts in payment-handler.ts with a
-- single ACID transaction. Handles idempotency via payment_ref.
-- ============================================================

create or replace function public.provision_client(
  p_org_id         uuid,
  p_name           text,
  p_email          text,
  p_phone          text,
  p_business_name  text,
  p_payment_ref    text,
  p_package_id     uuid,
  p_metadata       jsonb
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_client         public.clients%rowtype;
  v_client_package public.client_packages%rowtype;
  v_session        public.onboarding_sessions%rowtype;
begin
  -- Idempotency: return existing if payment_ref already processed for this org
  select * into v_client
  from public.clients
  where payment_ref = p_payment_ref
    and org_id = p_org_id;

  if found then
    -- Return existing IDs so handler can continue with GHL, outreach, etc.
    return jsonb_build_object(
      'client_id',  v_client.id,
      'idempotent', true
    );
  end if;

  -- 1. Create client record
  insert into public.clients (org_id, name, email, phone, business_name, payment_ref, metadata)
  values (p_org_id, p_name, p_email, p_phone, p_business_name, p_payment_ref, p_metadata)
  returning * into v_client;

  -- 2. Create client_package
  insert into public.client_packages (client_id, package_id)
  values (v_client.id, p_package_id)
  returning * into v_client_package;

  -- 3. Create client_services for each service in the package
  insert into public.client_services (client_id, service_id, client_package_id, status, opted_out)
  select v_client.id, ps.service_id, v_client_package.id, 'pending_onboarding', false
  from public.package_services ps
  where ps.package_id = p_package_id;

  -- 4. Create onboarding session
  insert into public.onboarding_sessions (client_id, org_id, status, completion_pct)
  values (v_client.id, p_org_id, 'active', 0)
  returning * into v_session;

  return jsonb_build_object(
    'client_id',   v_client.id,
    'package_id',  v_client_package.id,
    'session_id',  v_session.id,
    'idempotent',  false
  );
end;
$$;

comment on function public.provision_client is
  'Atomically provisions a client, package assignment, services, and onboarding session in a single transaction. Called from payment-handler.ts via supabase.rpc(). Idempotent on payment_ref.';
