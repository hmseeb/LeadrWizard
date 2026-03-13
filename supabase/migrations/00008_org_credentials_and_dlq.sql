-- Migration: 00008_org_credentials_and_dlq.sql
-- Purpose: Add encrypted credential columns to organizations for per-org isolation (CRUD-05)
--          Create dead_letter_queue table for failed service tasks (ORG-04)
--          Add missing UPDATE RLS policy on organizations table

-- ============================================================
-- Encrypted credential columns on organizations
-- Values are AES-256-GCM encrypted strings in format: v1:iv:tag:ciphertext (all base64)
-- Non-secret config fields (phone number, location ID, assistant ID) stored as plain text
-- ============================================================
alter table public.organizations
  add column if not exists twilio_account_sid_encrypted text,
  add column if not exists twilio_auth_token_encrypted text,
  add column if not exists twilio_phone_number text,
  add column if not exists ghl_api_key_encrypted text,
  add column if not exists ghl_location_id text,
  add column if not exists ghl_company_id text,
  add column if not exists vapi_api_key_encrypted text,
  add column if not exists vapi_assistant_id text,
  add column if not exists elevenlabs_agent_id text;

-- ============================================================
-- UPDATE RLS policy on organizations
-- Missing from 00001 initial schema — only SELECT existed (org_members_read_org)
-- Owner/admin can update their organization settings and credentials
-- ============================================================
create policy "org_owners_update" on public.organizations
  for update using (
    id in (
      select org_id from public.org_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- ============================================================
-- Dead Letter Queue table
-- Stores service tasks and outreach items that failed 5+ times
-- Admin can view, retry, or dismiss entries
-- ============================================================
create table public.dead_letter_queue (
  id uuid primary key default uuid_generate_v4(),
  original_table text not null,
  original_id uuid not null,
  task_type text,
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  last_error text,
  attempt_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  retried_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_dlq_org on public.dead_letter_queue(org_id);
create index idx_dlq_active on public.dead_letter_queue(org_id)
  where retried_at is null and dismissed_at is null;

alter table public.dead_letter_queue enable row level security;

-- Any org member can view DLQ entries
create policy "dlq_select" on public.dead_letter_queue
  for select using (
    org_id in (
      select org_id from public.org_members where user_id = auth.uid()
    )
  );

-- Owner/admin can update DLQ entries (retry, dismiss)
create policy "dlq_update" on public.dead_letter_queue
  for update using (
    org_id in (
      select org_id from public.org_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );
