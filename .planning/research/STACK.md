# Stack Research

**Domain:** AI-powered autonomous onboarding SaaS (brownfield — adding remaining 25%)
**Researched:** 2026-03-13
**Confidence:** HIGH (all key libraries verified against official docs or npm registry)

---

## Context

This is not a greenfield stack decision. The core stack (Next.js 15, Supabase, Turborepo, Vite, Vitest, Tailwind) is locked in and working. This document covers only the **new libraries needed** to complete the remaining active requirements:

- Stripe webhook signature verification + local testing (Stripe CLI)
- Supabase realtime subscriptions for dashboard
- Widget e2e flow (IIFE + shadow DOM + voice + forms — already architected, needs runtime completion)
- Structured logging with correlation IDs (replace console.error)
- Rate limiting on public webhook endpoints

---

## Recommended Stack

### Core Technologies (New Additions Only)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `stripe` (node SDK) | 20.4.1 | Stripe webhook signature verification, checkout sessions, billing portal | Already partially used via stripe-adapter. Lock to this version for `constructEvent()` raw body pattern with Next.js App Router. The `await request.text()` approach works cleanly; body parsing must NOT be altered. |
| Stripe CLI | 1.37.3 | Local webhook forwarding during development | Only way to test `stripe.webhooks.constructEvent()` locally without deploying. Outputs a `whsec_` signing secret distinct from the dashboard secret — use it in `.env.local`. |
| `pino` | 10.3.1 | Structured JSON logging (replace console.error) | Fastest Node.js logger. Outputs JSON natively, integrates with Vercel/Datadog log drains, supports child loggers for per-request context. The ecosystem choice for production Next.js observability. |
| `pino-pretty` | latest | Human-readable log output in development | Only used in dev mode. Pipe `pino` output through `pino-pretty` for terminal readability. Do not use in production. |
| `@upstash/ratelimit` | 2.0.8 | Rate limiting for public webhook endpoints | Serverless-native sliding window / token bucket algorithms. HTTP-based Redis means it works in Vercel edge AND Node.js runtimes. Official Vercel template endorsement. |
| `@upstash/redis` | 1.37.0 | Redis client for Upstash (dependency of @upstash/ratelimit) | HTTP-based, works in edge functions. Required peer dep. |

### Supabase Realtime (No New Library — Config Change Only)

Supabase realtime is already available via the existing `@supabase/supabase-js` 2.49.0. No new package needed. The change is **architectural**: switch from `postgres_changes` (dev-only) to **Broadcast via database triggers** (production-grade).

| Approach | Verdict | When |
|----------|---------|------|
| `postgres_changes` | Dev/testing only | Fine for prototyping, NOT for production with multiple users. Each insert triggers one read per subscriber — scales badly. |
| Broadcast via `realtime.broadcast_changes` trigger | Production | Supabase official recommendation. One replication slot connection, fan-out to all subscribers. Use this. |

Pattern for dashboard client components:

```typescript
// In a 'use client' component
useEffect(() => {
  const channel = supabase
    .channel('onboardings-updates')
    .on('broadcast', { event: 'onboarding_updated' }, (payload) => {
      // update local state
    })
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}, [])
```

The DB trigger calling `realtime.broadcast_changes()` runs server-side in Supabase — nothing new to install.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Stripe CLI (v1.37.3) | Forward webhooks to localhost | Install: `brew install stripe/stripe-cli/stripe`. Run: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`. Use the displayed `whsec_` as `STRIPE_WEBHOOK_SECRET` in `.env.local`. |
| `pino-pretty` | Dev log formatting | Add to `package.json` scripts: `node server.js | pino-pretty`. Not bundled into prod. |

---

## Installation

```bash
# In apps/admin (or packages/shared for logger)
pnpm add stripe@20.4.1 --filter @leadrwizard/admin
pnpm add pino@10.3.1 --filter @leadrwizard/shared
pnpm add @upstash/ratelimit@2.0.8 @upstash/redis@1.37.0 --filter @leadrwizard/admin

