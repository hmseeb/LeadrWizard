# Phase 7: Rate Limiting + Structured Logging - Research

**Researched:** 2026-03-14
**Domain:** Serverless rate limiting, structured logging, error tracking
**Confidence:** HIGH

## Summary

This phase replaces three broken or missing production capabilities: (1) the in-memory rate limiter at `packages/shared/src/utils/rate-limiter.ts` that uses a `Map` which resets on every Vercel cold start, making it non-functional in production, (2) bare `console.error` calls scattered across 23 call sites in 16 files with no structure, correlation IDs, or queryability, and (3) zero error tracking (no Sentry integration exists).

The codebase has a well-structured rate limiter module with predefined tiers (webhook: 100/min, api: 60/min, auth: 10/min, cron: 5/min) and helper functions (`getRateLimitHeaders`, `RATE_LIMITS`). The interface is sound but the backend is broken. There are 12 API route handlers total, 9 of which are public-facing and need rate limiting. The existing middleware.ts handles auth only and runs on Edge Runtime, which constrains library choices (pino does NOT work in Edge, but @upstash/ratelimit does).

**Primary recommendation:** Install `@upstash/ratelimit` + `@upstash/redis` for rate limiting (applied in middleware), `pino` for structured logging (used in API route handlers and shared package only, NOT in middleware), and `@sentry/nextjs` for error tracking. Rate limiting goes in middleware (Edge Runtime compatible). Logging goes in route handlers and shared business logic (Node.js runtime only). Sentry captures unhandled errors automatically via `onRequestError` hook plus manual `captureException` in catch blocks with org_id/session_id tags.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-06 | Rate limiting on all public webhook/widget endpoints using Upstash Redis | @upstash/ratelimit v2.0.8 with slidingWindow algorithm, applied in Next.js middleware for 9 public endpoints. Preserves existing RATE_LIMITS tier concept. Upstash Redis is HTTP-based, works in Edge Runtime. |
| OBS-01 | Structured JSON logging via pino with correlation_id, org_id, session_id on every log line | pino v10.3.1 logger created in packages/shared, child logger pattern per route. Middleware injects x-correlation-id header (crypto.randomUUID()). All 23 console.error/warn/log call sites replaced across 16 files. |
| OBS-02 | Sentry error tracking with org_id and session_id enrichment tags | @sentry/nextjs (latest) with instrumentation.ts, sentry.server.config.ts, global-error.tsx. Per-route Sentry.withScope() sets org_id + session_id tags before captureException. onRequestError hook catches unhandled errors. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @upstash/ratelimit | 2.0.8 | Redis-backed rate limiting for serverless | Only connectionless (HTTP) rate limiter for serverless. Works in Vercel Edge + Node.js. Official Vercel template endorsement. Released Jan 2026. |
| @upstash/redis | ^1.37.0 | Redis HTTP client (peer dep of ratelimit) | HTTP-based, no TCP connection pooling. Required by @upstash/ratelimit. Works in Edge Runtime. |
| pino | 10.3.1 | Structured JSON logging | Fastest Node.js logger (~5x faster than alternatives). JSON by default. Child logger pattern for per-request context. 9,000+ npm dependents. |
| pino-pretty | latest | Dev-mode pretty printing | Colorized terminal output. Do NOT use in production. Dev-only dependency. |
| @sentry/nextjs | latest (v9/v10 series) | Error tracking + performance monitoring | Official Sentry SDK for Next.js. Auto-instruments API routes via onRequestError hook. Handles App Router natively. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| crypto (Node.js built-in) | Built-in | Generate correlation IDs | `crypto.randomUUID()` in middleware. Works in both Edge and Node.js runtimes. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @upstash/ratelimit | Custom Supabase-backed rate limiting | Supabase adds ~50ms per rate limit check (full DB round trip). Upstash Redis is ~1-5ms. Not worth the latency. |
| @upstash/ratelimit | ioredis / node-redis | Require persistent TCP connections, incompatible with Vercel serverless / Edge Runtime. |
| pino | winston | Winston is ~5x slower, not JSON-first, heavier bundle. Not the ecosystem choice for serverless. |
| pino | console.log + JSON.stringify | No child loggers, no level filtering, no transport pipeline, no redaction. |
| @sentry/nextjs | Custom error webhook to Slack | No deduplication, no stack traces, no release tracking, no alerting rules, no search/filter. |

