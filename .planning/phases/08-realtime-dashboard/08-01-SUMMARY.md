---
phase: 08-realtime-dashboard
plan: 01
subsystem: database
tags: [supabase, realtime, postgres, migration, escalations]

# Dependency graph
requires:
  - phase: 01-security-foundation
    provides: escalations table schema, clients.org_id NOT NULL constraint
provides:
  - org_id column on escalations table (NOT NULL, FK to organizations)
  - escalations and onboarding_sessions added to supabase_realtime publication
  - index on escalations(org_id) for realtime filter performance
  - all escalation insert paths include org_id
affects: [08-realtime-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns: [supabase_realtime publication for realtime subscriptions, org_id resolution before escalation insert]

key-files:
  created:
    - supabase/migrations/00009_realtime_setup.sql
  modified:
    - packages/shared/src/types/index.ts
    - packages/shared/src/automations/escalation-notifier.ts
    - apps/admin/src/app/api/webhooks/twilio/route.ts
    - apps/admin/src/app/api/webhooks/vapi/route.ts
    - packages/shared/src/automations/website-builder.ts

key-decisions:
  - "Nullable-first backfill pattern: add org_id as nullable, backfill from clients join, then set NOT NULL"
  - "createEscalation resolves org_id from client as fallback so existing callers (outreach-scheduler, task-processor) need no changes"
  - "Direct inserts in Twilio/Vapi/website-builder do separate lightweight org_id lookup rather than using createEscalation"

patterns-established:
  - "Realtime publication setup: DO block to ensure publication exists, then ALTER PUBLICATION ADD TABLE"
  - "org_id resolution pattern: select org_id from clients where id = client_id before escalation insert"

requirements-completed: [OBS-03]

# Metrics
duration: 2min
completed: 2026-03-14
---

# Phase 8 Plan 1: Realtime Setup Summary

**org_id added to escalations with backfill migration, both tables enabled for supabase_realtime, all 5 escalation insert paths updated**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-13T22:55:29Z
- **Completed:** 2026-03-13T22:57:33Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Migration 00009 adds org_id to escalations with nullable-first backfill from clients, then NOT NULL constraint
- Both onboarding_sessions and escalations tables added to supabase_realtime publication for realtime subscriptions
- All 5 escalation insert paths (createEscalation, Twilio webhook, Vapi webhook, website-builder, plus createEscalation's fallback) include org_id

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migration for org_id on escalations + realtime publication setup** - `4f13b13` (feat)
2. **Task 2: Update Escalation type and all insert call sites to include org_id** - `172bdf5` (feat)

## Files Created/Modified
- `supabase/migrations/00009_realtime_setup.sql` - Adds org_id column, backfill, NOT NULL, index, realtime publication
- `packages/shared/src/types/index.ts` - Escalation interface now has org_id field
- `packages/shared/src/automations/escalation-notifier.ts` - createEscalation resolves org_id from client, includes in insert
- `apps/admin/src/app/api/webhooks/twilio/route.ts` - Escalation insert includes org_id from client lookup
- `apps/admin/src/app/api/webhooks/vapi/route.ts` - Escalation insert includes org_id from client lookup
- `packages/shared/src/automations/website-builder.ts` - Escalation insert includes org_id from client lookup

## Decisions Made
- Nullable-first backfill pattern: add column nullable, UPDATE from clients join, then ALTER SET NOT NULL. Avoids constraint violation on existing rows.
- createEscalation accepts optional orgId param and resolves from client as fallback. This means existing callers (outreach-scheduler, task-processor) that call createEscalation without orgId still work without modification.
- Direct inserts in webhook routes and website-builder do their own lightweight org_id SELECT rather than refactoring to use createEscalation, keeping the diff minimal.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- escalations table has org_id for realtime channel filtering (filter: 'org_id=eq.{uuid}')
- onboarding_sessions already had org_id, now both tables are in supabase_realtime publication
- Ready for Plan 08-02 to build the realtime dashboard subscription layer

---
*Phase: 08-realtime-dashboard*
*Completed: 2026-03-14*
