-- Migration: 00011_ignite_package_composition.sql
-- Purpose: Correct the IGNITE package composition to Website + GHL + A2P.
--          The original seed bundled GMB instead of A2P, but GMB is handled
--          natively by GHL (no separate service needed) and A2P is required
--          for the client to send compliant texts through GHL automations.
-- Idempotent: safe to run on databases that already have the old composition,
--             the new composition, or no IGNITE row at all.

-- ============================================================
-- Update the IGNITE row's description to match the new scope.
-- Only touches the row if it exists.
-- ============================================================
update public.service_packages
set description = 'Get found. Get seen. Stop losing leads to silence. Professional website, GHL automations (review funnel, webchat widget, missed-call text-back, SMS follow-up), and A2P 10DLC texting registration. Live in 48 hours.',
    updated_at = now()
where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

-- ============================================================
-- Remove GMB Optimization from IGNITE if present.
-- service_definitions row 'bbbbbbbb-...' is the GMB Optimization service
-- (from the initial seed). We do not delete the service_definition itself —
-- other orgs may still use it — just unlink it from this package.
-- ============================================================
delete from public.package_services
where package_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
  and service_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- ============================================================
-- Add A2P 10DLC Registration to IGNITE if not already linked.
-- The (package_id, service_id) unique constraint makes this a no-op
-- when the row already exists.
-- ============================================================
insert into public.package_services (package_id, service_id)
values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'cccccccc-cccc-cccc-cccc-cccccccccccc'
)
on conflict (package_id, service_id) do nothing;

-- ============================================================
-- Ensure Website Build and GHL Automations are still linked to IGNITE.
-- Idempotent inserts; does nothing if the links already exist.
-- ============================================================
insert into public.package_services (package_id, service_id)
values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
)
on conflict (package_id, service_id) do nothing;

insert into public.package_services (package_id, service_id)
values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'dddddddd-dddd-dddd-dddd-dddddddddddd'
)
on conflict (package_id, service_id) do nothing;