**Installation:**
```bash
# Rate limiting (in packages/shared so middleware can import)
pnpm add @upstash/ratelimit@2.0.8 @upstash/redis --filter @leadrwizard/shared

# Logging (in packages/shared for cross-package use)
pnpm add pino@10.3.1 --filter @leadrwizard/shared

# Sentry + dev logging (in apps/admin)
pnpm add @sentry/nextjs --filter @leadrwizard/admin
pnpm add -D pino-pretty --filter @leadrwizard/admin
```

**Environment Variables Required:**
```
# Upstash Redis (from Upstash Console after creating a free database)
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxxxx

# Sentry (from Sentry project settings)
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_AUTH_TOKEN=sntrys_xxx  # CI only, for source map uploads
SENTRY_ORG=leadrwizard
SENTRY_PROJECT=admin

# Logging
LOG_LEVEL=info  # debug in dev, info in prod
```

## Architecture Patterns

### Recommended Project Structure
```
packages/shared/src/
  logger/
    index.ts                 # NEW: pino logger factory + child logger pattern
  utils/
    rate-limiter.ts          # REPLACE: Upstash-backed implementation (replaces in-memory Map)
    index.ts                 # MODIFY: Update exports (remove old rate limiter types if needed)
  index.ts                   # MODIFY: Re-export logger

apps/admin/src/
  middleware.ts              # MODIFY: Add rate limiting + correlation ID injection
  instrumentation.ts         # NEW: Sentry server registration + onRequestError hook
  instrumentation-client.ts  # NEW: Sentry client-side init (minimal, DSN only)
  sentry.server.config.ts    # NEW: Sentry server-side init
  sentry.edge.config.ts      # NEW: Sentry edge runtime init
  app/
    global-error.tsx         # NEW: React error boundary for Sentry
    api/
      webhooks/stripe/route.ts        # MODIFY: logger + Sentry
      webhooks/payment/route.ts       # MODIFY: logger + Sentry
      webhooks/twilio/route.ts        # MODIFY: logger + Sentry
      webhooks/vapi/route.ts          # MODIFY: logger + Sentry
      widget/response/route.ts        # MODIFY: logger + Sentry
      widget/session/[sessionId]/route.ts  # MODIFY: logger + Sentry
      signup/checkout/route.ts        # MODIFY: logger + Sentry
      billing/checkout/route.ts       # MODIFY: logger + Sentry
      billing/portal/route.ts         # MODIFY: logger + Sentry
      cron/outreach/route.ts          # MODIFY: logger + Sentry
      cron/tasks/route.ts             # MODIFY: logger + Sentry
      org/create/route.ts             # MODIFY: logger + Sentry
  next.config.ts             # MODIFY: serverExternalPackages + withSentryConfig
```

### Pattern 1: Shared Logger with Child Logger Pattern
**What:** Single pino instance in `packages/shared`, each route creates a child logger with request context (correlation_id, org_id, session_id).
**When to use:** Every server-side file that currently uses `console.error/log/warn`.
**Example:**
```typescript
// packages/shared/src/logger/index.ts
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  // pino-pretty only in dev. Production outputs raw JSON for log aggregators.
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  }),
});

export type Logger = pino.Logger;

/**
 * Creates a child logger with route context.
 * correlation_id comes from x-correlation-id header set by middleware.
 * org_id and session_id come from route-level resolution.
 */
export function createRouteLogger(
  route: string,
  context?: {
    correlation_id?: string;
    org_id?: string;
    session_id?: string;
  }
): pino.Logger {
  return logger.child({ route, ...context });
}
```

