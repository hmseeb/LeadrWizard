---
phase: 07-rate-limiting-logging
plan: 01
subsystem: infra
tags: [pino, upstash, redis, sentry, rate-limiting, logging, observability]

# Dependency graph
requires:
  - phase: 01-security-foundation
    provides: rate-limiter module structure and RATE_LIMITS constant
provides:
  - pino logger factory with createRouteLogger for structured JSON logging
  - Upstash Redis-backed rate limiter with sliding window per tier
  - Sentry server/edge/client instrumentation for error tracking
  - global-error.tsx React error boundary
  - next.config.ts pino externalization and Sentry build integration
affects: [07-02-PLAN, 07-03-PLAN, 08-realtime-dashboard]

# Tech tracking
tech-stack:
  added: [pino, pino-pretty, "@upstash/ratelimit", "@upstash/redis", "@sentry/nextjs"]
  patterns: [lazy-redis-init, child-logger-per-route, sliding-window-rate-limit, sentry-instrumentation-hook]

key-files:
  created:
    - packages/shared/src/utils/logger.ts
    - apps/admin/sentry.server.config.ts
    - apps/admin/sentry.edge.config.ts
    - apps/admin/instrumentation.ts
    - apps/admin/instrumentation-client.ts
    - apps/admin/src/app/global-error.tsx
  modified:
    - packages/shared/src/utils/rate-limiter.ts
    - packages/shared/src/utils/index.ts
    - packages/shared/package.json
    - apps/admin/package.json
    - apps/admin/next.config.ts
    - pnpm-lock.yaml

key-decisions:
  - "Lazy Redis init via getRedis() prevents boot crashes when UPSTASH env vars are missing (build time, tests)"
  - "pino-pretty installed as regular dependency (not dev) since pino resolves transport targets at runtime"
  - "Sentry v10 with tunnelRoute /monitoring to bypass ad blockers"
  - "serverExternalPackages at top level (Next.js 15 convention, not under experimental)"

patterns-established:
  - "Lazy singleton: getRedis() pattern for env-dependent services that must not crash at import time"
  - "Child logger factory: createRouteLogger(route, context) produces pino child with baked-in correlation fields"
  - "Per-tier rate limiter: getRateLimiter(tier) returns cached Ratelimit instance with tier-specific prefix"
  - "Sentry instrumentation: register() with runtime-conditional dynamic imports for server vs edge"

requirements-completed: [SEC-06, OBS-01, OBS-02]

# Metrics
duration: 4min
completed: 2026-03-14
---

# Phase 7 Plan 01: Infrastructure Dependencies Summary

**Pino structured logger, Upstash Redis rate limiter with 6 tiers, and Sentry error tracking with server/edge/client instrumentation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-13T22:19:05Z
- **Completed:** 2026-03-13T22:23:46Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Pino logger factory with createRouteLogger producing child loggers with route, correlation_id, org_id, session_id context
- Complete rewrite of rate-limiter.ts from broken in-memory Map to Upstash Redis sliding window with 6 tiers (webhook, api, widget, auth, signup, cron)
- Sentry error tracking with server, edge, and client init, onRequestError hook, and global-error.tsx boundary
- next.config.ts updated with serverExternalPackages for pino and withSentryConfig wrapper

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies and create pino logger factory + Upstash rate limiter** - `1c5e747` (feat)
2. **Task 2: Create Sentry config files, global-error boundary, and update next.config.ts** - `41b6249` (feat)

## Files Created/Modified
- `packages/shared/src/utils/logger.ts` - Pino logger factory with createRouteLogger for structured JSON output
- `packages/shared/src/utils/rate-limiter.ts` - Complete rewrite: Upstash Redis sliding window, lazy init, 6 tiers
- `packages/shared/src/utils/index.ts` - Updated barrel exports: removed checkRateLimit, added logger + new rate-limiter exports
- `packages/shared/package.json` - Added @upstash/ratelimit, @upstash/redis, pino
- `apps/admin/sentry.server.config.ts` - Server-side Sentry.init with DSN and trace sampling
- `apps/admin/sentry.edge.config.ts` - Edge runtime Sentry.init
- `apps/admin/instrumentation.ts` - Next.js instrumentation hook with register() and onRequestError
- `apps/admin/instrumentation-client.ts` - Client-side Sentry.init with replay config
- `apps/admin/src/app/global-error.tsx` - React error boundary capturing to Sentry
- `apps/admin/next.config.ts` - Added serverExternalPackages and withSentryConfig wrapper
- `apps/admin/package.json` - Added @sentry/nextjs and pino-pretty
- `pnpm-lock.yaml` - Updated lockfile

## Decisions Made
- Lazy Redis init via getRedis() prevents boot crashes when UPSTASH env vars are missing (build time, tests)
- pino-pretty installed as regular dependency (not dev) since pino resolves transport targets at runtime via dynamic require
- Sentry v10 with tunnelRoute "/monitoring" to bypass ad blockers on client-side error reporting
- serverExternalPackages placed at top level per Next.js 15 convention (not under experimental)
- replaysOnErrorSampleRate set to 1.0 (capture replay on every error) with replaysSessionSampleRate 0 (no general session recording)

## Deviations from Plan

None - plan executed exactly as written.

## User Setup Required

**External services require manual configuration.** The following environment variables must be set before rate limiting and error tracking will function:

**Upstash Redis (rate limiting):**
- `UPSTASH_REDIS_REST_URL` - from Upstash Console -> Create Redis Database -> REST URL
- `UPSTASH_REDIS_REST_TOKEN` - from Upstash Console -> Create Redis Database -> REST Token

**Sentry (error tracking):**
- `SENTRY_DSN` - from Sentry Dashboard -> Settings -> Client Keys (DSN)
- `NEXT_PUBLIC_SENTRY_DSN` - same DSN, prefixed for client-side access
- `SENTRY_AUTH_TOKEN` - from Sentry Dashboard -> Settings -> Auth Tokens (CI only, for source map upload)
- `SENTRY_ORG` - Organization slug from Sentry Dashboard
- `SENTRY_PROJECT` - Project slug from Sentry Dashboard

All modules gracefully no-op when env vars are unset.

## Next Phase Readiness
- Logger factory ready for 07-02 (replace all 23 console calls with pino structured logging)
- Rate limiter ready for 07-03 (middleware integration for public endpoints)
- Sentry configs ready for 07-02 (error capture enrichment with org_id/session_id tags)

## Self-Check: PASSED

All 9 created/modified files verified present on disk. Both task commits (1c5e747, 41b6249) verified in git history.

---
*Phase: 07-rate-limiting-logging*
*Completed: 2026-03-14*
