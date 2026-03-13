# Phase 7: Rate Limiting + Structured Logging - Research

**Researched:** 2026-03-14
**Domain:** Serverless rate limiting, structured logging, error tracking
**Confidence:** HIGH

## Summary

This phase replaces three broken/missing production capabilities: (1) the in-memory rate limiter that resets on every Vercel cold start, (2) bare `console.error` calls scattered across 15+ files with no structure or correlation IDs, and (3) zero error tracking (no Sentry).

The codebase already has a well-structured rate limiter module at `packages/shared/src/utils/rate-limiter.ts` with predefined tiers (webhook: 100/min, api: 60/min, auth: 10/min, cron: 5/min). However, it uses an in-memory `Map` that dies on cold start. The existing `RATE_LIMITS` config and `getRateLimitHeaders()` helper can be preserved as the interface while swapping the backend to Upstash Redis. There are 12 API routes total, 8 of which are public (no auth required) and need rate limiting. Console usage spans 23 call sites across both `apps/admin` API routes and `packages/shared` business logic.

**Primary recommendation:** Install `@upstash/ratelimit` + `@upstash/redis` for rate limiting, `pino` + `pino-pretty` for logging, and `@sentry/nextjs` for error tracking. Create a shared logger in `packages/shared` that all routes and business logic import. Apply rate limiting in Next.js middleware for public routes rather than per-route.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-06 | Rate limiting on all public webhook/widget endpoints using Upstash Redis | @upstash/ratelimit with slidingWindow algorithm, applied via middleware or per-route. Existing RATE_LIMITS tiers preserved. |
| OBS-01 | Structured JSON logging via pino with correlation_id, org_id, session_id on every log line | pino logger in packages/shared with child logger pattern. Middleware injects x-correlation-id header. Replace all 23 console.error/warn/log call sites. |
| OBS-02 | Sentry error tracking with org_id and session_id enrichment tags | @sentry/nextjs with withScope() or captureException({ tags }) pattern in every catch block. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @upstash/ratelimit | ^2.0.8 | Redis-backed rate limiting | Only connectionless (HTTP) rate limiter for serverless. Works on Vercel without TCP. Recommended by Next.js docs. |
| @upstash/redis | ^1.34 | Redis client for Upstash | Required by @upstash/ratelimit. HTTP-based, no connection pooling needed. |
| pino | ^9.6 | Structured JSON logging | Fastest Node.js logger (30x faster than winston). Built-in JSON output, child logger pattern. |
| pino-pretty | ^13.0 | Dev-mode pretty printing | Colorized output for local dev. Production uses raw JSON. |
| @sentry/nextjs | ^9.0 (or latest v10) | Error tracking + performance | Official Sentry SDK for Next.js. Auto-instruments routes, handles App Router. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| crypto (built-in) | Node.js built-in | Generate correlation IDs | `crypto.randomUUID()` in middleware for request correlation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @upstash/ratelimit | Custom Redis lua script | Upstash handles sliding window math, analytics, caching. No reason to hand-roll. |
| pino | winston | Winston is 30x slower, larger bundle. Pino is the standard for serverless. |
| pino | console.log with JSON.stringify | No child loggers, no level filtering, no transport pipeline. |

**Installation (packages/shared):**
```bash
cd packages/shared && pnpm add @upstash/ratelimit @upstash/redis pino
```

**Installation (apps/admin):**
```bash
cd apps/admin && pnpm add @sentry/nextjs pino-pretty
```

**Environment Variables Required:**
```
# Upstash Redis (from Upstash Console)
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxxxx

# Sentry
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_AUTH_TOKEN=sntrys_xxx  # For source map uploads (CI only)
SENTRY_ORG=leadrwizard
SENTRY_PROJECT=admin
```

## Architecture Patterns