# Dev only
pnpm add -D pino-pretty --filter @leadrwizard/admin

# Stripe CLI (global dev tool, not a package)
brew install stripe/stripe-cli/stripe
```

**Note:** `stripe` node SDK may already be installed — check `packages/shared/package.json`. If so, pin to 20.4.1.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@upstash/ratelimit` + Upstash Redis | Vercel's built-in rate limiting headers | Vercel's approach is header-based with no persistence — doesn't protect against distributed abuse. Upstash is better for webhook endpoints. |
| `@upstash/ratelimit` + Upstash Redis | In-memory rate limiting (e.g., `express-rate-limit`) | In-memory doesn't work on serverless (every invocation is cold). Non-starter for Vercel. |
| `pino` | Winston | Winston is heavier, slower, and has worse Vercel integration. Pino outputs JSON by default which is what structured logging requires. |
| `pino` | `next-logger` | `next-logger` patches `console.*` — useful for zero-code-change migration but provides less control. Use it only if you want to avoid touching all call sites. Pino directly is cleaner for a new logging layer. |
| Supabase Broadcast triggers | `postgres_changes` subscription | Only acceptable if the dashboard will have < 5 simultaneous users and you're OK with potential bottlenecks. |
| Stripe CLI local webhook forwarding | ngrok or LocalCan tunnel | ngrok works but requires an account. Stripe CLI is purpose-built for Stripe, outputs the correct `whsec_` automatically, and requires no account beyond existing Stripe login. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `postgres_changes` for dashboard realtime | Official Supabase docs: "not recommended for production, requires one read per subscriber per event." With 10 admin users watching the dashboard, one insert creates 10 DB reads. | Broadcast via `realtime.broadcast_changes()` trigger |
| `ioredis` or `node-redis` for rate limiting | Both require persistent TCP connections — incompatible with Vercel serverless / edge runtime. | `@upstash/redis` (HTTP-based) |
| In-memory rate limiting stores | State lost on every cold start. Useless for serverless. | Upstash Redis |
| Winston | Slower than Pino, not JSON-first, heavier bundle. Not the ecosystem choice for Next.js in 2025+. | `pino` |
| `console.error` / `console.log` directly | No structured fields, no correlation IDs, no log levels, not queryable in log drains. Hard to grep in production Vercel logs. | `pino` with child loggers |
| Body parsers / `json()` middleware on Stripe webhook route | Stripe's `constructEvent()` requires the raw body as string. If Next.js parses it first, signature verification fails. | `await request.text()` before passing to `constructEvent()` |

---

## Widget IIFE + Shadow DOM (No New Libraries)

The widget architecture (Vite IIFE bundle, shadow DOM, CSS injection via `vite-plugin-css-injected-by-js`) is already correctly set up. The remaining work is runtime logic, not library additions:

- ElevenLabs browser SDK already integrated via `NEXT_PUBLIC_ELEVENLABS_AGENT_ID`
- Shadow DOM container already instantiated
- Voice + form hybrid: controlled by a state machine inside the widget (no new lib needed)
- Session load → form steps → response submission → completion: pure React state + `fetch()` to widget API routes

If form complexity grows, consider `react-hook-form` (zero-dependency, minimal bundle impact on IIFE). Not needed for current scope.

---

## Stack Patterns by Scenario

**Stripe webhook route (`/api/webhooks/stripe/route.ts`):**
```typescript
// MUST use request.text() not request.json()
const body = await request.text()
const sig = headers().get('stripe-signature')!
const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
```

**Pino logger with request correlation:**
```typescript
// packages/shared/src/logger.ts
import pino from 'pino'
export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

// In route handler:
const reqLogger = logger.child({ requestId: crypto.randomUUID(), path: req.url })
reqLogger.info({ event: 'stripe_webhook_received' })
reqLogger.error({ err }, 'webhook processing failed')
```

