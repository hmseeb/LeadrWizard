---
phase: 01-security-foundation
plan: "01"
subsystem: database
tags: [postgres, supabase, rls, plpgsql, migrations, idempotency, webhooks]

# Dependency graph
requires: []
provides:
  - processed_webhook_events table for Stripe/payment webhook idempotency deduplication
  - RLS policy hardening: exploitable anon policies dropped, scoped replacements added
  - provision_client plpgsql function for atomic client provisioning via supabase.rpc()
affects:
  - 01-02 (stripe webhook handler uses processed_webhook_events for SEC-02)
  - 01-03 (payment webhook handler uses processed_webhook_events + provision_client)
  - 01-04 (widget response route depends on scoped RLS from 00005)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "New migration per policy change — never modify deployed migrations"
    - "Service-role-only tables have no RLS (processed_webhook_events)"
    - "plpgsql security definer function for atomic multi-table provisioning"
    - "Idempotency via payment_ref uniqueness check inside plpgsql before inserts"

key-files:
  created:
    - supabase/migrations/00004_webhook_idempotency.sql
    - supabase/migrations/00005_rls_hardening.sql
  modified: []

key-decisions:
  - "provision_client placed in 00005 alongside RLS hardening — both are security foundational, single migration boundary"
  - "interactions_valid_session_insert references onboarding_sessions.id (not client_id) for consistency with session-scoped insert pattern"
  - "No RLS on processed_webhook_events — service role only, adding RLS would be overhead with no security benefit"

patterns-established:
  - "Pattern: drop-then-replace for RLS policy changes across migrations"
  - "Pattern: security definer plpgsql for cross-table ACID operations"

requirements-completed: [SEC-02, SEC-03, ORG-03]

# Metrics
duration: 2min
completed: 2026-03-13
---

# Phase 01 Plan 01: DB Migrations — Webhook Idempotency and RLS Hardening Summary

**Two Supabase migrations that close the anonymous RLS exploit surface and add a plpgsql atomic provisioning function, eliminating orphaned record risk on payment failure.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-13T18:52:08Z
- **Completed:** 2026-03-13T18:53:31Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created processed_webhook_events table (id text PK, source, processed_at, payload) with cleanup index — enables SEC-02 idempotency checks in Plans 02 and 03
- Dropped four exploitable anonymous RLS policies (sessions_anon_insert, sessions_anon_update, responses_anon_insert, interactions_anon_insert) and replaced with EXISTS-guarded scoped policies
- Defined provision_client plpgsql function (security definer) that atomically creates client, client_package, client_services, and onboarding_session in one transaction with idempotency on payment_ref

## Task Commits

Each task was committed atomically:

1. **Task 1: Create webhook idempotency table migration (00004)** - `1efeeef` (feat)
2. **Task 2: Create RLS hardening + provision_client migration (00005)** - `add9af4` (feat)

## Files Created/Modified

- `supabase/migrations/00004_webhook_idempotency.sql` - Idempotency table for webhook deduplication (SEC-02)
- `supabase/migrations/00005_rls_hardening.sql` - RLS policy replacement + provision_client plpgsql function (SEC-03, ORG-03)

## Decisions Made

- provision_client placed in 00005 alongside RLS hardening — both are security foundational, logically grouped in same migration boundary
- interactions_valid_session_insert uses session_id EXISTS check (not client_id) for consistency with the session-scoped insert pattern used for responses
- No RLS on processed_webhook_events — accessed exclusively via service role from server-side webhook routes, RLS would add overhead with zero security benefit

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — migrations are SQL files ready to apply with `supabase db push` or `supabase migration up`. No external service configuration required.

## Next Phase Readiness

- Migration 00004 is ready: Plans 02 and 03 can implement idempotency checks against processed_webhook_events
- Migration 00005 is ready: provision_client can be called via supabase.rpc() in Plan 03 (payment handler refactor)
- RLS scoping is ready: Plan 04 (widget response API route) is unblocked — session creation via server-side service role works correctly with new policies
- No blockers for subsequent plans in Phase 1

---
*Phase: 01-security-foundation*
*Completed: 2026-03-13*
