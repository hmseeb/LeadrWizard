---
phase: 08-realtime-dashboard
plan: 02
subsystem: ui
tags: [supabase, realtime, react, postgres-changes, websocket, next.js]

# Dependency graph
requires:
  - phase: 08-realtime-dashboard
    provides: org_id on escalations, supabase_realtime publication for both tables
provides:
  - useRealtimeTable shared hook for Postgres Changes subscriptions with INSERT/UPDATE/DELETE merge
  - RealtimeSessions client component with live sessions table
  - RealtimeEscalations client component with live escalation cards
  - RealtimeDashboard client component with live KPI cards and recent escalations
  - Server wrapper pattern on onboardings, escalations, and dashboard pages
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [server wrapper + client subscriber pattern, useRealtimeTable hook for DRY realtime subscriptions, multi-table subscription on single channel for dashboard KPIs, refetch-on-event strategy for aggregate counts]

key-files:
  created:
    - apps/admin/src/hooks/use-realtime-table.ts
    - apps/admin/src/app/(dashboard)/onboardings/realtime-sessions.tsx
    - apps/admin/src/app/(dashboard)/escalations/realtime-escalations.tsx
    - apps/admin/src/app/(dashboard)/dashboard/realtime-dashboard.tsx
  modified:
    - apps/admin/src/app/(dashboard)/onboardings/page.tsx
    - apps/admin/src/app/(dashboard)/escalations/page.tsx
    - apps/admin/src/app/(dashboard)/dashboard/page.tsx

key-decisions:
  - "Refetch-on-event for dashboard KPIs rather than delta computation: simpler, reliable at admin scale"
  - "Server queries include .eq('org_id', orgId) for defense-in-depth alongside RLS"
  - "INSERT payloads show 'Unknown' for joined client data (acceptable v1 tradeoff, avoids per-event refetch on list pages)"
  - "RealtimeDashboard refetches joined escalation data on events so recent escalations always show client names"
  - "Static dashboard sections (outreach, trends, tasks) pass as children to avoid unnecessary client-side rendering"
  - "todayInteractionsCount passed as static prop since interaction_log is not in realtime publication"

patterns-established:
  - "Server wrapper + client subscriber: server component fetches initial data + orgId, passes to 'use client' component that subscribes"
  - "useRealtimeTable<T>: generic hook accepting table, orgId, initialData, channelName. Handles INSERT/UPDATE/DELETE with functional state updates"
  - "Multi-table single channel: chain .on() calls for dashboard watching multiple tables"
  - "DELETE event client-side org_id validation: since Postgres Changes cannot server-filter DELETE events"

requirements-completed: [OBS-03]

# Metrics
duration: 5min
completed: 2026-03-14
---

# Phase 8 Plan 2: Realtime Client Components Summary

**Shared useRealtimeTable hook + 3 client components (sessions, escalations, dashboard KPIs) with Postgres Changes subscriptions filtered by org_id**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-13T23:00:07Z
- **Completed:** 2026-03-13T23:05:23Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created reusable useRealtimeTable hook with INSERT/UPDATE/DELETE handling, org_id channel filtering, and proper cleanup
- Built RealtimeSessions and RealtimeEscalations client components with full UI moved from server page components
- Built RealtimeDashboard client component subscribing to both tables on a single channel, re-fetching KPI counts and recent escalations on any change
- All three page.tsx files converted to thin server wrappers resolving orgId via getUserOrg
- Server-side queries include .eq('org_id', orgId) for defense-in-depth alongside RLS
- TypeScript compiles cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Create useRealtimeTable hook and realtime sessions + escalations components** - `e7e5113` (feat)
2. **Task 2: Create realtime dashboard component with live KPI cards** - `e1a3dbf` (feat)

## Files Created/Modified
- `apps/admin/src/hooks/use-realtime-table.ts` - Shared hook for Postgres Changes subscription with INSERT/UPDATE/DELETE merge logic
- `apps/admin/src/app/(dashboard)/onboardings/realtime-sessions.tsx` - Client component rendering sessions table with live updates
- `apps/admin/src/app/(dashboard)/onboardings/page.tsx` - Server wrapper fetching initial sessions + orgId
- `apps/admin/src/app/(dashboard)/escalations/realtime-escalations.tsx` - Client component rendering escalation cards with live updates
- `apps/admin/src/app/(dashboard)/escalations/page.tsx` - Server wrapper fetching initial escalations + orgId
- `apps/admin/src/app/(dashboard)/dashboard/realtime-dashboard.tsx` - Client component with live KPI cards and recent escalations, dual-table subscription
- `apps/admin/src/app/(dashboard)/dashboard/page.tsx` - Server wrapper passing initial counts, recent escalations, and static sections as children

## Decisions Made
- Refetch-on-event strategy for dashboard KPIs: on any session/escalation change, re-fetch all counts and recent escalations. Simpler than computing deltas from payloads, acceptable at admin dashboard scale.
- Server-side queries add `.eq('org_id', orgId)` for defense-in-depth on top of RLS policies.
- INSERT payloads from realtime won't include joined client data (Postgres Changes sends raw rows). For list pages (sessions/escalations), the UI gracefully shows "Unknown" for client name. For the dashboard, refetchLiveData re-queries with joins so client names always appear.
- todayInteractionsCount is a static prop (not refetched) since interaction_log is not in the realtime publication.
- Static dashboard sections (outreach bars, service tasks, 14-day trend) rendered server-side and passed as children to RealtimeDashboard, avoiding unnecessary client-side hydration.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 8 (Realtime Dashboard) is now complete
- All admin dashboard pages update in real time when underlying data changes
- Sessions, escalations, and KPI cards all scoped to the logged-in org via org_id channel filters
- All WebSocket subscriptions properly cleaned up on unmount

## Self-Check: PASSED

All 7 files verified on disk. Both task commits (e7e5113, e1a3dbf) verified in git log.

---
*Phase: 08-realtime-dashboard*
*Completed: 2026-03-14*
