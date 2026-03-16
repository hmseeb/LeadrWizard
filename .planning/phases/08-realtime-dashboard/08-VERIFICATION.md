---
phase: 08-realtime-dashboard
verified: 2026-03-14T12:00:00Z
status: passed
score: 3/3 must-haves verified
re_verification: false
---

# Phase 8: Realtime Dashboard Verification Report

**Phase Goal:** The admin dashboard reflects live changes to onboarding sessions and escalations without requiring a page refresh.
**Verified:** 2026-03-14T12:00:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When an onboarding session status changes in the database, the sessions list updates within 2 seconds without page reload | VERIFIED | `useRealtimeTable` subscribes to `postgres_changes` on `onboarding_sessions` with `event: "*"` and `filter: org_id=eq.${orgId}`. INSERT/UPDATE/DELETE handlers merge changes into React state via `setData`. RealtimeSessions renders the `sessions` array directly. Channel cleanup on unmount via `supabase.removeChannel(channel)`. |
| 2 | When a new escalation is created, it appears in the escalations view within 2 seconds without page reload | VERIFIED | RealtimeEscalations uses `useRealtimeTable` on `escalations` table with same pattern. RealtimeDashboard subscribes to both tables via chained `.on()` calls and refetches KPI counts + recent escalations on any event. All 5 escalation insert paths include `org_id`. |
| 3 | Realtime updates are scoped to the logged-in org -- an event from org B does not appear in org A's dashboard | VERIFIED | All realtime subscriptions use `filter: org_id=eq.${orgId}` (use-realtime-table.ts:37, realtime-dashboard.tsx:129,141). Server components resolve `orgId` via `getUserOrg()` and pass to client components. Migration adds org_id NOT NULL to escalations with backfill. DELETE events have client-side org_id guard (use-realtime-table.ts:54). |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/00009_realtime_setup.sql` | org_id column + realtime publication | VERIFIED | Adds org_id to escalations (nullable, backfill from clients, then NOT NULL). Creates index. ALTER PUBLICATION adds both onboarding_sessions and escalations to supabase_realtime. |
| `packages/shared/src/types/index.ts` | Escalation has org_id field | VERIFIED | Line 299: `org_id: string` in Escalation interface |
| `packages/shared/src/automations/escalation-notifier.ts` | createEscalation includes org_id | VERIFIED | Lines 47-57: Resolves org_id from client if not provided. Line 63: Includes org_id in insert payload. Throws if org_id unresolvable. |
| `packages/shared/src/automations/website-builder.ts` | escalation insert includes org_id | VERIFIED | Lines 302-315: Resolves org_id from client lookup, includes in insert payload |
| `apps/admin/src/app/api/webhooks/twilio/route.ts` | escalation insert includes org_id | VERIFIED | Lines 76-91: Resolves org_id from client lookup, includes in insert at line 90 |
| `apps/admin/src/app/api/webhooks/vapi/route.ts` | escalation insert includes org_id | VERIFIED | Lines 190-206: Resolves org_id from client lookup, includes in insert at line 205 |
| `apps/admin/src/hooks/use-realtime-table.ts` | Shared realtime subscription hook | VERIFIED | 69 lines. Generic hook with INSERT/UPDATE/DELETE handling, org_id filter, channel cleanup on unmount. Not a stub. |
| `apps/admin/src/app/(dashboard)/onboardings/realtime-sessions.tsx` | Client component with live sessions table | VERIFIED | 147 lines. Full table rendering with status badges, progress bars, client names. Uses useRealtimeTable. |
| `apps/admin/src/app/(dashboard)/onboardings/page.tsx` | Server wrapper passing orgId and initial data | VERIFIED | Resolves user, org, fetches sessions with .eq("org_id"), passes to RealtimeSessions |
| `apps/admin/src/app/(dashboard)/escalations/realtime-escalations.tsx` | Client component with live escalation cards | VERIFIED | 112 lines. Renders escalation cards with status coloring, client info, timestamps. Uses useRealtimeTable. |
| `apps/admin/src/app/(dashboard)/escalations/page.tsx` | Server wrapper passing orgId and initial data | VERIFIED | Same pattern as onboardings: resolves org, fetches with .eq("org_id"), passes to client component |
| `apps/admin/src/app/(dashboard)/dashboard/realtime-dashboard.tsx` | Client component with live KPIs and recent escalations | VERIFIED | 294 lines. Subscribes to both tables via chained `.on()`. Refetches all KPI counts and recent escalations on any change. KPICard components render counts. |
| `apps/admin/src/app/(dashboard)/dashboard/page.tsx` | Server wrapper passing initial counts and orgId | VERIFIED | Fetches all dashboard data server-side, passes initialCounts and orgId to RealtimeDashboard. Static sections passed as children. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| onboardings/page.tsx | RealtimeSessions | `import { RealtimeSessions }` + JSX render | WIRED | Props: initialSessions, orgId |
| RealtimeSessions | useRealtimeTable | `import { useRealtimeTable }` + function call | WIRED | Passes table="onboarding_sessions", orgId, initialData, channelName |
| escalations/page.tsx | RealtimeEscalations | `import { RealtimeEscalations }` + JSX render | WIRED | Props: initialEscalations, orgId |
| RealtimeEscalations | useRealtimeTable | `import { useRealtimeTable }` + function call | WIRED | Passes table="escalations", orgId, initialData, channelName |
| dashboard/page.tsx | RealtimeDashboard | `import { RealtimeDashboard }` + JSX render | WIRED | Props: initialCounts, initialRecentEscalations, orgId, children |
| RealtimeDashboard | supabase.channel | Direct subscription with chained .on() | WIRED | Subscribes to both onboarding_sessions and escalations tables with org_id filter |
| useRealtimeTable | supabase.channel | Direct subscription in useEffect | WIRED | Cleanup via supabase.removeChannel(channel) in useEffect return |
| Migration | supabase_realtime | ALTER PUBLICATION ADD TABLE | WIRED | Both onboarding_sessions and escalations added |
| All escalation inserts | org_id column | Direct inclusion in insert payload | WIRED | 5 insert paths verified: createEscalation, twilio webhook, vapi webhook, website-builder, plus createEscalation's fallback resolution |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| OBS-03 | 08-01, 08-02 | Dashboard updates in realtime via Supabase subscriptions for onboarding_sessions and escalations | SATISFIED | Postgres Changes subscriptions on both tables, org_id scoping, INSERT/UPDATE/DELETE handling, channel cleanup, refetch-on-event for dashboard KPIs |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | - | - | - | - |

No TODO/FIXME/PLACEHOLDER markers found in any realtime-related files. No empty handlers, no stub returns. All components render real data.

### Notable Observations (not blockers)

1. **Dashboard page.tsx server queries lack explicit org_id scoping** (lines 86-173): The initial data fetch for dashboard KPIs relies entirely on RLS rather than adding `.eq("org_id", orgId)` to each query. The onboardings and escalations server pages DO include explicit org_id scoping. This is a defense-in-depth concern but not a Phase 8 blocker since RLS is the primary access control mechanism.

2. **refetchLiveData secondary metrics not org-scoped**: `outreach_queue` and `client_services` queries in `refetchLiveData` don't include `.eq("org_id", orgId)`. These tables aren't subscribed to for realtime and rely on RLS. Minor defense-in-depth gap.

3. **INSERT payloads show "Unknown" for client names**: Documented design decision. Postgres Changes sends raw rows without joins, so new records from realtime will show "Unknown" for client name on list pages until next full page load. Dashboard's recent escalations section handles this by refetching with joins.

### Human Verification Required

### 1. Realtime Session Updates

**Test:** Change a session's status in the database (e.g., via Supabase dashboard: UPDATE onboarding_sessions SET status = 'completed' WHERE id = ...). Watch the onboardings page.
**Expected:** The session row updates its status badge within 2 seconds without page reload. Counts at top (Active/Paused/Completed) update.
**Why human:** Requires a running Supabase instance with realtime enabled and a browser to observe WebSocket behavior.

### 2. Realtime Escalation Appearance

**Test:** Insert a new escalation row in the database with the correct org_id. Watch the escalations page.
**Expected:** A new escalation card appears at the top of the list within 2 seconds without page reload.
**Why human:** Requires live database + browser to verify WebSocket delivery.

### 3. Cross-Org Isolation

**Test:** With two orgs (A and B), log into org A's dashboard. Insert an escalation with org B's org_id. Watch org A's dashboard.
**Expected:** The escalation does NOT appear in org A's dashboard. It should only appear in org B's.
**Why human:** Requires two org setups and observing that filtered subscriptions correctly exclude cross-org events.

### 4. Channel Cleanup on Navigation

**Test:** Navigate to the onboardings page, then navigate away. Check browser DevTools Network/WS tab.
**Expected:** The WebSocket channel for sessions-realtime is unsubscribed/removed when navigating away.
**Why human:** Requires browser DevTools to inspect WebSocket lifecycle.

### Gaps Summary

No gaps found. All three success criteria are verifiable through the codebase:

1. **Session status changes propagate in realtime** -- useRealtimeTable subscribes to onboarding_sessions with INSERT/UPDATE/DELETE handling, filtered by org_id. RealtimeSessions renders the live array.

2. **New escalations appear in realtime** -- Both RealtimeEscalations (via useRealtimeTable) and RealtimeDashboard (via direct channel subscription + refetch) handle new escalation events.

3. **Org-scoped realtime** -- All subscriptions use `filter: org_id=eq.${orgId}`. All 5 escalation insert paths include org_id. Migration adds org_id NOT NULL with backfill and index.

All 4 commits verified in git history. All 13 artifacts verified at all three levels (exists, substantive, wired). No anti-patterns found.

---

_Verified: 2026-03-14T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