### Pattern 2: Middleware Rate Limiting + Correlation ID Injection
**What:** Next.js middleware checks rate limits for public routes and injects a correlation_id header for downstream route handlers.
**When to use:** Every incoming request.
**Critical:** @upstash/ratelimit works in Edge Runtime (HTTP-based). pino does NOT work in Edge Runtime. Rate limiting in middleware, logging in route handlers.
**Example:**
```typescript
// In middleware.ts, before existing auth logic:
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Lazy init to avoid errors when env vars aren't set at build time
let ratelimiters: Record<string, Ratelimit> | null = null;

function getRateLimiters() {
  if (!ratelimiters && process.env.UPSTASH_REDIS_REST_URL) {
    const redis = Redis.fromEnv();
    ratelimiters = {
      webhook: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(100, "60 s"),
        prefix: "lw:rl:webhook",
      }),
      widget: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(60, "60 s"),
        prefix: "lw:rl:widget",
      }),
      signup: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(10, "60 s"),
        prefix: "lw:rl:signup",
      }),
      cron: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, "60 s"),
        prefix: "lw:rl:cron",
      }),
    };
  }
  return ratelimiters;
}

const RATE_LIMITED_PREFIXES: Record<string, string> = {
  "/api/webhooks/": "webhook",
  "/api/widget/": "widget",
  "/api/signup/": "signup",
  "/api/cron/": "cron",
};

function getRateLimitTier(pathname: string): string | null {
  for (const [prefix, tier] of Object.entries(RATE_LIMITED_PREFIXES)) {
    if (pathname.startsWith(prefix)) return tier;
  }
  return null;
}

// Inside middleware function, FIRST thing:
const correlationId = crypto.randomUUID();
request.headers.set("x-correlation-id", correlationId);

const tier = getRateLimitTier(request.nextUrl.pathname);
if (tier) {
  const limiters = getRateLimiters();
  if (limiters?.[tier]) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? request.ip
      ?? "unknown";
    const { success, remaining, reset } = await limiters[tier].limit(
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
  }
}
```

### Pattern 3: Sentry Error Capture with Per-Request Tags
**What:** Every API route catch block captures to Sentry with org_id and session_id tags using withScope.
**When to use:** Every existing `catch (error) { console.error(...) }` block.
**Example:**
```typescript
import * as Sentry from "@sentry/nextjs";
import { createRouteLogger } from "@leadrwizard/shared/logger";

// In catch block:
catch (error) {
  const log = createRouteLogger("webhooks/stripe", {
    correlation_id: request.headers.get("x-correlation-id") || undefined,
    org_id: orgId,       // if resolved earlier in the handler
    session_id: sessionId, // if available
  });
  log.error({ err: error }, "Stripe webhook error");

  Sentry.withScope((scope) => {
    scope.setTag("correlation_id", correlationId);
    scope.setTag("org_id", orgId || "unknown");
    scope.setTag("session_id", sessionId || "unknown");
    Sentry.captureException(error);
  });

  return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
}
```

### Pattern 4: Shared Package Logging (non-route files)
**What:** Business logic in packages/shared also needs structured logging.
**When to use:** Files like task-processor.ts, escalation-notifier.ts, outreach-processor.ts that currently use console.error.
**Example:**
```typescript
// In packages/shared/src/automations/task-processor.ts
import { logger } from "@leadrwizard/shared/logger";

const log = logger.child({ module: "task-processor" });

// Instead of: console.error(`Cannot move task ${task.id} to DLQ: unable to resolve org_id`)
log.error({ task_id: task.id }, "Cannot move task to DLQ: unable to resolve org_id");

// Instead of: console.error(`Failed to create escalation for DLQ task ${task.id}`)
log.error({ task_id: task.id }, "Failed to create escalation for DLQ task");
```

