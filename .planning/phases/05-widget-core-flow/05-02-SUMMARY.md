---
phase: 05-widget-core-flow
plan: "02"
subsystem: widget
tags: [react-hooks, fetch-api, retry-logic, exponential-backoff, widget, bundle-optimization]

# Dependency graph
requires:
  - phase: 05-widget-core-flow
    provides: "GET /api/widget/session/[sessionId] endpoint and POST /api/widget/response auto-completion (plan 05-01)"
  - phase: 01-security-foundation
    provides: "Widget write path via fetch to admin API (plan 01-05)"
provides:
  - "Fetch-based useWizardSession hook (no Supabase client)"
  - "withRetry utility with exponential backoff (3 attempts, 1s/2s/4s)"
  - "submitting and stepError state for UI consumption"
  - "Flat ServiceWithProgress shape matching API response"
  - "Widget bundle without @supabase/supabase-js (~50KB savings)"
affects: [05-widget-core-flow, widget-ui, widget-components]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Fetch-based hook replacing Supabase client reads", "withRetry exponential backoff for resilient submissions", "Double-submit guard via submitting state flag"]

key-files:
  created: []
  modified:
    - apps/widget/src/hooks/useWizardSession.ts
    - apps/widget/src/main.tsx
    - apps/widget/package.json
    - apps/widget/src/components/WizardWidget.tsx
    - apps/widget/src/components/ProgressBar.tsx

key-decisions:
  - "Flat ServiceWithProgress shape (clientServiceId, serviceId, serviceName) instead of nested objects: matches API response, simpler for components"
  - "Default mode changed from 'voice' to 'visual': voice is Phase 6 scope"
  - "stepError displays user-friendly message after all retry attempts fail, clearable via clearStepError callback"
  - "withRetry is a standalone generic utility: clean, testable, no framework dependencies"

patterns-established:
  - "Widget data access pattern: fetch to admin API endpoints, never direct Supabase client"
  - "Retry pattern: withRetry<T>(fn, maxAttempts, baseDelay) with exponential backoff"
  - "Submission state pattern: submitting flag prevents double-submission, stepError captures failure"

requirements-completed: [WIDG-01, WIDG-03, WIDG-05]

# Metrics
duration: 3min
completed: 2026-03-14
---

# Phase 5 Plan 2: Widget Hook Refactor Summary

**Fetch-based useWizardSession hook with retry-wrapped submissions (exponential backoff) and Supabase SDK removal from widget bundle**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-13T21:35:58Z
- **Completed:** 2026-03-13T21:39:05Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Rewrote useWizardSession to load session data via fetch to GET /api/widget/session/:sessionId instead of 4 separate Supabase queries
- Added withRetry utility with exponential backoff (3 attempts, 1s/2s/4s delays) wrapping response submissions
- Added submitting/stepError state and double-submit guard for resilient UI interactions
- Removed @supabase/supabase-js dependency from widget bundle (~50KB savings)
- Cleaned LeadrWizardConfig interface and WizardWidget props to remove supabaseUrl/supabaseKey

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite useWizardSession hook with fetch reads, retry logic, and submitting/stepError state** - `8fe0386` (feat)
2. **Task 2: Clean up widget entry point and remove Supabase dependency** - `bf36104` (chore)

## Files Created/Modified
- `apps/widget/src/hooks/useWizardSession.ts` - Fully rewritten: fetch-based session loading, withRetry submissions, submitting/stepError/clearStepError state
- `apps/widget/src/main.tsx` - Removed supabaseUrl/supabaseKey from config interface and WizardWidget props
- `apps/widget/package.json` - Removed @supabase/supabase-js dependency
- `apps/widget/src/components/WizardWidget.tsx` - Updated props and service shape references (deviation fix)
- `apps/widget/src/components/ProgressBar.tsx` - Updated service shape references (deviation fix)

## Decisions Made
- Flat ServiceWithProgress shape (clientServiceId, serviceId, serviceName) instead of nested objects: matches API response directly, simpler for components
- Default mode changed from "voice" to "visual": voice is Phase 6 scope
- stepError displays user-friendly message after all retry attempts fail, clearable via clearStepError callback
- withRetry is a standalone generic utility: clean, testable, no framework dependencies

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated WizardWidget.tsx props and service shape references**
- **Found during:** Task 1 (useWizardSession rewrite)
- **Issue:** WizardWidget.tsx still referenced supabaseUrl/supabaseKey props and old nested ServiceWithProgress shape (s.clientService.id, s.definition.id)
- **Fix:** Removed Supabase props from interface and destructuring, updated service references to flat shape (s.clientServiceId, s.serviceId)
- **Files modified:** apps/widget/src/components/WizardWidget.tsx
- **Verification:** tsc --noEmit passes cleanly
- **Committed in:** 8fe0386 (Task 1 commit)

**2. [Rule 3 - Blocking] Updated ProgressBar.tsx service shape references**
- **Found during:** Task 1 (useWizardSession rewrite)
- **Issue:** ProgressBar.tsx referenced old nested shape (s.definition.id, s.definition.name) which no longer exists
- **Fix:** Updated to flat shape references (s.serviceId, s.serviceName)
- **Files modified:** apps/widget/src/components/ProgressBar.tsx
- **Verification:** tsc --noEmit passes cleanly
- **Committed in:** 8fe0386 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for type-check to pass. Plan noted WizardWidget.tsx would be handled in Plan 03, but the type errors were blocking. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Widget hook ready for component integration (Plan 05-03)
- All widget data access now goes through admin API endpoints (fetch-based)
- WizardWidget and ProgressBar already updated for new ServiceWithProgress shape (less work in Plan 03)
- submitting/stepError state ready for UI consumption in step renderer

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 05-widget-core-flow*
*Completed: 2026-03-14*
