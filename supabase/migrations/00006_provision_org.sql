-- Migration: 00006_provision_org.sql
-- Purpose: Atomic org provisioning for self-service signup (SIGN-01)
--          Called from webhook handler via supabase.rpc('provision_org')
--          Follows the same pattern as provision_client (00005)

create or replace function public.provision_org(
  p_org_name       text,
  p_admin_email    text,
  p_plan_slug      text,
  p_stripe_sub_id  text,
  p_stripe_cust_id text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_org  public.organizations%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_slug text;
begin
  -- Idempotency: if org already exists for this Stripe customer, return it
  select * into v_org from public.organizations
  where stripe_customer_id = p_stripe_cust_id;

  if found then
    return jsonb_build_object('org_id', v_org.id, 'idempotent', true);
  end if;

  -- Validate plan exists and is active
  select * into v_plan from public.subscription_plans
  where slug = p_plan_slug and is_active = true;

  if not found then
    raise exception 'Invalid or inactive plan: %', p_plan_slug;
  end if;

  -- Generate URL-safe slug from org name
  v_slug := lower(regexp_replace(p_org_name, '[^a-z0-9]+', '-', 'gi'));
  v_slug := trim(both '-' from v_slug);

  -- Ensure slug is not empty after sanitization
  if v_slug = '' or v_slug is null then
    v_slug := 'org-' || substr(md5(random()::text), 1, 8);
  end if;

  -- Handle slug collision by appending random suffix
  if exists (select 1 from public.organizations where slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 6);
  end if;

  -- Create organization
  insert into public.organizations (name, slug, stripe_customer_id, plan_slug)
  values (p_org_name, v_slug, p_stripe_cust_id, p_plan_slug)
  returning * into v_org;

  -- Create subscription linked to the org
  insert into public.org_subscriptions (
    org_id, plan_id, stripe_subscription_id,
    stripe_customer_id, status,
    current_period_start, current_period_end
  ) values (
    v_org.id, v_plan.id, p_stripe_sub_id,
    p_stripe_cust_id, 'active',
    now(), now() + interval '30 days'
  );

  return jsonb_build_object('org_id', v_org.id, 'idempotent', false);
end;
$$;

comment on function public.provision_org is
  'Atomically provisions an organization and subscription in a single transaction. Called from the Stripe checkout.session.completed webhook handler via supabase.rpc(). Idempotent on stripe_customer_id.';