### Anti-Patterns to Avoid
- **Rate limiting in each route handler separately:** Duplicates logic, easy to miss a route. Use middleware for centralized enforcement.
- **Importing pino in middleware.ts:** pino does NOT work in Edge Runtime (uses Node.js streams). Rate limiting goes in middleware (Edge-compatible), logging goes in route handlers (Node.js runtime).
- **Using pino-pretty in production:** 10x performance hit, breaks log aggregator JSON parsing. Guard with `process.env.NODE_ENV !== "production"`.
- **Synchronous headers() with pino:** Next.js 15 `headers()` is async. Extract correlation_id from `request.headers.get()` in the route handler, not from the headers() function.
- **Single Ratelimit instance for all tiers:** Create separate instances per tier with different prefixes so limits are independent.
- **Forgetting serverExternalPackages:** pino uses dynamic requires for transports. Must add `serverExternalPackages: ["pino", "pino-pretty"]` to next.config.ts (top-level in Next.js 15, NOT under `experimental`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting across serverless instances | In-memory Map (current broken approach) | @upstash/ratelimit | In-memory resets on cold start. Already proven broken in prod. |
| Sliding window algorithm | Custom token counting with timestamps | Ratelimit.slidingWindow() | Edge cases with window boundaries, race conditions, atomic operations. Upstash handles with server-side Lua scripts. |
| Structured JSON logging | console.log + JSON.stringify wrapper | pino | Missing: log levels, child loggers, redaction, transport pipeline, timestamp formatting, async writes. |
| Correlation ID propagation | Custom header management | crypto.randomUUID() + middleware header | UUIDs are guaranteed unique. crypto.randomUUID() works in Edge Runtime. |
| Error tracking + alerting | Custom error aggregation webhook | @sentry/nextjs | Deduplication, source maps, stack traces, release tracking, alerting rules. Months of work to replicate. |
| Source map uploads | Manual source map build step | withSentryConfig() | Automatic during build, no custom CI config. |

**Key insight:** The existing in-memory rate limiter is the exact failure mode @upstash/ratelimit was built to solve. Every line of custom code in this domain is a liability.

## Common Pitfalls

### Pitfall 1: pino in Edge Runtime
**What goes wrong:** Importing pino in middleware.ts causes "Module not found" or "pino.transport is not a function" errors.
**Why it happens:** Middleware runs in Edge Runtime by default. Pino uses Node.js streams and dynamic requires that don't exist in Edge.
**How to avoid:** ONLY use pino in API route handlers (Node.js runtime). Rate limiting goes in middleware (Edge-compatible @upstash/ratelimit). Correlation ID injection uses `crypto.randomUUID()` which works in Edge.
**Warning signs:** Build errors mentioning `pino/file`, `thread-stream`, or `pino-pretty` in middleware context.

### Pitfall 2: serverExternalPackages Config Key
**What goes wrong:** pino fails with "Cannot find module" errors during Next.js build.
**Why it happens:** Next.js 15 bundles server code by default. Pino uses dynamic requires for transports. The config key was renamed from `experimental.serverComponentsExternalPackages` to top-level `serverExternalPackages` in Next.js 15.
**How to avoid:** Add to `next.config.ts` at the top level: `serverExternalPackages: ["pino", "pino-pretty"]`.
**Warning signs:** Build errors about `pino-pretty`, `thread-stream`, or missing worker modules.

### Pitfall 3: pino-pretty in Production
**What goes wrong:** Pretty-printing in production causes ~10x performance hit and breaks log aggregator JSON parsing.
**Why it happens:** Forgetting to conditionally apply the transport config.
**How to avoid:** Guard transport with `process.env.NODE_ENV !== "production"`. Production outputs raw JSON to stdout.
**Warning signs:** Logs not appearing in Vercel log drain, slow API responses.

### Pitfall 4: Sentry.flush() in Serverless
**What goes wrong:** Errors captured but never sent to Sentry because function terminates before HTTP request completes.
**Why it happens:** Serverless functions terminate immediately after response.
**How to avoid:** @sentry/nextjs handles this automatically for API routes when using `captureException`. The onRequestError hook also handles flushing. Only a concern if using raw `captureMessage` in custom async code outside request context.
**Warning signs:** Errors appear in pino logs but not in Sentry dashboard.

### Pitfall 5: Rate Limit Key Selection
**What goes wrong:** Using only IP for rate limiting causes false positives behind shared NATs/proxies (corporate networks, mobile carriers).
**Why it happens:** Many clients share a single external IP.
**How to avoid:** Use `tier:ip` as the key pattern. The tier prefix ensures webhook and widget limits are independent. For Stripe specifically, the generous 100 req/min limit accommodates retry bursts (Stripe sends max ~16 retries over 3 days).
**Warning signs:** Legitimate webhook retries from Stripe getting 429'd.

### Pitfall 6: Lazy Initialization of Redis Client
**What goes wrong:** Importing @upstash/redis at module level causes build errors when env vars aren't set (build time).
**Why it happens:** `Redis.fromEnv()` throws if UPSTASH_REDIS_REST_URL is not set. This happens during `next build`.
**How to avoid:** Wrap Redis client creation in a lazy getter function that only runs on first request, not at import time.
**Warning signs:** Build failures in CI, "UPSTASH_REDIS_REST_URL is not set" during `pnpm build`.

### Pitfall 7: Stripe 429 Interpretation
**What goes wrong:** Rate limiting webhook endpoints could cause Stripe to consider the endpoint unhealthy.
**Why it happens:** While 429 is technically a valid HTTP response, aggressive rate limiting could trigger Stripe's webhook disabling logic.
**How to avoid:** Set webhook tier generously (100 req/min). Stripe's max burst is ~16 retries over 3 days. 100/min is more than sufficient. Monitor Stripe webhook dashboard for disabled endpoints.
**Warning signs:** Stripe dashboard shows webhook endpoint as disabled.

## Code Examples

### Complete Rate Limiter Module (replaces packages/shared/src/utils/rate-limiter.ts)
```typescript
// packages/shared/src/utils/rate-limiter.ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Lazy initialization: avoids build-time errors when env vars aren't set
let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
  }
  return redis;
}

export const RATE_LIMITS = {
  webhook: { requests: 100, window: "60 s" as const },
  widget:  { requests: 60,  window: "60 s" as const },
  api:     { requests: 60,  window: "60 s" as const },
  signup:  { requests: 10,  window: "60 s" as const },
  auth:    { requests: 10,  window: "60 s" as const },
  cron:    { requests: 5,   window: "60 s" as const },
} as const;

export type RateLimitTier = keyof typeof RATE_LIMITS;

const limiters = new Map<string, Ratelimit>();

export function getRateLimiter(tier: RateLimitTier): Ratelimit {
  if (!limiters.has(tier)) {
    const config = RATE_LIMITS[tier];
    limiters.set(
      tier,
      new Ratelimit({
        redis: getRedis(),
        limiter: Ratelimit.slidingWindow(config.requests, config.window),
        prefix: `lw:rl:${tier}`,
        analytics: true,
      })
    );
  }
  return limiters.get(tier)!;
}

export function getTierForPath(pathname: string): RateLimitTier | null {
  if (pathname.startsWith("/api/webhooks/")) return "webhook";
  if (pathname.startsWith("/api/widget/")) return "widget";
  if (pathname.startsWith("/api/signup/")) return "signup";
  if (pathname.startsWith("/api/cron/")) return "cron";
  return null; // authenticated routes don't get rate limited
}
```

### Complete Logger Module
```typescript
// packages/shared/src/logger/index.ts
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

/**
 * Creates a child logger bound to a route with correlation context.
 * Use in API route handlers.
 */
export function createRouteLogger(
  route: string,
  context?: {
    correlation_id?: string;
    org_id?: string;
    session_id?: string;
  }
): pino.Logger {
  return logger.child({ route, ...context });
}
```

### Sentry Setup Files

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

// Captures unhandled errors from API routes, Server Components, middleware
export const onRequestError = Sentry.captureRequestError;
```

```typescript
// apps/admin/instrumentation-client.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  environment: process.env.NODE_ENV || "development",
});
```

```typescript
// apps/admin/src/app/global-error.tsx
"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
```

### next.config.ts Changes
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
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Tunnel Sentry events to avoid ad-blockers (optional)
  tunnelRoute: "/monitoring",
});
```

