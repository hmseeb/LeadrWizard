---
phase: 07-rate-limiting-logging
plan: 03
subsystem: api
tags: [rate-limiting, upstash, redis, middleware, correlation-id, edge-runtime]

requires:
  - phase: 07-01
    provides: getRateLimiter, getTierForPath, Upstash Redis client
provides:
  - Rate limiting enforcement on all public API endpoints via Next.js middleware
  - Correlation ID injection (x-correlation-id) on every request and response
  - 429 responses with Retry-After header for rate-exceeded requests
  - Widget API paths added to auth bypass list
affects: [07-02, 08-deployment]

tech-stack:
  added: []
  patterns: [middleware-first rate limiting, fail-open resilience, correlation ID propagation]

key-files:
  created: []
  modified: [apps/admin/src/middleware.ts]

key-decisions:
  - "Used x-forwarded-for and x-real-ip headers for IP extraction (request.ip not available in NextRequest type)"
  - "Rate limiting runs before Supabase auth to short-circuit early on abuse"
  - "Fail-open on Upstash errors so rate limiter outage never blocks legitimate requests"
  - "Correlation ID set on both request (for downstream handlers) and response (for client debugging)"

patterns-established:
  - "Middleware rate limiting: rate limit check before auth, fail open on error"
  - "Correlation ID propagation: middleware injects, route handlers consume via request headers"

requirements-completed: [SEC-06]

duration: 2min
completed: 2026-03-14
---

# Phase 7 Plan 03: Middleware Rate Limiting Summary

**Upstash Redis rate limiting on public endpoints with per-request correlation ID injection in Edge middleware**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-13T22:27:02Z
- **Completed:** 2026-03-13T22:29:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Rate limiting wired into Next.js middleware for /api/webhooks/, /api/widget/, /api/signup/, /api/cron/ paths
- Correlation ID (crypto.randomUUID()) injected on every request, propagated to response headers
- 429 response with Retry-After, X-RateLimit-Remaining, X-RateLimit-Reset headers on limit exceeded
- Fail-open error handling: Upstash outage or missing env vars never block requests
- Widget API paths (/api/widget) added to auth bypass list for public widget endpoints

## Task Commits

Each task was committed atomically:

1. **Task 1: Add rate limiting and correlation ID injection to middleware** - `c68137c` (feat)

## Files Created/Modified
- `apps/admin/src/middleware.ts` - Rate limiting before auth, correlation ID injection, widget auth bypass

## Decisions Made
- Used `x-forwarded-for` / `x-real-ip` headers instead of `request.ip` (not available on NextRequest in current Next.js types)
- Import from `@leadrwizard/shared/utils` barrel (deep path `utils/rate-limiter` not in package.json exports map)
- Correlation ID included on 429 responses too (not just successful responses)
- Rate limit key format `${tier}:${ip}` gives independent limits per endpoint group per client

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed request.ip TypeScript error**
- **Found during:** Task 1 (Rate limiting implementation)
- **Issue:** Plan used `request.ip` as fallback for IP extraction, but `ip` property does not exist on `NextRequest` type in the project's Next.js version
- **Fix:** Replaced `request.ip` with `request.headers.get("x-real-ip")` as secondary fallback
- **Files modified:** apps/admin/src/middleware.ts
- **Verification:** `tsc --noEmit` passes clean
- **Committed in:** c68137c (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minimal. Same IP extraction behavior, different API surface.

## Issues Encountered
None beyond the request.ip type fix documented above.

## User Setup Required
None - Upstash Redis env vars (UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN) were configured in plan 07-01.

## Next Phase Readiness
- Rate limiting active on all public endpoints, ready for production deployment
- Correlation IDs flowing through middleware for structured logging consumption (07-02)
- Phase 8 deployment can proceed with full rate limiting + logging stack

## Self-Check: PASSED

- FOUND: apps/admin/src/middleware.ts
- FOUND: 07-03-SUMMARY.md
- FOUND: commit c68137c

---
*Phase: 07-rate-limiting-logging*
*Completed: 2026-03-14*