### Recommended Project Structure
```
packages/shared/src/
  utils/
    rate-limiter.ts          # REPLACE: Upstash-backed implementation
    logger.ts                # NEW: pino logger factory with child pattern
  index.ts                   # Re-export logger

apps/admin/src/
  middleware.ts              # MODIFY: Add rate limiting + correlation ID injection
  instrumentation.ts         # NEW: Sentry server-side init
  instrumentation-client.ts  # NEW: Sentry client-side init (minimal)
  app/
    global-error.tsx         # NEW: Sentry React error boundary
    api/
      webhooks/stripe/route.ts    # MODIFY: Replace console.error with logger
      webhooks/payment/route.ts   # MODIFY: Replace console.error with logger
      webhooks/twilio/route.ts    # MODIFY: Replace console.error/warn with logger
      webhooks/vapi/route.ts      # MODIFY: Replace console.error/warn with logger
      widget/response/route.ts    # MODIFY: Replace console.error with logger
      widget/session/[sessionId]/route.ts  # MODIFY: Replace console.error with logger
      signup/checkout/route.ts    # MODIFY: Replace console.error with logger
      billing/checkout/route.ts   # MODIFY: Replace console.error with logger
      billing/portal/route.ts     # MODIFY: Replace console.error with logger
      cron/outreach/route.ts      # MODIFY: Replace console.error with logger
      cron/tasks/route.ts         # MODIFY: Replace console.error with logger
      org/create/route.ts         # MODIFY: Replace console.error with logger
  next.config.ts             # MODIFY: Add serverExternalPackages + withSentryConfig
```

### Pattern 1: Shared Logger with Child Pattern
**What:** Single pino instance in `packages/shared`, each route creates a child logger with request context.
**When to use:** Every server-side file that currently uses `console.error/log/warn`.
**Example:**
```typescript
// packages/shared/src/utils/logger.ts
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  // Production: raw JSON, Dev: pretty-print handled by pino-pretty transport
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  }),
});

export type Logger = pino.Logger;

// Factory for route-level child loggers
export function createRouteLogger(
  routeName: string,
  context?: { correlation_id?: string; org_id?: string; session_id?: string }
) {
  return logger.child({ route: routeName, ...context });
}
```

### Pattern 2: Middleware-Based Rate Limiting + Correlation ID
**What:** Next.js middleware checks rate limits for public routes and injects correlation_id header.
**When to use:** Every incoming request to the admin app.
**Example:**
```typescript
// In middleware.ts, before the existing auth logic:
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(100, "60 s"),
  prefix: "leadrwizard:ratelimit",
});

// In the middleware function:
const ip = request.headers.get("x-forwarded-for") ?? request.ip ?? "unknown";
const correlationId = crypto.randomUUID();

// Set correlation ID header for downstream use
request.headers.set("x-correlation-id", correlationId);

// Rate limit public endpoints only
if (isPublicEndpoint(request.nextUrl.pathname)) {
  const { success, remaining, reset } = await ratelimit.limit(
    `${request.nextUrl.pathname}:${ip}`
  );
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "X-RateLimit-Remaining": String(remaining),
          "X-RateLimit-Reset": String(Math.ceil(reset / 1000)),
          "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)),
        },
      }
    );
  }
}
```

### Pattern 3: Sentry Error Capture with Tags
**What:** Every API route catch block captures to Sentry with org_id and session_id tags.
**When to use:** Every existing `catch (error) { console.error(...) }` block.
**Example:**
```typescript
// In any API route catch block:
import * as Sentry from "@sentry/nextjs";
import { createRouteLogger } from "@leadrwizard/shared/utils/logger";

catch (error) {
  const log = createRouteLogger("webhooks/stripe", {
    correlation_id: request.headers.get("x-correlation-id") || undefined,
  });
  log.error({ err: error }, "Stripe webhook error");

  Sentry.withScope((scope) => {
    scope.setTag("org_id", orgId);
    scope.setTag("session_id", sessionId);
    Sentry.captureException(error);
  });

  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
```

### Pattern 4: Per-Tier Rate Limits
**What:** Different rate limits for webhook, widget, signup, and cron endpoints.
**When to use:** Middleware route matching.
**Example:**
```typescript
// Rate limit tiers (preserving existing RATE_LIMITS concept)
const TIERS: Record<string, { requests: number; window: string }> = {
  webhook: { requests: 100, window: "60 s" },  // Stripe/Twilio/Vapi/Payment
  widget:  { requests: 60,  window: "60 s" },  // Widget API
  signup:  { requests: 10,  window: "60 s" },  // Signup checkout
  cron:    { requests: 5,   window: "60 s" },  // Cron endpoints
};

function getTier(pathname: string): string {
  if (pathname.startsWith("/api/webhooks/")) return "webhook";
  if (pathname.startsWith("/api/widget/")) return "widget";
  if (pathname.startsWith("/api/signup/")) return "signup";
  if (pathname.startsWith("/api/cron/")) return "cron";
  return "api"; // default
}
```