### Route Handler Pattern (replacing console.error with logger + Sentry)
```typescript
// Example transformation for: apps/admin/src/app/api/webhooks/stripe/route.ts
import * as Sentry from "@sentry/nextjs";
import { createRouteLogger } from "@leadrwizard/shared/logger";

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") || crypto.randomUUID();
  const log = createRouteLogger("webhooks/stripe", { correlation_id: correlationId });

  try {
    // ... existing logic unchanged ...
    log.info({ event_id: event.id }, "Stripe webhook processed");
    return NextResponse.json({ received: true });
  } catch (error) {
    log.error({ err: error }, "Stripe webhook error");
    Sentry.withScope((scope) => {
      scope.setTag("correlation_id", correlationId);
      Sentry.captureException(error);
    });
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
```

## Inventory: All Console Usage to Replace

### API Routes (apps/admin/src/app/api/)
| File | Line | Current Code | Replace With | Context Available |
|------|------|-------------|--------------|-------------------|
| webhooks/stripe/route.ts | 72 | `console.error("Stripe webhook error:", error)` | `log.error({ err: error }, "Stripe webhook error")` | event.id |
| webhooks/payment/route.ts | 97 | `console.error("Payment webhook error:", error)` | `log.error({ err: error }, "Payment webhook error")` | orgId, payload |
| webhooks/twilio/route.ts | 37 | `console.warn("Invalid Twilio signature...")` | `log.warn("Invalid Twilio signature, rejecting webhook")` | - |
| webhooks/twilio/route.ts | 54 | `console.warn("Inbound SMS from unknown number: ...")` | `log.warn({ from: sms.from }, "Inbound SMS from unknown number")` | sms.from |
| webhooks/twilio/route.ts | 104 | `console.error("Twilio webhook error:", error)` | `log.error({ err: error }, "Twilio webhook error")` | - |
| webhooks/vapi/route.ts | 54 | `console.error("Vapi webhook error:", error)` | `log.error({ err: error }, "Vapi webhook error")` | - |
| webhooks/vapi/route.ts | 71 | `console.warn("Vapi end-of-call missing...")` | `log.warn("Vapi end-of-call missing client_id or session_id")` | - |
| widget/response/route.ts | 145 | `console.error("Widget response error:", error)` | `log.error({ err: error }, "Widget response error")` | sessionId |
| widget/session/[sessionId]/route.ts | 211 | `console.error("Widget session load error:", error)` | `log.error({ err: error }, "Widget session load error")` | sessionId |
| signup/checkout/route.ts | 59 | `console.error("Signup checkout error:", error)` | `log.error({ err: error }, "Signup checkout error")` | email |
| billing/checkout/route.ts | 38 | `console.error("Checkout error:", error)` | `log.error({ err: error }, "Billing checkout error")` | user.id |
| billing/portal/route.ts | 34 | `console.error("Portal error:", error)` | `log.error({ err: error }, "Billing portal error")` | user.id |
| cron/outreach/route.ts | 32 | `console.error("Outreach cron error:", error)` | `log.error({ err: error }, "Outreach cron error")` | - |
| cron/tasks/route.ts | 32 | `console.error("Service task processing error:", error)` | `log.error({ err: error }, "Service task processing error")` | - |
| org/create/route.ts | 54 | `console.error("Org creation error:", error)` | `log.error({ err: error }, "Org creation error")` | user.id |