**Rate limiter in Next.js middleware or route handler:**
```typescript
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, '60 s'),
})

// In webhook route handler:
const ip = request.headers.get('x-forwarded-for') ?? 'anonymous'
const { success } = await ratelimit.limit(ip)
if (!success) return new Response('Too Many Requests', { status: 429 })
```

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `stripe@20.4.1` | Next.js 15, Node.js 18+ | App Router: use `request.text()` for raw body. No config export needed (App Router doesn't buffer). |
| `pino@10.3.1` | Next.js 15 server runtime | NOT compatible with Edge Runtime (uses Node.js streams). Use only in Node.js API routes, not middleware.ts. |
| `@upstash/ratelimit@2.0.8` | Vercel Edge + Node.js | Works in both `middleware.ts` (edge) and regular route handlers (Node.js). |
| `@upstash/redis@1.37.0` | Peer dep of @upstash/ratelimit | HTTP-based. No persistent connection overhead. |

---

## New Environment Variables Required

| Variable | Where | Purpose |
|----------|-------|---------|
| `STRIPE_WEBHOOK_SECRET` | `.env.local` (dev) + Vercel (prod) | Already in INTEGRATIONS.md. For dev: use `whsec_` from `stripe listen`. For prod: dashboard signing secret. |
| `UPSTASH_REDIS_REST_URL` | Vercel env vars | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel env vars | Upstash Redis auth token |
| `LOG_LEVEL` | Vercel env vars | `info` in prod, `debug` in dev |

---

## Sources

- Stripe CLI v1.37.3 — [Install docs](https://docs.stripe.com/stripe-cli/install) / [Use docs](https://docs.stripe.com/stripe-cli/use-cli) — HIGH confidence (official docs)
- Stripe node SDK v20.4.1 — [npmjs.com/package/stripe](https://www.npmjs.com/package/stripe) + GitHub releases — HIGH confidence
- Stripe App Router webhook pattern — [Stripe signature verification](https://docs.stripe.com/webhooks/signature) + [Next.js App Router discussion](https://github.com/vercel/next.js/discussions/48885) — HIGH confidence (multiple sources agree)
- Supabase Broadcast recommendation — [Getting Started with Realtime](https://supabase.com/docs/guides/realtime/getting_started) + [Subscribing to Database Changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes) — HIGH confidence (official Supabase docs, explicit production recommendation)
- Supabase Broadcast subscription API — [Broadcast docs](https://supabase.com/docs/guides/realtime/broadcast) — HIGH confidence (official docs)
- pino v10.3.1 — [npm registry](https://www.npmjs.com/package/pino) + [SigNoz guide 2026](https://signoz.io/guides/pino-logger/) — HIGH confidence
- pino + Next.js App Router correlation pattern — [pinojs/pino issue #2218](https://github.com/pinojs/pino/issues/2218) + [next.js discussion #39543](https://github.com/vercel/next.js/discussions/39543) — MEDIUM confidence (community patterns, no official pino-next integration)
- @upstash/ratelimit v2.0.8 — [GitHub upstash/ratelimit-js](https://github.com/upstash/ratelimit-js) + [npm @upstash/ratelimit](https://www.npmjs.com/package/@upstash/ratelimit) — HIGH confidence (official repo, version confirmed)
- @upstash/redis v1.37.0 — [npm @upstash/redis](https://www.npmjs.com/package/@upstash/redis) — HIGH confidence
- Upstash + Next.js middleware pattern — [Upstash blog](https://upstash.com/blog/nextjs-ratelimiting) + [Vercel template](https://vercel.com/templates/next.js/ratelimit-with-upstash-redis) — HIGH confidence (official Upstash + Vercel endorsement)

---

*Stack research for: LeadrWizard (milestone — remaining 25%)*
*Researched: 2026-03-13*
