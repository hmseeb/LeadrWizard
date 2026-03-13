-- ============================================================
-- LeadrWizard: Billing, Subscriptions & Multi-Tenant Enhancements
-- ============================================================

-- ============================================================
-- Subscription Plans
-- ============================================================
create table public.subscription_plans (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  description text,
  price_cents integer not null,
  billing_interval text not null default 'monthly' check (
    billing_interval in ('monthly', 'yearly')
  ),
  max_clients integer, -- null = unlimited
  max_services integer, -- null = unlimited
  features jsonb not null default '[]'::jsonb,
  stripe_price_id text, -- Stripe Price ID for checkout
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Organization Subscriptions
-- ============================================================
create table public.org_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  stripe_subscription_id text,
  stripe_customer_id text,
  status text not null default 'active' check (
    status in ('active', 'past_due', 'cancelled', 'trialing')
  ),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index idx_org_subscriptions_active
  on public.org_subscriptions(org_id)
  where status in ('active', 'trialing', 'past_due');

-- ============================================================
-- Usage tracking (for metered billing / plan limits)
-- ============================================================
create table public.usage_records (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  metric text not null, -- 'clients', 'sms_sent', 'voice_minutes', 'ai_calls'
  quantity integer not null default 1,
  period_start date not null,
  period_end date not null,
  created_at timestamptz not null default now()
);

create index idx_usage_records_org_period
  on public.usage_records(org_id, period_start, metric);

-- ============================================================
-- Org invitations (for team members)
-- ============================================================
create table public.org_invitations (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  invited_by uuid not null references auth.users(id),
  token text unique not null,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create index idx_org_invitations_token on public.org_invitations(token)
  where accepted_at is null;

-- ============================================================
-- Add billing fields to organizations
-- ============================================================
alter table public.organizations
  add column if not exists stripe_customer_id text,
  add column if not exists plan_slug text default 'starter',
  add column if not exists onboarding_completed boolean not null default false;

-- ============================================================
-- RLS Policies
-- ============================================================

-- Subscription plans: anyone authenticated can view
alter table public.subscription_plans enable row level security;
create policy "Anyone can view active plans"
  on public.subscription_plans for select
  to authenticated
  using (is_active = true);

-- Org subscriptions: org members only
alter table public.org_subscriptions enable row level security;
create policy "Org members can view their subscription"
  on public.org_subscriptions for select
  to authenticated
  using (
    org_id in (
      select org_id from public.org_members
      where user_id = auth.uid()
    )
  );

-- Usage records: org members only
alter table public.usage_records enable row level security;
create policy "Org members can view usage"
  on public.usage_records for select
  to authenticated
  using (
    org_id in (
      select org_id from public.org_members
      where user_id = auth.uid()
    )
  );

-- Org invitations: org admins/owners only
alter table public.org_invitations enable row level security;
create policy "Org admins can manage invitations"
  on public.org_invitations for all
  to authenticated
  using (
    org_id in (
      select org_id from public.org_members
      where user_id = auth.uid()
        and role in ('owner', 'admin')
    )
  );

-- ============================================================
-- Seed subscription plans
-- ============================================================
insert into public.subscription_plans (name, slug, description, price_cents, billing_interval, max_clients, max_services, features) values
  ('Starter', 'starter', 'For solo operators getting started', 9900, 'monthly', 25, 4, '["sms", "voice", "email", "basic_analytics"]'::jsonb),
  ('Growth', 'growth', 'For growing businesses with more clients', 24900, 'monthly', 100, 10, '["sms", "voice", "email", "advanced_analytics", "custom_templates", "priority_support"]'::jsonb),
  ('Scale', 'scale', 'For agencies managing multiple brands', 49900, 'monthly', null, null, '["sms", "voice", "email", "advanced_analytics", "custom_templates", "priority_support", "api_access", "white_label"]'::jsonb);