### Shared Package (packages/shared/src/)
| File | Line | Current Code | Replace With | Context Available |
|------|------|-------------|--------------|-------------------|
| comms/outreach-processor.ts | 42 | `console.error("Failed to process outreach item...")` | `log.error({ item_id }, "Failed to process outreach item")` | item.id |
| automations/task-processor.ts | 38 | `console.error("Cannot move task to DLQ...")` | `log.error({ task_id: task.id }, "Cannot move task to DLQ: unable to resolve org_id")` | task.id |
| automations/task-processor.ts | 85 | `console.error("Failed to create escalation...")` | `log.error({ task_id: task.id }, "Failed to create escalation for DLQ task")` | task.id |
| automations/task-processor.ts | 204 | `console.error("Failed to process task...")` | `log.error({ task_id: task.id, task_type }, "Failed to process task")` | task.id, task_type |
| automations/escalation-notifier.ts | 126 | `console.warn("No escalation webhook configured...")` | `log.warn("No escalation webhook configured")` | - |
| automations/escalation-notifier.ts | 236 | `console.error("Slack notification failed: ...")` | `log.error({ status: response.status }, "Slack notification failed")` | response.status |
| automations/escalation-notifier.ts | 351 | `console.error("Google Chat notification failed: ...")` | `log.error({ status: response.status }, "Google Chat notification failed")` | response.status |
| automations/payment-handler.ts | 129 | `console.error("GHL provisioning failed...")` | `log.error({ err }, "GHL provisioning failed (will retry)")` | err.message |

