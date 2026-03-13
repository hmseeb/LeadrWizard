---
phase: 01-security-foundation
plan: "05"
subsystem: api
tags: [nextjs, supabase, cors, widget, fetch, service-role]

# Dependency graph
requires:
  - phase: 01-01
    provides: RLS hardening that removes anon insert policies on session_responses and interaction_log

provides:
  - POST /api/widget/response route with CORS support and server-side session validation
  - Widget write path moved from anon Supabase client to authenticated API endpoint
  - apiBaseUrl field in LeadrWizardConfig for cross-origin API calls

affects:
  - 01-security-foundation (closes SEC-05)
  - widget deployment (apiBaseUrl is now required in init config)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-origin widget writes use fetch() to admin API, not direct Supabase anon client"
    - "Server-side session validation before insert via service role client"
    - "CORS preflight via OPTIONS handler returning 204 with Access-Control-Allow-Origin: *"

key-files:
  created:
    - apps/admin/src/app/api/widget/response/route.ts
  modified:
    - apps/widget/src/hooks/useWizardSession.ts
    - apps/widget/src/main.tsx
    - apps/widget/src/components/WizardWidget.tsx

key-decisions:
  - "widget write path uses fetch() to admin API so that RLS-removed anon insert policies are never needed"
  - "apiBaseUrl defaults to empty string so fetch() is relative URL in dev (same-origin)"
  - "interaction_log insert moved fully server-side — widget never touches interaction_log directly"
  - "org_id and client_id resolved from server-validated session — never trusted from client request body"

patterns-established:
  - "Widget writes always go through admin API route, never direct Supabase anon inserts"
  - "CORS on API routes: OPTIONS handler + corsHeaders object applied to all POST responses including errors"
  - "Service role client used for writes that come from anonymous widget callers after RLS policy removal"

requirements-completed: [SEC-05]

# Metrics
duration: 8min
completed: 2026-03-14
---

# Phase 01 Plan 05: Authenticated Widget Response API Summary

**Server-side widget response route with CORS and session validation, replacing anon Supabase inserts from the widget with fetch() calls to /api/widget/response using the service role client**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-13T19:08:01Z
- **Completed:** 2026-03-13T19:16:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `POST /api/widget/response` Next.js route with OPTIONS CORS preflight (204), full session validation, and service-role inserts for both `session_responses` and `interaction_log`
- Removed all direct anon Supabase write calls (`session_responses.insert`, `interaction_log.insert`) from widget hook
- Added `apiBaseUrl` as required field in `LeadrWizardConfig` and threaded it through `WizardWidget` -> `useWizardSession` prop chain

## Task Commits

Each task was committed atomically:

1. **Task 1: Create POST /api/widget/response route with CORS support** - `c3aac25` (feat)
2. **Task 2: Refactor widget hook and config to use API endpoint for writes** - `a930370` (feat)

**Plan metadata:** `(docs commit hash — see below)` (docs: complete plan)

## Files Created/Modified

- `apps/admin/src/app/api/widget/response/route.ts` - New CORS-capable route: OPTIONS preflight + POST handler with session validation and service-role inserts
- `apps/widget/src/hooks/useWizardSession.ts` - `apiBaseUrl` param added; `submitResponse()` now uses `fetch()` to POST to `${apiBaseUrl}/api/widget/response`; direct Supabase inserts removed
- `apps/widget/src/main.tsx` - `LeadrWizardConfig` gains required `apiBaseUrl: string` field; passed to `WizardWidget`
- `apps/widget/src/components/WizardWidget.tsx` - Props updated to accept and pass `apiBaseUrl` through to `useWizardSession`

## Decisions Made

- `apiBaseUrl` is required (not optional) in `LeadrWizardConfig` to make the dependency explicit for widget embedders
- In `useWizardSession`, `apiBaseUrl` is optional (defaults to `""`) so relative URL fetch works in same-origin dev/test scenarios
- `org_id` and `client_id` resolved entirely from the validated session on the server — no trust of client-supplied values
- `interaction_log` insert now happens server-side inside the same route handler, removing the need for any anon write permissions on that table

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- pnpm not found in PATH in this execution environment — TypeScript check ran via `npx tsc --noEmit` instead. All errors observed were pre-existing environment errors (missing node_modules, react types not installed) present across all files, not caused by plan changes. No file-specific errors in new/modified files.

## Next Phase Readiness

- SEC-05 closed: widget write path is now authenticated server-side; anon insert policies can be safely removed by Plan 01-01 migration
- Widget embedders will need to pass `apiBaseUrl` in their `LeadrWizard.init()` config call
- Read path (loadSession, session/client/services queries) continues using anon Supabase client — no changes needed there

---
*Phase: 01-security-foundation*
*Completed: 2026-03-14*