### Anti-Patterns to Avoid
- **Rate limiting in each route handler:** Duplicates logic, easy to miss a route. Use middleware.
- **Pino in client components:** Pino is server-only. Never import in React client components.
- **Synchronous headers() in pino hooks:** Next.js 15 `headers()` is async. Use it in the route handler, pass to child logger.
- **Single Ratelimit instance for all tiers:** Create separate Ratelimit instances per tier so limits are independent.
- **Using pino-pretty in production:** It's slow. Only use via transport in development. Production should output raw JSON.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting across serverless instances | In-memory Map (current) | @upstash/ratelimit | In-memory resets on cold start. Already proven broken in prod. |
| Sliding window algorithm | Custom token counting | Ratelimit.slidingWindow() | Edge cases with window boundaries, race conditions. Upstash handles this with Lua scripts. |
| Structured JSON logging | console.log + JSON.stringify | pino | Missing: log levels, child loggers, redaction, transport pipeline, timestamp formatting. |
| Correlation ID propagation | Custom header management | crypto.randomUUID() + middleware header injection | Standardized pattern. UUIDs are guaranteed unique. |
| Error tracking + alerting | Custom error aggregation | @sentry/nextjs | Deduplication, stack traces, release tracking, alerting. Months of work to replicate. |
| Source map upload pipeline | Manual source map management | withSentryConfig() | Automatic during build, no custom CI step needed. |

**Key insight:** The existing in-memory rate limiter is the exact failure mode these libraries are designed to prevent. Every line of custom code here is a liability.

## Common Pitfalls

### Pitfall 1: Middleware Runtime Limitations
**What goes wrong:** Trying to use Node.js-only APIs in Next.js middleware (Edge Runtime by default).
**Why it happens:** Middleware runs in Edge Runtime which doesn't support all Node.js APIs.
**How to avoid:** @upstash/ratelimit and @upstash/redis are designed for Edge Runtime (HTTP-only, no TCP). pino should NOT be used in middleware. Only use it in API routes (Node.js runtime). Generate correlation IDs with `crypto.randomUUID()` which works in Edge.
**Warning signs:** "Module not found" errors mentioning Node.js built-ins.

### Pitfall 2: pino-pretty in Production
**What goes wrong:** Pretty-printing in production causes 10x performance hit and breaks log aggregator JSON parsing.
**Why it happens:** Forgetting to conditionally apply the transport.
**How to avoid:** Use `process.env.NODE_ENV !== "production"` guard around transport config. Production gets raw JSON.
**Warning signs:** Logs not appearing in Datadog/Grafana, slow API responses.

### Pitfall 3: serverExternalPackages Configuration
**What goes wrong:** pino fails with "Cannot find module" errors in Next.js bundling.
**Why it happens:** Next.js bundles server code by default. Pino uses dynamic requires for transports.
**How to avoid:** Add to `next.config.ts`: `serverExternalPackages: ["pino", "pino-pretty"]`. In Next.js 15 this is a top-level config option (NOT under `experimental`).
**Warning signs:** Build errors about `pino/file`, `pino-pretty`, or `thread-stream`.

### Pitfall 4: Missing Sentry.flush() in Serverless
**What goes wrong:** Errors captured but never sent to Sentry because the function terminates before the HTTP request completes.
**Why it happens:** Serverless functions terminate immediately after response is sent.
**How to avoid:** `@sentry/nextjs` handles this automatically for API routes. But if using custom async patterns, call `await Sentry.flush(2000)` before returning.
**Warning signs:** Errors appear in logs but not in Sentry dashboard.

### Pitfall 5: Rate Limiting Key Selection
**What goes wrong:** Using only IP for rate limiting causes false positives behind shared NATs/proxies.
**Why it happens:** Many clients share a single IP (corporate networks, mobile carriers).
**How to avoid:** For webhook endpoints, use `pathname:ip` as the key. For widget API, consider `sessionId:ip` to be more granular. For authenticated routes, use `userId` or `orgId`.
**Warning signs:** Legitimate webhook retries from Stripe getting 429'd.