**Total: 23 call sites across 16 files** (15 in API routes, 8 in shared package)

## Endpoints Requiring Rate Limiting

| Endpoint | Method | Auth Type | Tier | Rate Limit | Key Pattern |
|----------|--------|-----------|------|-----------|-------------|
| /api/webhooks/stripe | POST | Stripe signature | webhook | 100/min | `webhook:ip` |
| /api/webhooks/payment | POST | API key | webhook | 100/min | `webhook:ip` |
| /api/webhooks/twilio | POST | Twilio signature | webhook | 100/min | `webhook:ip` |
| /api/webhooks/vapi | POST | None (unverified) | webhook | 100/min | `webhook:ip` |
| /api/widget/response | POST | Session validation | widget | 60/min | `widget:ip` |
| /api/widget/session/[id] | GET | None (public) | widget | 60/min | `widget:ip` |
| /api/signup/checkout | POST | None (public) | signup | 10/min | `signup:ip` |
| /api/cron/outreach | GET | CRON_SECRET | cron | 5/min | `cron:ip` |
| /api/cron/tasks | POST | CRON_SECRET | cron | 5/min | `cron:ip` |

**Not rate limited** (behind Supabase auth, middleware redirects unauthenticated users):
- /api/billing/checkout (POST, user auth)
- /api/billing/portal (POST, user auth)
- /api/org/create (POST, user auth)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `experimental.serverComponentsExternalPackages` | `serverExternalPackages` (top-level) | Next.js 15 | Must use new config key for pino, NOT under experimental |
| sentry.client.config.ts (auto-loaded) | instrumentation-client.ts | @sentry/nextjs v8+ | New file naming convention for client init |
| sentry.server.config.ts (auto-loaded) | instrumentation.ts imports it | @sentry/nextjs v8+ | Explicit registration via Next.js instrumentation hook |
| No onRequestError | onRequestError = Sentry.captureRequestError | @sentry/nextjs v8.28+ / Next.js 15 | Automatic capture of unhandled errors from API routes, RSC, middleware |
| In-memory rate limiting | Redis-backed (@upstash/ratelimit) | Serverless standard | In-memory was never correct for Vercel serverless |

## Open Questions

1. **Upstash Redis instance provisioning**
   - What we know: Upstash free tier provides 10K requests/day, sufficient for dev/staging. Production will need a paid tier.
   - What's unclear: Whether the project already has an Upstash account. This is flagged as a blocker in STATE.md.
   - Recommendation: Code should use lazy initialization and gracefully skip rate limiting if UPSTASH_REDIS_REST_URL is not set. This allows development and testing to proceed without the account.

