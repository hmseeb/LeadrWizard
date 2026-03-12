-- LeadrWizard Initial Schema
-- AI-powered autonomous onboarding agent platform

create extension if not exists "uuid-ossp";

-- ============================================================
-- ORGANIZATIONS (multi-tenant)
-- ============================================================
create table public.organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  logo_url text,
  settings jsonb not null default '{
    "outreach_cadence": {
      "steps": [
        {"delay_minutes": 60, "channel": "sms", "message_template": "reminder_1"},
        {"delay_minutes": 240, "channel": "sms", "message_template": "reminder_2"},
        {"delay_minutes": 1440, "channel": "voice_call", "message_template": "call_reminder_1"},
        {"delay_minutes": 2880, "channel": "email", "message_template": "email_reminder_1"},
        {"delay_minutes": 2880, "channel": "sms", "message_template": "reminder_3"},
        {"delay_minutes": 4320, "channel": "voice_call", "message_template": "call_reminder_2"},
        {"delay_minutes": 7200, "channel": "sms", "message_template": "urgent_reminder"},
        {"delay_minutes": 10080, "channel": "voice_call", "message_template": "final_call"}
      ]
    },
    "escalation_webhook_url": null,
    "escalation_channel": null
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- ORG MEMBERS
-- ============================================================
create table public.org_members (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique(org_id, user_id)
);

-- ============================================================
-- SERVICE DEFINITIONS
-- Each service you offer (website, GMB, A2P, chatbot, etc.)
-- required_data_fields defines what onboarding data is needed
-- ============================================================
create table public.service_definitions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  required_data_fields jsonb not null default '[]'::jsonb,
  setup_steps jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, slug)
);