### Pitfall 6: Forgetting to Handle ratelimit.limit() pending Promise
**What goes wrong:** Analytics data not written, or function terminates before async work completes.
**Why it happens:** The `pending` field in the response is a Promise for background work (analytics).
**How to avoid:** On Vercel, use `context.waitUntil(result.pending)` if available, or just `await result.pending`. For basic usage without analytics, this is not critical.
**Warning signs:** Missing analytics data in Upstash dashboard.

## Code Examples

### Complete Rate Limiter Module (replaces packages/shared/src/utils/rate-limiter.ts)
```typescript
// packages/shared/src/utils/rate-limiter.ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Lazy initialization to avoid errors when env vars aren't set (e.g., build time)
let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    redis = Redis.fromEnv();
  }
  return redis;
}

export const RATE_LIMITS = {
  webhook: { requests: 100, window: "60 s" as const },
  api:     { requests: 60,  window: "60 s" as const },
  widget:  { requests: 60,  window: "60 s" as const },
  auth:    { requests: 10,  window: "60 s" as const },
  signup:  { requests: 10,  window: "60 s" as const },
  cron:    { requests: 5,   window: "60 s" as const },
} as const;

type RateLimitTier = keyof typeof RATE_LIMITS;

const limiters = new Map<string, Ratelimit>();

export function getRateLimiter(tier: RateLimitTier): Ratelimit {
  if (!limiters.has(tier)) {
    const config = RATE_LIMITS[tier];
    limiters.set(
      tier,
      new Ratelimit({
        redis: getRedis(),
        limiter: Ratelimit.slidingWindow(config.requests, config.window),
        prefix: `leadrwizard:ratelimit:${tier}`,
        analytics: true,
      })
    );
  }
  return limiters.get(tier)!;
}

export function getTierForPath(pathname: string): RateLimitTier {
  if (pathname.startsWith("/api/webhooks/")) return "webhook";
  if (pathname.startsWith("/api/widget/")) return "widget";
  if (pathname.startsWith("/api/signup/")) return "signup";
  if (pathname.startsWith("/api/cron/")) return "cron";
  return "api";
}
```

### Complete Logger Module
```typescript
// packages/shared/src/utils/logger.ts
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  }),
});

export type Logger = pino.Logger;

export function createRouteLogger(
  route: string,
  context?: {
    correlation_id?: string;
    org_id?: string;
    session_id?: string;
  }
) {
  return logger.child({
    route,
    ...context,
  });
}
```

### Middleware Integration
```typescript
// In middleware.ts, add before auth logic:
import { getRateLimiter, getTierForPath } from "@leadrwizard/shared/utils/rate-limiter";

const PUBLIC_RATE_LIMITED_PREFIXES = [
  "/api/webhooks/",
  "/api/widget/",
  "/api/signup/",
  "/api/cron/",
];

function isRateLimited(pathname: string): boolean {
  return PUBLIC_RATE_LIMITED_PREFIXES.some((p) => pathname.startsWith(p));
}

// Inside middleware function:
const correlationId = crypto.randomUUID();
// Attach to request headers for downstream route handlers
request.headers.set("x-correlation-id", correlationId);

if (isRateLimited(request.nextUrl.pathname)) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.ip
    ?? "unknown";
  const tier = getTierForPath(request.nextUrl.pathname);
  const limiter = getRateLimiter(tier);
  const { success, remaining, reset } = await limiter.limit(
    `${tier}:${ip}`
  );

  if (!success) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(reset / 1000)),
        },
      }
    );
  }
  // Add rate limit headers to successful responses too
  supabaseResponse.headers.set("X-RateLimit-Remaining", String(remaining));
  supabaseResponse.headers.set("X-RateLimit-Reset", String(Math.ceil(reset / 1000)));
}
```

### Sentry Setup Files
```typescript
// apps/admin/instrumentation.ts
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
```

```typescript
// apps/admin/sentry.server.config.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  environment: process.env.NODE_ENV || "development",
});
```

```typescript
// apps/admin/sentry.edge.config.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  environment: process.env.NODE_ENV || "development",
});
```

