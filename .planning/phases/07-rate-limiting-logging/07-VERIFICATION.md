---
phase: 07-rate-limiting-logging
verified: 2026-03-14T12:00:00Z
status: gaps_found
score: 1/3 success criteria verified
gaps:
  - truth: "Every server log line includes correlation_id, org_id, and session_id in structured JSON"
    status: failed
    reason: "All 12 API routes pass only { correlation_id } to createRouteLogger. org_id and session_id are never provided despite the logger factory supporting them."
    artifacts:
      - path: "apps/admin/src/app/api/webhooks/stripe/route.ts"
        issue: "createRouteLogger('webhooks/stripe', { correlation_id: correlationId }) -- missing org_id, session_id"
      - path: "apps/admin/src/app/api/webhooks/payment/route.ts"
        issue: "Same pattern -- orgId is resolved inside try block but never passed to logger"
      - path: "apps/admin/src/app/api/widget/response/route.ts"
        issue: "Same pattern -- session.org_id available after DB lookup but never passed to logger"
      - path: "apps/admin/src/app/api/widget/session/[sessionId]/route.ts"
        issue: "Same pattern -- session.org_id available but not passed to logger. Also does not read x-correlation-id from middleware header."
      - path: "apps/admin/src/app/api/billing/portal/route.ts"
        issue: "Same pattern. Also does not read x-correlation-id from middleware header."
    missing:
      - "After resolving org_id / session_id from DB or auth context, re-bind logger with log = log.child({ org_id, session_id }) so all subsequent log lines carry these fields"
      - "Two routes (widget/session, billing/portal) must read x-correlation-id from request.headers instead of always generating a new UUID"
  - truth: "An unhandled error in any API route is captured in Sentry with org_id and session_id attached as tags"
    status: partial
    reason: "Sentry.captureException is called in all 12 routes via Sentry.withScope, but every scope only sets scope.setTag('correlation_id', ...). org_id and session_id are never set as Sentry tags."
    artifacts:
      - path: "apps/admin/src/app/api/webhooks/stripe/route.ts"
        issue: "scope.setTag only sets correlation_id, not org_id or session_id"
      - path: "apps/admin/src/app/api/webhooks/payment/route.ts"
        issue: "orgId resolved in try block but catch block only tags correlation_id"
      - path: "apps/admin/src/app/api/widget/response/route.ts"
        issue: "session.org_id and sessionId available but not tagged in Sentry scope"
      - path: "apps/admin/src/app/api/org/create/route.ts"
        issue: "user.id available but org_id/session_id not tagged"
    missing:
      - "In each catch block's Sentry.withScope, add scope.setTag('org_id', orgId) and scope.setTag('session_id', sessionId) where these values are available"
      - "For routes where org_id/session_id are resolved inside try (e.g. payment webhook), declare variables before try so they're accessible in catch"
---

# Phase 7: Rate Limiting + Structured Logging Verification Report

**Phase Goal:** All public endpoints have production-grade rate limiting that persists across serverless cold starts, and every log line carries correlation IDs for debugging.
**Verified:** 2026-03-14T12:00:00Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Making more than the configured number of requests to a webhook or widget API endpoint within the window returns 429, holding across multiple Vercel function instances | VERIFIED | Rate limiter uses @upstash/ratelimit with Redis sliding window (not in-memory Map). Middleware at apps/admin/src/middleware.ts checks rate limits before auth, returns 429 with Retry-After, X-RateLimit-Remaining, X-RateLimit-Reset headers. Fail-open on Upstash errors. |
| 2 | Every server log line includes correlation_id, org_id, and session_id in structured JSON, no bare console.error calls remain | FAILED | Zero console.error/warn/log calls remain (verified via grep). All 12 API routes use pino via createRouteLogger. However, ALL routes pass ONLY { correlation_id } to createRouteLogger. org_id and session_id are NEVER included in log context despite the factory supporting them. Additionally, 2 routes (widget/session, billing/portal) generate new UUIDs instead of reading the middleware-injected x-correlation-id header. |
| 3 | An unhandled error in any API route is captured in Sentry with org_id and session_id attached as tags | PARTIAL | Sentry.captureException is called in all 12 route catch blocks via Sentry.withScope. BUT every scope only tags correlation_id. No route sets org_id or session_id as Sentry tags. The infrastructure (Sentry SDK, instrumentation, global-error boundary) is correctly wired. |

