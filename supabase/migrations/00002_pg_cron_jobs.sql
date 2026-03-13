-- ============================================================
-- LeadrWizard: Scheduled Jobs via pg_cron + pg_net
-- ============================================================
--
-- pg_cron runs inside Supabase Postgres. It calls our API
-- endpoints on schedule to process outreach queues and
-- service tasks (A2P status, GMB access, etc.)
--
-- Supabase enables pg_cron by default on paid plans.
-- pg_net allows HTTP requests from within Postgres.
-- ============================================================

-- Enable required extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============================================================
-- Job 1: Process outreach queue (every 2 minutes)
-- Sends pending SMS, voice calls, and emails that are due.
-- ============================================================
select cron.schedule(
  'process-outreach-queue',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.base_url') || '/api/cron/outreach',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================
-- Job 2: Process service tasks (every 15 minutes)
-- Polls A2P registration status, GMB access approval,
-- retries failed GHL provisioning, checks website approvals.
-- ============================================================
select cron.schedule(
  'process-service-tasks',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.base_url') || '/api/cron/tasks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================
-- Job 3: Stale session detector (every hour)
-- Checks for active sessions with no interaction in 2+ hours
-- and schedules follow-up if not already queued.
-- ============================================================
select cron.schedule(
  'detect-stale-sessions',
  '0 * * * *',
  $$
  -- Find active sessions with no pending outreach and no recent interaction
  with stale_sessions as (
    select os.id as session_id, os.client_id
    from public.onboarding_sessions os
    where os.status = 'active'
      and os.last_interaction_at < now() - interval '2 hours'
      and not exists (
        select 1 from public.outreach_queue oq
        where oq.session_id = os.id
          and oq.status = 'pending'
      )
  )
  insert into public.outreach_queue (
    client_id, session_id, channel, message_template,
    message_params, scheduled_at, status, attempt_count,
    priority, escalation_level
  )
  select
    ss.client_id,
    ss.session_id,
    'sms',
    'reminder_1',
    '{}'::jsonb,
    now(),
    'pending',
    0,
    'normal',
    1
  from stale_sessions ss;
  $$
);

-- ============================================================
-- Job 4: Daily analytics snapshot (midnight UTC)
-- Captures daily metrics for the analytics dashboard.
-- ============================================================
select cron.schedule(
  'daily-analytics-snapshot',
  '0 0 * * *',
  $$
  insert into public.analytics_snapshots (
    snapshot_date,
    active_sessions,
    completed_sessions,
    abandoned_sessions,
    avg_completion_pct,
    total_interactions,
    sms_sent,
    voice_calls_made,
    emails_sent,
    escalations_opened,
    escalations_resolved,
    services_delivered
  )
  select
    current_date,
    (select count(*) from public.onboarding_sessions where status = 'active'),
    (select count(*) from public.onboarding_sessions where status = 'completed'
      and updated_at >= current_date),
    (select count(*) from public.onboarding_sessions where status = 'abandoned'
      and updated_at >= current_date),
    (select coalesce(avg(completion_pct), 0) from public.onboarding_sessions
      where status = 'active'),
    (select count(*) from public.interaction_log
      where created_at >= current_date),
    (select count(*) from public.interaction_log
      where channel = 'sms' and direction = 'outbound'
      and created_at >= current_date),
    (select count(*) from public.interaction_log
      where channel = 'voice_call' and direction = 'outbound'
      and created_at >= current_date),
    (select count(*) from public.interaction_log
      where channel = 'email' and direction = 'outbound'
      and created_at >= current_date),
    (select count(*) from public.escalations
      where created_at >= current_date),
    (select count(*) from public.escalations
      where resolved_at >= current_date),
    (select count(*) from public.client_services
      where status = 'delivered' and updated_at >= current_date)
  on conflict (snapshot_date) do update set
    active_sessions = excluded.active_sessions,
    completed_sessions = excluded.completed_sessions,
    abandoned_sessions = excluded.abandoned_sessions,
    avg_completion_pct = excluded.avg_completion_pct,
    total_interactions = excluded.total_interactions,
    sms_sent = excluded.sms_sent,
    voice_calls_made = excluded.voice_calls_made,
    emails_sent = excluded.emails_sent,
    escalations_opened = excluded.escalations_opened,
    escalations_resolved = excluded.escalations_resolved,
    services_delivered = excluded.services_delivered;
  $$
);

-- ============================================================
-- Analytics snapshots table (used by Job 4 and dashboard)
-- ============================================================
create table if not exists public.analytics_snapshots (
  id uuid primary key default uuid_generate_v4(),
  snapshot_date date not null unique,
  active_sessions integer not null default 0,
  completed_sessions integer not null default 0,
  abandoned_sessions integer not null default 0,
  avg_completion_pct numeric(5,2) not null default 0,
  total_interactions integer not null default 0,
  sms_sent integer not null default 0,
  voice_calls_made integer not null default 0,
  emails_sent integer not null default 0,
  escalations_opened integer not null default 0,
  escalations_resolved integer not null default 0,
  services_delivered integer not null default 0,
  created_at timestamptz not null default now()
);

-- RLS for analytics
alter table public.analytics_snapshots enable row level security;

create policy "Authenticated users can read analytics"
  on public.analytics_snapshots for select
  to authenticated
  using (true);

-- ============================================================
-- Configuration note:
-- Set these in Supabase Dashboard > Settings > Database > Settings:
--   app.settings.base_url = 'https://your-domain.com'
--   app.settings.cron_secret = 'your-cron-secret-value'
-- ============================================================