### Route Handler Pattern (replacing console.error)
```typescript
// Example: apps/admin/src/app/api/webhooks/stripe/route.ts
import * as Sentry from "@sentry/nextjs";
import { createRouteLogger } from "@leadrwizard/shared/utils/logger";

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") || crypto.randomUUID();
  const log = createRouteLogger("webhooks/stripe", { correlation_id: correlationId });

  try {
    // ... existing logic ...
    log.info({ event_id: event.id }, "Stripe webhook processed");
    return NextResponse.json({ received: true });
  } catch (error) {
    log.error({ err: error }, "Stripe webhook error");
    Sentry.withScope((scope) => {
      scope.setTag("correlation_id", correlationId);
      // Set org_id/session_id if available from the request context
      Sentry.captureException(error);
    });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
```

## Inventory: All Console Usage to Replace

### API Routes (apps/admin/src/app/api/)
| File | Line | Current Code | Context Available |
|------|------|-------------|-------------------|
| webhooks/stripe/route.ts | 72 | `console.error("Stripe webhook error:", error)` | event.id |
| webhooks/payment/route.ts | 97 | `console.error("Payment webhook error:", error)` | orgId, payload |
| webhooks/twilio/route.ts | 37 | `console.warn("Invalid Twilio signature")` | - |
| webhooks/twilio/route.ts | 54 | `console.warn("Inbound SMS from unknown number")` | sms.from |
| webhooks/twilio/route.ts | 104 | `console.error("Twilio webhook error:", error)` | - |
| webhooks/vapi/route.ts | 54 | `console.error("Vapi webhook error:", error)` | - |
| webhooks/vapi/route.ts | 71 | `console.warn("Vapi end-of-call missing...")` | - |
| widget/response/route.ts | 145 | `console.error("Widget response error:", error)` | sessionId |
| widget/session/[sessionId]/route.ts | 211 | `console.error("Widget session load error:", error)` | sessionId |
| signup/checkout/route.ts | 59 | `console.error("Signup checkout error:", error)` | email |
| billing/checkout/route.ts | 38 | `console.error("Checkout error:", error)` | user.id |
| billing/portal/route.ts | 34 | `console.error("Portal error:", error)` | user.id |
| cron/outreach/route.ts | 32 | `console.error("Outreach cron error:", error)` | - |
| cron/tasks/route.ts | 32 | `console.error("Service task processing error:", error)` | - |
| org/create/route.ts | 54 | `console.error("Org creation error:", error)` | user.id |

### Shared Package (packages/shared/src/)
| File | Line | Current Code | Context Available |
|------|------|-------------|-------------------|
| comms/outreach-processor.ts | 42 | `console.error("Failed to process outreach item...")` | item.id |
| automations/task-processor.ts | 38 | `console.error("Cannot move task to DLQ...")` | task.id |
| automations/task-processor.ts | 85 | `console.error("Failed to create escalation...")` | task.id |
| automations/task-processor.ts | 204 | `console.error("Failed to process task...")` | task.id, task_type |
| automations/escalation-notifier.ts | 126 | `console.warn("No escalation webhook configured...")` | - |
| automations/escalation-notifier.ts | 236 | `console.error("Slack notification failed...")` | response.status |
| automations/escalation-notifier.ts | 351 | `console.error("Google Chat notification failed...")` | response.status |
| automations/payment-handler.ts | 129 | `console.error("GHL provisioning failed...")` | err.message |

**Total: 23 call sites** (15 in API routes, 8 in shared package)

## Endpoints Requiring Rate Limiting

| Endpoint | Method | Auth? | Tier | Key Strategy |
|----------|--------|-------|------|-------------|
| /api/webhooks/stripe | POST | Signature | webhook | `webhook:ip` |
| /api/webhooks/payment | POST | API Key | webhook | `webhook:ip` |
| /api/webhooks/twilio | POST | Signature | webhook | `webhook:ip` |
| /api/webhooks/vapi | POST | None* | webhook | `webhook:ip` |
| /api/widget/response | POST | Session validation | widget | `widget:ip` |
| /api/widget/session/[id] | GET | None (public) | widget | `widget:ip` |
| /api/signup/checkout | POST | None (public) | signup | `signup:ip` |
| /api/cron/outreach | GET | CRON_SECRET | cron | `cron:ip` |
| /api/cron/tasks | POST | CRON_SECRET | cron | `cron:ip` |
| /api/billing/checkout | POST | Auth (user) | api | Not rate limited (behind auth) |
| /api/billing/portal | POST | Auth (user) | api | Not rate limited (behind auth) |
| /api/org/create | POST | Auth (user) | api | Not rate limited (behind auth) |