-- ============================================================
-- SERVICE PACKAGES (bundles of services)
-- ============================================================
create table public.service_packages (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  price_cents integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.package_services (
  id uuid primary key default uuid_generate_v4(),
  package_id uuid not null references public.service_packages(id) on delete cascade,
  service_id uuid not null references public.service_definitions(id) on delete cascade,
  unique(package_id, service_id)
);

-- ============================================================
-- NICHE TEMPLATES (website template library by industry)
-- ============================================================
create table public.niche_templates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  niche_name text not null,
  description text,
  template_data jsonb not null default '{}'::jsonb,
  preview_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- CLIENTS (people being onboarded)
-- ============================================================
create table public.clients (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  business_name text,
  payment_ref text,
  ghl_sub_account_id text,
  ghl_contact_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_packages (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  package_id uuid not null references public.service_packages(id) on delete cascade,
  purchased_at timestamptz not null default now()
);

create table public.client_services (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  service_id uuid not null references public.service_definitions(id) on delete cascade,
  client_package_id uuid not null references public.client_packages(id) on delete cascade,
  status text not null default 'pending_onboarding' check (
    status in ('pending_onboarding', 'onboarding', 'ready_to_deliver', 'in_progress', 'delivered', 'paused')
  ),
  opted_out boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- ONBOARDING SESSIONS
-- ============================================================
create table public.onboarding_sessions (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'active' check (
    status in ('active', 'paused', 'completed', 'abandoned')
  ),
  current_channel text check (
    current_channel in ('sms', 'email', 'voice_call', 'widget', 'system')
  ),
  completion_pct integer not null default 0,
  last_interaction_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- SESSION RESPONSES (individual answers from any channel)
-- ============================================================
create table public.session_responses (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.onboarding_sessions(id) on delete cascade,
  client_service_id uuid references public.client_services(id) on delete set null,
  field_key text not null,
  field_value text not null,
  answered_via text not null default 'click' check (
    answered_via in ('click', 'voice', 'sms', 'voice_call')
  ),
  created_at timestamptz not null default now()
);

-- ============================================================
-- SERVICE TASKS (multi-step async operations: A2P, GMB, website, GHL)
-- ============================================================
create table public.service_tasks (
  id uuid primary key default uuid_generate_v4(),
  client_service_id uuid not null references public.client_services(id) on delete cascade,
  task_type text not null check (
    task_type in ('a2p_registration', 'gmb_access_request', 'website_generation', 'ghl_snapshot_deploy', 'ghl_sub_account_provision')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'in_progress', 'waiting_external', 'completed', 'failed')
  ),
  external_ref text,
  next_check_at timestamptz,
  attempt_count integer not null default 0,
  last_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- INTERACTION LOG (full audit trail across ALL channels)
-- ============================================================
create table public.interaction_log (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  session_id uuid references public.onboarding_sessions(id) on delete set null,
  channel text not null check (
    channel in ('sms', 'email', 'voice_call', 'widget', 'system')
  ),
  direction text not null check (direction in ('inbound', 'outbound')),
  content_type text not null default 'text' check (
    content_type in ('text', 'voice', 'system_event')
  ),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- OUTREACH QUEUE (scheduled follow-ups)
-- ============================================================
create table public.outreach_queue (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  session_id uuid references public.onboarding_sessions(id) on delete set null,
  channel text not null check (
    channel in ('sms', 'email', 'voice_call', 'widget', 'system')
  ),
  message_template text not null,
  message_params jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending' check (
    status in ('pending', 'sent', 'failed', 'cancelled')
  ),
  attempt_count integer not null default 0,
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  escalation_level integer not null default 1,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ESCALATIONS (when bot needs human help)
-- ============================================================
create table public.escalations (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  session_id uuid references public.onboarding_sessions(id) on delete set null,
  reason text not null,
  context jsonb not null default '{}'::jsonb,
  channel text not null check (
    channel in ('sms', 'email', 'voice_call', 'widget', 'system')
  ),
  status text not null default 'open' check (
    status in ('open', 'assigned', 'resolved')
  ),
  assigned_to text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_org_members_user on public.org_members(user_id);
create index idx_org_members_org on public.org_members(org_id);
create index idx_service_definitions_org on public.service_definitions(org_id);
create index idx_service_packages_org on public.service_packages(org_id);
create index idx_package_services_package on public.package_services(package_id);
create index idx_niche_templates_org on public.niche_templates(org_id);
create index idx_niche_templates_niche on public.niche_templates(niche_name);
create index idx_clients_org on public.clients(org_id);
create index idx_clients_email on public.clients(email);
create index idx_client_packages_client on public.client_packages(client_id);
create index idx_client_services_client on public.client_services(client_id);
create index idx_client_services_status on public.client_services(status);
create index idx_sessions_client on public.onboarding_sessions(client_id);
create index idx_sessions_org on public.onboarding_sessions(org_id);
create index idx_sessions_status on public.onboarding_sessions(status);
create index idx_responses_session on public.session_responses(session_id);
create index idx_service_tasks_client_service on public.service_tasks(client_service_id);
create index idx_service_tasks_status on public.service_tasks(status);
create index idx_service_tasks_next_check on public.service_tasks(next_check_at) where next_check_at is not null;
create index idx_interaction_log_client on public.interaction_log(client_id);
create index idx_interaction_log_session on public.interaction_log(session_id);
create index idx_interaction_log_created on public.interaction_log(created_at);
create index idx_outreach_queue_scheduled on public.outreach_queue(scheduled_at) where status = 'pending';
create index idx_outreach_queue_client on public.outreach_queue(client_id);
create index idx_escalations_status on public.escalations(status) where status != 'resolved';
create index idx_escalations_client on public.escalations(client_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.service_definitions enable row level security;
alter table public.service_packages enable row level security;
alter table public.package_services enable row level security;
alter table public.niche_templates enable row level security;
alter table public.clients enable row level security;
alter table public.client_packages enable row level security;
alter table public.client_services enable row level security;
alter table public.onboarding_sessions enable row level security;
alter table public.session_responses enable row level security;
alter table public.service_tasks enable row level security;
alter table public.interaction_log enable row level security;
alter table public.outreach_queue enable row level security;
alter table public.escalations enable row level security;

-- Org members can read their own org
create policy "org_members_read_org" on public.organizations
  for select using (
    id in (select org_id from public.org_members where user_id = auth.uid())
  );

-- Org members can manage their org's data
create policy "org_members_select" on public.org_members
  for select using (
    org_id in (select org_id from public.org_members om where om.user_id = auth.uid())
  );

create policy "service_defs_select" on public.service_definitions
  for select using (
    org_id in (select org_id from public.org_members where user_id = auth.uid())
  );

create policy "service_defs_modify" on public.service_definitions
  for all using (
    org_id in (select org_id from public.org_members where user_id = auth.uid() and role in ('owner', 'admin'))
  );

create policy "packages_select" on public.service_packages
  for select using (
    org_id in (select org_id from public.org_members where user_id = auth.uid())
  );

create policy "packages_modify" on public.service_packages
  for all using (
    org_id in (select org_id from public.org_members where user_id = auth.uid() and role in ('owner', 'admin'))
  );

create policy "templates_select" on public.niche_templates
  for select using (
    org_id in (select org_id from public.org_members where user_id = auth.uid())
  );

create policy "templates_modify" on public.niche_templates
  for all using (
    org_id in (select org_id from public.org_members where user_id = auth.uid() and role in ('owner', 'admin'))
  );

create policy "clients_select" on public.clients
  for select using (
    org_id in (select org_id from public.org_members where user_id = auth.uid())
  );

create policy "clients_modify" on public.clients
  for all using (
    org_id in (select org_id from public.org_members where user_id = auth.uid())
  );

create policy "sessions_select" on public.onboarding_sessions
  for select using (
    org_id in (select org_id from public.org_members where user_id = auth.uid())
  );

-- Widget/API can create and update sessions (anonymous access for onboarding)
create policy "sessions_anon_insert" on public.onboarding_sessions
  for insert with check (true);

create policy "sessions_anon_update" on public.onboarding_sessions
  for update using (true);

-- Widget/API can insert responses
create policy "responses_anon_insert" on public.session_responses
  for insert with check (true);

create policy "responses_select" on public.session_responses
  for select using (
    session_id in (
      select id from public.onboarding_sessions
      where org_id in (select org_id from public.org_members where user_id = auth.uid())
    )
  );

-- Widget/API can insert interaction logs
create policy "interactions_anon_insert" on public.interaction_log
  for insert with check (true);

create policy "interactions_select" on public.interaction_log
  for select using (
    client_id in (
      select id from public.clients
      where org_id in (select org_id from public.org_members where user_id = auth.uid())
    )
  );

-- Outreach queue — managed by system, readable by org members
create policy "outreach_select" on public.outreach_queue
  for select using (
    client_id in (
      select id from public.clients
      where org_id in (select org_id from public.org_members where user_id = auth.uid())
    )
  );

-- Escalations — org members can read and update
create policy "escalations_select" on public.escalations
  for select using (
    client_id in (
      select id from public.clients
      where org_id in (select org_id from public.org_members where user_id = auth.uid())
    )
  );

create policy "escalations_update" on public.escalations
  for update using (
    client_id in (
      select id from public.clients
      where org_id in (select org_id from public.org_members where user_id = auth.uid())
    )
  );

-- Package services — readable if you can read the package
create policy "package_services_select" on public.package_services
  for select using (
    package_id in (
      select id from public.service_packages
      where org_id in (select org_id from public.org_members where user_id = auth.uid())
    )
  );

-- Client packages — readable if you can read the client
create policy "client_packages_select" on public.client_packages
  for select using (
    client_id in (
      select id from public.clients
      where org_id in (select org_id from public.org_members where user_id = auth.uid())
    )
  );

-- Client services — readable + widget can update status
create policy "client_services_select" on public.client_services
  for select using (
    client_id in (
      select id from public.clients
      where org_id in (select org_id from public.org_members where user_id = auth.uid())
    )
  );

-- Service tasks — readable by org members
create policy "service_tasks_select" on public.service_tasks
  for select using (
    client_service_id in (
      select id from public.client_services
      where client_id in (
        select id from public.clients
        where org_id in (select org_id from public.org_members where user_id = auth.uid())
      )
    )
  );