2. **Sentry project creation**
   - What we know: Sentry free tier (5K errors/month) is sufficient for initial launch.
   - What's unclear: Whether a Sentry account/project exists.
   - Recommendation: Sentry.init() with no DSN becomes a no-op. Code works without it. Create the project later and just add the env var.

3. **Widget app (apps/widget) logging**
   - What we know: Widget is a Vite React app (client-side IIFE bundle). Pino is server-only.
   - Recommendation: Out of scope for OBS-01. Widget client-side logging is not part of the structured logging requirement.

4. **Rate limit edge case: Stripe retries**
   - What we know: Stripe retries on 5xx, not 4xx. A 429 (4xx) should be safe but overly aggressive limits could cause missed events.
   - Recommendation: 100 req/min for webhook tier is very generous. Stripe's maximum retry burst is ~16 attempts over 3 days. No risk of false positives at this limit.

5. **Shared package exports for logger**
   - What we know: packages/shared currently exports via barrel files. Logger needs a new export path.
   - Recommendation: Add `"./logger": "./src/logger/index.ts"` to packages/shared/package.json exports map. Route handlers import from `@leadrwizard/shared/logger`.

## Sources

### Primary (HIGH confidence)
- [@upstash/ratelimit v2.0.8 GitHub](https://github.com/upstash/ratelimit-js) - API, algorithms, constructor options, released Jan 2026
- [Upstash Ratelimit Docs](https://upstash.com/docs/redis/sdks/ratelimit-ts/overview) - Getting started, features
- [Sentry Next.js Manual Setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/) - File structure, init patterns, instrumentation.ts
- [Sentry Tags](https://docs.sentry.io/platforms/javascript/guides/nextjs/enriching-events/tags/) - setTag API, key constraints
- [Sentry Scopes](https://docs.sentry.io/platforms/javascript/guides/nextjs/enriching-events/scopes/) - withScope, withIsolationScope, per-request isolation
- [Next.js serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) - Config key naming (stable in Next.js 15)
- [pino v10.3.1 npm](https://www.npmjs.com/package/pino) - Version confirmation, API

### Secondary (MEDIUM confidence)
- [Arcjet Blog: Structured Logging for Next.js](https://blog.arcjet.com/structured-logging-in-json-for-next-js/) - pino + Next.js child logger pattern
- [Upstash Blog: Rate Limiting Next.js](https://upstash.com/blog/nextjs-ratelimiting) - Next.js route handler integration pattern
- [Vercel Template: Rate Limit with Upstash](https://vercel.com/templates/next.js/ratelimit-with-upstash-redis) - Official Vercel endorsement
- [Sentry Next.js setup guide](https://chanchann.github.io/blog/journal/2025/06/26/sentry-nextjs.html) - v9.32.0 App Router patterns

### Tertiary (LOW confidence)
- [pinojs/pino #2218](https://github.com/pinojs/pino/issues/2218) - Per-request logger discussion for Next.js (community, not official)
- [vercel/next.js #67213](https://github.com/vercel/next.js/discussions/67213) - Edge runtime logging limitations (confirms pino incompatibility with Edge)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All three libraries (@upstash/ratelimit, pino, @sentry/nextjs) are the undisputed industry standard for their domain in the Next.js/Vercel serverless ecosystem. Versions confirmed via npm registry.
- Architecture: HIGH - Middleware vs route handler split verified against Next.js 15 Edge Runtime constraints. Pino Edge incompatibility confirmed by multiple sources. @upstash/ratelimit Edge compatibility confirmed by Upstash docs.
- Pitfalls: HIGH - Based on documented Next.js 15 breaking changes (serverExternalPackages rename), known pino bundling issues, and Sentry instrumentation changes in v8+.
- Console inventory: HIGH - Exact grep of entire codebase, all 23 call sites enumerated with line numbers and available context.

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable libraries, unlikely to change significantly)