*Vapi webhook has no signature verification currently. Should be rate limited regardless.

**Public endpoints needing rate limiting: 9**
**Authenticated endpoints (skip rate limiting): 3**

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `experimental.serverComponentsExternalPackages` | `serverExternalPackages` (top-level) | Next.js 15 | Must use new config key for pino |
| sentry.client.config.ts | instrumentation-client.ts | @sentry/nextjs v8+ | New file naming convention |
| sentry.server.config.ts (auto-loaded) | instrumentation.ts + import | @sentry/nextjs v8+ | Explicit registration via Next.js instrumentation hook |
| In-memory rate limiting | Redis-backed (@upstash/ratelimit) | Industry standard for serverless | Broken in-memory approach was never correct for Vercel |

## next.config.ts Changes

```typescript
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  transpilePackages: ["@leadrwizard/shared"],
  serverExternalPackages: ["pino", "pino-pretty"],
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  // Only upload source maps in CI
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Tunnel Sentry events through the app to avoid ad-blockers
  tunnelRoute: "/monitoring",
});
```

## Open Questions

1. **Upstash Redis instance**
   - What we know: Upstash offers a free tier with 10K requests/day which is sufficient for dev/staging
   - What's unclear: Whether the project already has an Upstash account set up
   - Recommendation: Create a free Upstash Redis database. The env vars can be added later; code should gracefully degrade if not set.

2. **Sentry project creation**
   - What we know: Sentry has a free tier sufficient for this project
   - What's unclear: Whether a Sentry account/project exists
   - Recommendation: Code should work with or without SENTRY_DSN set. When absent, Sentry.init() becomes a no-op.

3. **Widget app (apps/widget) logging**
   - What we know: The widget is a Vite React app (client-side only). It has one `console.log` in main.tsx.
   - What's unclear: Whether widget-side logging is in scope
   - Recommendation: Out of scope for OBS-01. Widget is client-only; pino is server-only. The single console.log can be left or removed separately.

4. **Rate limit edge case: Stripe retries**
   - What we know: Stripe retries webhooks on 5xx. A 429 is not 5xx but Stripe may interpret it poorly.
   - Recommendation: Set webhook tier to 100 req/min which is generous. Stripe's retry logic sends at most ~16 retries over 3 days, well within limits.

## Sources

### Primary (HIGH confidence)
- [@upstash/ratelimit GitHub](https://github.com/upstash/ratelimit-js) - API, algorithms, response types
- [Upstash Ratelimit Docs](https://upstash.com/docs/redis/sdks/ratelimit-ts/overview) - Getting started, methods
- [Sentry Next.js Manual Setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/) - File structure, init patterns
- [Sentry APIs](https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/apis/) - setTag, withScope, captureException
- [Next.js serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) - Config key naming

### Secondary (MEDIUM confidence)
- [Arcjet Blog: Structured logging for Next.js](https://blog.arcjet.com/structured-logging-in-json-for-next-js/) - pino + Next.js patterns
- [SigNoz: Pino Logger Guide](https://signoz.io/guides/pino-logger/) - pino API reference
- [Upstash Blog: Rate Limiting Next.js](https://upstash.com/blog/nextjs-ratelimiting) - Next.js integration patterns

### Tertiary (LOW confidence)
- [pino-nextjs-example](https://github.com/pinojs/pino-nextjs-example) - Uses Pages Router (older pattern), but child logger concept applies

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All three libraries are the industry standard for their domain in the Next.js/Vercel ecosystem
- Architecture: HIGH - Patterns verified against official docs and multiple production examples
- Pitfalls: HIGH - Based on known Next.js 15 breaking changes (serverExternalPackages rename) and documented pino bundling issues
- Console inventory: HIGH - Exact grep of codebase, all 23 call sites enumerated

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable libraries, unlikely to change significantly)
