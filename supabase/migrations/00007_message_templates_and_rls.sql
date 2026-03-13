-- Migration: 00007_message_templates_and_rls.sql
-- Purpose: Create message_templates table for CRUD-03 (admin-managed outreach templates)
--          Fix missing package_services write RLS policy for CRUD-02

-- ============================================================
-- Message Templates (per-org, per-channel outreach templates)
-- Replaces hardcoded templates in packages/shared/src/comms/message-templates.ts
-- Uses {{variable}} mustache-style placeholders for interpolation
-- ============================================================
create table public.message_templates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  channel text not null check (channel in ('sms', 'email', 'voice')),
  subject text,  -- email only, null for sms/voice
  body text not null,  -- uses {{variable}} placeholders
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, slug)
);

create index idx_message_templates_org on public.message_templates(org_id);
create index idx_message_templates_channel on public.message_templates(org_id, channel);

-- RLS
alter table public.message_templates enable row level security;

-- Any org member can read templates
create policy "message_templates_select" on public.message_templates
  for select using (
    org_id in (select org_id from public.org_members where user_id = auth.uid())
  );

-- Only owner/admin can create, update, delete templates
create policy "message_templates_modify" on public.message_templates
  for all using (
    org_id in (
      select org_id from public.org_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- ============================================================
-- Fix: package_services write policy (missing from 00001)
-- Without this, admins cannot assign services to packages
-- ============================================================
create policy "package_services_modify" on public.package_services
  for all using (
    package_id in (
      select id from public.service_packages
      where org_id in (
        select org_id from public.org_members
        where user_id = auth.uid() and role in ('owner', 'admin')
      )
    )
  );