**Score:** 1/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/shared/src/utils/logger.ts` | Pino logger factory with createRouteLogger | VERIFIED | 25 lines. Exports logger singleton and createRouteLogger(route, context) producing child loggers. Supports correlation_id, org_id, session_id in context param. |
| `packages/shared/src/utils/rate-limiter.ts` | Upstash Redis-backed rate limiter | VERIFIED | 59 lines. Uses @upstash/ratelimit with lazy Redis init, sliding window, 6 tiers (webhook, api, widget, auth, signup, cron), getTierForPath helper, getRateLimitHeaders. |
| `apps/admin/src/middleware.ts` | Rate limiting + correlation ID injection | VERIFIED | 113 lines. Rate limits /api/webhooks/, /api/widget/, /api/signup/, /api/cron/ paths. Generates correlation ID, sets on request and response headers. Returns 429 with Retry-After. Fail-open on Upstash errors. |
| `apps/admin/instrumentation.ts` | Sentry instrumentation hook | VERIFIED | 13 lines. register() with runtime-conditional imports for server/edge. onRequestError = Sentry.captureRequestError. |
| `apps/admin/sentry.server.config.ts` | Sentry server init | VERIFIED | 8 lines. Sentry.init with DSN, trace sampling, environment. |
| `apps/admin/sentry.edge.config.ts` | Sentry edge init | VERIFIED | 8 lines. Same pattern as server config. |
| `apps/admin/instrumentation-client.ts` | Sentry client init | VERIFIED | 10 lines. Sentry.init with DSN, trace sampling, replaysOnErrorSampleRate: 1.0. |
| `apps/admin/src/app/global-error.tsx` | React error boundary | VERIFIED | 43 lines. Captures to Sentry via useEffect, renders error UI with reset button. |
| `apps/admin/next.config.ts` | serverExternalPackages + withSentryConfig | VERIFIED | 16 lines. serverExternalPackages: ["pino", "pino-pretty"]. withSentryConfig wrapper with tunnelRoute "/monitoring". |
| `packages/shared/src/utils/index.ts` | Barrel exports for logger + rate-limiter | VERIFIED | Exports createRouteLogger, logger, Logger, getRateLimiter, getTierForPath, getRateLimitHeaders, RATE_LIMITS, RateLimitTier. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| middleware.ts | rate-limiter.ts | import { getRateLimiter, getTierForPath } from @leadrwizard/shared/utils | WIRED | Middleware calls getRateLimiter(tier).limit() and uses getTierForPath(pathname) |
| All 12 API routes | logger.ts | import { createRouteLogger } from @leadrwizard/shared/utils | WIRED | Every route creates child logger with correlation_id |
| All 12 API routes | @sentry/nextjs | import * as Sentry + Sentry.withScope + Sentry.captureException | WIRED | Every catch block calls both log.error and Sentry.captureException |
| 4 shared modules | logger.ts | import { createRouteLogger } from ../utils/logger | WIRED | Module-level loggers created |
| next.config.ts | @sentry/nextjs | import { withSentryConfig } + wraps config | WIRED | Config wrapped with Sentry build integration |
| instrumentation.ts | sentry.server.config.ts / sentry.edge.config.ts | dynamic import in register() | WIRED | Runtime-conditional imports based on NEXT_RUNTIME |
| global-error.tsx | @sentry/nextjs | Sentry.captureException(error) in useEffect | WIRED | Error boundary captures unhandled React errors |
| middleware.ts -> route handlers | x-correlation-id header | request.headers.set / request.headers.get | PARTIAL | Middleware sets header. 10/12 routes read it. 2 routes (widget/session, billing/portal) ignore it and generate new UUIDs. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SEC-06 | 07-01, 07-03 | Rate limiting on all public webhook/widget endpoints via Upstash Redis | SATISFIED | @upstash/ratelimit with Redis sliding window. Middleware enforces on /api/webhooks/, /api/widget/, /api/signup/, /api/cron/. Returns 429 with Retry-After. Persists across cold starts. |
| OBS-01 | 07-01, 07-02 | Structured JSON logging with correlation_id, org_id, session_id on every log line | NOT SATISFIED | Pino structured logging is in place across all routes and modules. correlation_id is included. But org_id and session_id are never passed to createRouteLogger by any route handler. |
| OBS-02 | 07-01, 07-02 | Sentry error tracking with org_id and session_id enrichment tags | NOT SATISFIED | Sentry.captureException called in all 12 routes. But only correlation_id is tagged via scope.setTag. org_id and session_id are never set as Sentry tags. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| apps/admin/src/app/api/widget/session/[sessionId]/route.ts | 41 | Always generates new UUID instead of reading x-correlation-id header | Warning | Breaks correlation chain from middleware for this route |
| apps/admin/src/app/api/billing/portal/route.ts | 12 | Always generates new UUID instead of reading x-correlation-id header | Warning | Breaks correlation chain from middleware for this route |

No TODO/FIXME/PLACEHOLDER comments found. No empty implementations. No console calls remaining.

### Human Verification Required

### 1. Rate Limiting 429 Response Under Load

**Test:** Deploy to Vercel with Upstash Redis configured. Send more than 100 requests to /api/webhooks/stripe within 60 seconds from same IP.
**Expected:** Requests beyond limit return 429 with JSON body { error: "Too many requests" } and Retry-After header. Subsequent requests after window expires should succeed.
**Why human:** Requires live Upstash Redis instance and actual HTTP traffic to verify sliding window behavior across serverless instances.

### 2. Sentry Error Visibility in Dashboard

**Test:** Trigger an unhandled error in any API route (e.g., invalid Stripe webhook signature with missing env var). Check Sentry dashboard.
**Expected:** Error appears with correlation_id tag visible. (Once gaps are fixed: org_id and session_id tags also visible.)
**Why human:** Requires live Sentry DSN and dashboard access to verify error capture and tag visibility.

### 3. Structured Log Output in Production

**Test:** Deploy and trigger an API route. Check Vercel function logs or log drain.
**Expected:** Log lines are structured JSON with route, correlation_id fields (and once fixed, org_id, session_id).
**Why human:** Requires deployment environment to verify pino JSON output format in production mode.

### Gaps Summary

Two of three success criteria are not met due to a single root cause: **org_id and session_id are never propagated to either the pino logger context or Sentry tags.**

The infrastructure is correctly built. The logger factory accepts org_id and session_id. Sentry.withScope is called in every catch block. But the actual values are never provided.

**Root cause:** During the console-to-pino migration (07-02), the implementation focused on replacing console calls with pino + Sentry but only wired correlation_id. The org_id and session_id fields were declared in the logger factory interface but never populated by callers.

**Specific issues:**
1. All 12 API route createRouteLogger calls pass only `{ correlation_id }`, never `org_id` or `session_id`
2. All 12 Sentry.withScope blocks only call `scope.setTag("correlation_id", ...)`, never setting org_id or session_id
3. In routes where org_id is resolved inside the try block (e.g., payment webhook resolves orgId), the variable is scoped to the try block and inaccessible in the catch block for Sentry tagging
4. Two routes (widget/session, billing/portal) don't read the middleware-injected x-correlation-id header, generating fresh UUIDs instead

**Fix complexity:** Low. Each route handler needs:
- After resolving org_id/session_id from DB/auth, re-bind logger: `log = log.child({ org_id, session_id })`
- In Sentry.withScope, add `scope.setTag("org_id", orgId)` and `scope.setTag("session_id", sessionId)`
- Declare org_id/session_id variables before the try block so they're accessible in catch
- Two routes need to read x-correlation-id from request headers

---

_Verified: 2026-03-14T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
