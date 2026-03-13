---
phase: 07-rate-limiting-logging
plan: 02
subsystem: infra
tags: [pino, sentry, structured-logging, observability, error-tracking]

requires:
  - phase: 07-rate-limiting-logging/01
    provides: pino logger factory (createRouteLogger), Sentry SDK config
provides:
  - Structured JSON logging across all 12 API routes and 4 shared modules
  - Sentry error capture in every API route catch block with correlation_id tags
  - Zero remaining console.error/warn/log calls in server-side code
affects: [08-deployment-polish]

tech-stack:
  added: []
  patterns: [pino structured logging with err key convention, Sentry.withScope for contextual tags, module-level logger for shared packages, correlation_id propagation via x-correlation-id header]

key-files:
  modified:
    - apps/admin/src/app/api/webhooks/stripe/route.ts
    - apps/admin/src/app/api/webhooks/payment/route.ts
    - apps/admin/src/app/api/webhooks/twilio/route.ts
    - apps/admin/src/app/api/webhooks/vapi/route.ts
    - apps/admin/src/app/api/widget/response/route.ts
    - apps/admin/src/app/api/widget/session/[sessionId]/route.ts
    - apps/admin/src/app/api/signup/checkout/route.ts
    - apps/admin/src/app/api/billing/checkout/route.ts
    - apps/admin/src/app/api/billing/portal/route.ts
    - apps/admin/src/app/api/cron/outreach/route.ts
    - apps/admin/src/app/api/cron/tasks/route.ts
    - apps/admin/src/app/api/org/create/route.ts
    - packages/shared/src/comms/outreach-processor.ts
    - packages/shared/src/automations/task-processor.ts
    - packages/shared/src/automations/escalation-notifier.ts
    - packages/shared/src/automations/payment-handler.ts

key-decisions:
  - "Module-level loggers for shared package files (called outside request context, no correlation_id)"
  - "Vapi route uses moduleLog for helper functions outside handler scope, handler-level log for POST catch block"
  - "No Sentry in shared package: framework-agnostic, errors bubble up to route handlers"
  - "err key (not error) in pino log objects to trigger built-in error serializer"

patterns-established:
  - "Route handler pattern: extract correlation_id from x-correlation-id header or generate UUID, create child logger, use in catch block"
  - "Sentry.withScope pattern: tag correlation_id on every capture, add org_id/session_id when in scope"
  - "Shared module pattern: module-level createRouteLogger('module/name'), no Sentry, errors thrown to callers"
  - "Error wrapping for unknown types: err instanceof Error ? err : new Error(String(err))"

requirements-completed: [OBS-01, OBS-02]

duration: 7min
completed: 2026-03-14
---

# Phase 7 Plan 02: Console-to-Pino Migration Summary

**Replaced all 23 console.error/warn/log calls across 16 files with pino structured logging and Sentry.captureException in every API route catch block**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-13T22:26:49Z
- **Completed:** 2026-03-13T22:34:40Z
- **Tasks:** 2
- **Files modified:** 16

## Accomplishments
- Zero console.error/warn/log calls remaining in apps/admin/src/app/api/ and packages/shared/src/
- Every API route handler creates a child logger with correlation_id from x-correlation-id header (or generated UUID)
- Every API route catch block calls both log.error() AND Sentry.captureException() with correlation_id tag
- Shared package files use module-level loggers with no Sentry dependency (framework-agnostic)
- All structured log lines include route/module name for easy filtering
- TypeScript compiles cleanly in both packages

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace console calls in 12 API route files with pino + Sentry** - `edd16c7` (feat)
2. **Task 2: Replace console calls in 4 shared package files with pino logger** - `425f139` (feat)

## Files Modified
- `apps/admin/src/app/api/webhooks/stripe/route.ts` - Structured logging + Sentry capture for Stripe webhook
- `apps/admin/src/app/api/webhooks/payment/route.ts` - Structured logging + Sentry capture for payment webhook
- `apps/admin/src/app/api/webhooks/twilio/route.ts` - Structured logging + Sentry for Twilio (includes warn for invalid signature and unknown number)
- `apps/admin/src/app/api/webhooks/vapi/route.ts` - Structured logging + Sentry for Vapi (module-level logger for helper functions)
- `apps/admin/src/app/api/widget/response/route.ts` - Structured logging + Sentry for widget response submission
- `apps/admin/src/app/api/widget/session/[sessionId]/route.ts` - Structured logging + Sentry for widget session loading
- `apps/admin/src/app/api/signup/checkout/route.ts` - Structured logging + Sentry for signup checkout
- `apps/admin/src/app/api/billing/checkout/route.ts` - Structured logging + Sentry for billing checkout
- `apps/admin/src/app/api/billing/portal/route.ts` - Structured logging + Sentry for billing portal
- `apps/admin/src/app/api/cron/outreach/route.ts` - Structured logging + Sentry for outreach cron
- `apps/admin/src/app/api/cron/tasks/route.ts` - Structured logging + Sentry for task processing cron
- `apps/admin/src/app/api/org/create/route.ts` - Structured logging + Sentry for org creation
- `packages/shared/src/comms/outreach-processor.ts` - Structured logging for outreach item processing errors
- `packages/shared/src/automations/task-processor.ts` - Structured logging for task DLQ moves and processing errors
- `packages/shared/src/automations/escalation-notifier.ts` - Structured logging for webhook notification failures
- `packages/shared/src/automations/payment-handler.ts` - Structured logging for GHL provisioning errors

## Decisions Made
- Module-level loggers for shared package files since they're called outside request context (no correlation_id available)
- Vapi route uses a separate moduleLog for the handleEndOfCall helper function (outside POST handler scope)
- billing/portal has no request parameter so correlation_id is always generated via crypto.randomUUID()
- Error wrapping pattern (err instanceof Error ? err : new Error(String(err))) for catch blocks with unknown error types in shared package

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Vapi route helper function logger scope**
- **Found during:** Task 1 (Vapi webhook)
- **Issue:** The console.warn in handleEndOfCall is outside the POST handler scope, so it can't access the handler-level `log` variable
- **Fix:** Added module-level `moduleLog` for helper functions, kept handler-level `log` for POST catch block
- **Files modified:** apps/admin/src/app/api/webhooks/vapi/route.ts
- **Verification:** TypeScript compiles, both loggers properly scoped
- **Committed in:** edd16c7 (Task 1 commit)

**2. [Rule 1 - Bug] Payment webhook orgId scope in catch block**
- **Found during:** Task 1 (Payment webhook)
- **Issue:** orgId is declared inside try block, not accessible in catch block for Sentry tagging
- **Fix:** Removed orgId tag from Sentry scope (only correlation_id tagged, which is always available)
- **Files modified:** apps/admin/src/app/api/webhooks/payment/route.ts
- **Verification:** TypeScript compiles, no reference errors
- **Committed in:** edd16c7 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bug fixes for variable scoping)
**Impact on plan:** Both fixes necessary for correct TypeScript compilation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All structured logging in place, ready for rate limiting middleware (07-03) to use the same logger pattern
- Sentry error capture active on all routes, ready for production deployment

## Self-Check: PASSED

All 16 modified files verified present. Both task commits (edd16c7, 425f139) verified in git log. SUMMARY.md created.

---
*Phase: 07-rate-limiting-logging*
*Completed: 2026-03-14*
