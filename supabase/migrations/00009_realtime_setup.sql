-- Migration: 00009_realtime_setup.sql
-- Adds org_id to escalations for realtime channel filtering + enables supabase_realtime publication

-- 1. Add org_id column to escalations (nullable first for backfill)
alter table public.escalations
  add column org_id uuid references public.organizations(id) on delete cascade;

-- 2. Backfill org_id from the client's org
update public.escalations e
set org_id = c.org_id
from public.clients c
where e.client_id = c.id;

-- 3. Set NOT NULL after backfill (all rows now have org_id)
alter table public.escalations
  alter column org_id set not null;

-- 4. Add index for realtime filter performance
create index idx_escalations_org on public.escalations(org_id);

-- 5. Add tables to supabase_realtime publication
-- Publication exists by default on Supabase projects
-- Use DO block to handle case where publication doesn't exist yet
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.onboarding_sessions;
alter publication supabase_realtime add table public.escalations;
