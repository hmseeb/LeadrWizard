# Architecture Research

**Domain:** AI-powered autonomous onboarding SaaS (multi-tenant)
**Researched:** 2026-03-13
**Confidence:** HIGH — based on direct codebase analysis + verified patterns from official docs

---

## System Overview

The existing architecture is a Turborepo monorepo with four distinct deployment units and a clear shared domain layer. New features plug into this structure without restructuring it.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        PRESENTATION LAYER                            │
│                                                                      │
│  ┌─────────────────────────────┐   ┌──────────────────────────────┐  │
│  │     apps/admin (Next.js 15)  │   │  apps/widget (Vite IIFE)     │  │
│  │  - Dashboard pages (RSC)    │   │  - Shadow DOM React widget   │  │
│  │  - Admin CRUD UI            │   │  - useWizardSession hook     │  │
│  │  - Realtime dashboard       │   │  - Voice + form hybrid       │  │
│  └──────────┬──────────────────┘   └──────────────┬───────────────┘  │
│             │ server actions / API routes          │ direct Supabase  │
├─────────────┼──────────────────────────────────────┼──────────────────┤
│                         API & MIDDLEWARE LAYER                       │
│                                                                      │
│  ┌──────────────────────┐  ┌────────────────┐  ┌────────────────┐   │
│  │  /api/webhooks/      │  │  /api/cron/    │  │  middleware.ts │   │
│  │  stripe, twilio,     │  │  outreach,     │  │  auth guard,   │   │
│  │  vapi, payment       │  │  tasks         │  │  route exempt  │   │
│  └──────────┬───────────┘  └───────┬────────┘  └────────────────┘   │
│             │                      │                                  │
├─────────────┼──────────────────────┼──────────────────────────────────┤
│                       DOMAIN LOGIC LAYER                             │
│                    packages/shared/src/                              │
│                                                                      │
│  ┌───────────┐ ┌───────────┐ ┌─────────────┐ ┌──────────┐          │
│  │  agent/   │ │  comms/   │ │ automations/│ │ billing/ │          │
│  │ router    │ │ twilio    │ │ payment-    │ │ stripe-  │          │
│  │ context   │ │ vapi      │ │ handler     │ │ adapter  │          │
│  │ completion│ │ ghl-email │ │ outreach-   │ └──────────┘          │
│  └───────────┘ └───────────┘ │ scheduler   │ ┌──────────┐          │
│                               │ a2p-manager │ │ tenant/  │          │
│                               │ gmb-manager │ │ org-mgr  │          │
│                               └─────────────┘ └──────────┘          │
├─────────────────────────────────────────────────────────────────────┤
│                           DATA LAYER                                 │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                  Supabase PostgreSQL                          │   │
│  │  organizations | org_members | clients | onboarding_sessions │   │
│  │  service_definitions | service_packages | client_services    │   │
│  │  session_responses | outreach_queue | service_tasks          │   │
│  │  interaction_log | escalations | analytics_snapshots         │   │
│  │  subscription_plans | org_subscriptions                      │   │
│  │  RLS enforced on all tables, org_id scoped                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `apps/admin` pages | Read-only RSC dashboard views, initial data fetch | Supabase (server), shared domain |
| `apps/admin` API routes | Webhook receivers, billing endpoints, CRUD mutations | shared domain, external services |
| `apps/admin` middleware | Auth guard, session refresh, route exemptions | Supabase SSR |
| `apps/widget` | Client-facing onboarding wizard in shadow DOM | Supabase (anon key, direct), admin API |
| `packages/shared/agent` | Agent routing decisions, context building from DB | Supabase, Claude API |
| `packages/shared/comms` | Multi-channel message dispatch (SMS, voice, email) | Twilio, Vapi, GHL |
| `packages/shared/automations` | Payment handling, outreach scheduling, task processing | Supabase, GHL, GMB, A2P APIs |
| `packages/shared/billing` | Stripe checkout, subscription lifecycle, plan limits | Stripe API, Supabase |
| `packages/shared/tenant` | Org CRUD, member management, invitation flow | Supabase |
| `packages/shared/utils` | Rate limiter, shared utilities | Standalone |
| `supabase/migrations` | Schema, RLS policies, pg_cron jobs | None (DDL only) |

---

## Component Boundaries for New Features

### 1. Multi-Tenant Self-Service Org Provisioning

**Flow:** Stripe checkout → `checkout.session.completed` webhook → auto-provision org + admin access

```
Stripe Dashboard
    ↓  (checkout.session.completed)
/api/webhooks/stripe/route.ts
    ↓  verifyWebhookSignature (stripe.webhooks.constructEvent)
packages/shared/billing/stripe-adapter.ts → processStripeWebhook()
    ↓  if checkout.session.completed and no org_id yet
packages/shared/tenant/org-manager.ts → createOrganization()
    ↓  create org + set owner membership
Supabase: organizations + org_members tables
    ↓  send magic link or trigger welcome email
packages/shared/comms/ghl-email.ts
```

**Boundary:** `stripe-adapter.ts` must call `org-manager.ts` for new-org checkout events. The stripe adapter is currently disconnected from tenant provisioning — it only creates `org_subscriptions`. The payment-handler flow (separate `/api/webhooks/payment`) handles client onboarding. These two flows need to stay separate: Stripe webhook = org/subscription provisioning, payment webhook = client onboarding.

**Key constraint:** `stripe-adapter.ts` currently uses `request.text()` to get raw body but does NOT call `stripe.webhooks.constructEvent`. Signature verification must be added here before any logic runs. The existing `verifyWebhookSignature` in the payment route (HMAC-SHA256 via Web Crypto) can be adapted, but Stripe's SDK method `stripe.webhooks.constructEvent(rawBody, sig, secret)` is the correct approach.

### 2. Admin CRUD (Server Actions vs API Routes)

**Decision: Use server actions for admin CRUD in the App Router.**

Rationale: Server actions are the right pattern for admin form mutations in Next.js 15. Admin CRUD (services, packages, templates, settings) is all internal-only UI with no external consumers. Server actions eliminate boilerplate route files, handle progressive enhancement, and keep auth context automatically. API routes are reserved for external callers (webhooks, widget, third-party integrations).

**Pattern:**

```typescript
// apps/admin/src/app/(dashboard)/services/actions.ts
"use server"

import { createSupabaseServerClient } from "@/lib/supabase-server"
import { revalidatePath } from "next/cache"

export async function createServiceDefinition(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // Get org_id from user membership
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .single()

  // Insert scoped to org
  await supabase.from("service_definitions").insert({
    org_id: membership.org_id,
    name: formData.get("name"),
    // ...
  })

  revalidatePath("/services")
}
```

**File placement rule:** Each dashboard route gets a co-located `actions.ts` file. Types shared between page and actions stay in `actions.ts`. No new API routes for admin CRUD.

**Existing read pattern (keep as-is):** Dashboard pages are already RSC that query Supabase server-side. Preserve this. Mutations add server actions.

### 3. Widget End-to-End Flow

**Current state:** Widget queries Supabase directly using anon key. `useWizardSession` hook loads session, calculates missing fields client-side, calls `submitResponse` which does `supabase.from("session_responses").insert()`.

**Gap:** Direct anon inserts to `session_responses` bypass org_id validation. The widget doesn't know which org the session belongs to — it's validated via the session_id alone. This is the RLS hardening requirement.

**Fixed architecture:**

```
Widget (browser)
    ↓  init({ sessionId })
useWizardSession → Supabase anon client
    ↓  READ: session, client, client_services, responses (RLS: session_id match)
    ↓  WRITE: POST /api/widget/response (NOT direct Supabase insert)
apps/admin /api/widget/response/route.ts
    ↓  validate session_id exists, check org_id from session
    ↓  rate limit by session_id
    ↓  supabase.from("session_responses").insert({ org_id: session.org_id, ... })
    ↓  trigger agent re-evaluation
    ↓  return next question
```

This means session_responses inserts move from direct anon Supabase to a thin API route that enforces org_id. The widget reads remain direct Supabase (anon) since RLS on reads already scopes by session.

**Session validation:** The `onboarding_sessions` table has `org_id`. The API route resolves `org_id` from session_id — no anon JWT needed for org context.

### 4. Security Middleware Architecture

**Rate limiting:** The existing `checkRateLimit` in `packages/shared/utils/rate-limiter.ts` is in-memory. On Vercel (serverless), each lambda invocation gets its own memory — the in-memory Map resets per invocation. This means rate limiting currently doesn't work in production.

**Fix required:** Replace in-memory store with Supabase-backed rate limiting using `pg_cron` or Upstash Redis. Given the constraint of no new services, use Supabase for rate limit counters.

```
Rate limit table approach:
CREATE TABLE rate_limit_buckets (
  key TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0,
  reset_at TIMESTAMPTZ
);

-- Or use Supabase's built-in function:
-- Execute atomic increment + TTL check in a single DB call
```

**Webhook verification architecture:**

| Webhook | Current State | Required |
|---------|---------------|----------|
| `/api/webhooks/twilio` | HMAC-SHA1 verified (done) | No change |
| `/api/webhooks/payment` | HMAC-SHA256 verified (done) | No change |
| `/api/webhooks/stripe` | NOT verified — raw JSON.parse only | Add `stripe.webhooks.constructEvent` |
| `/api/webhooks/vapi` | Unknown | Verify Vapi signature if available |

**Idempotency:** The payment webhook lacks idempotency key checks. Stripe retries failed webhooks. The fix: before processing any `checkout.session.completed`, check if an `org_subscription` already exists with that `stripe_subscription_id`.

```typescript
// Check for idempotency before processing
const { data: existing } = await supabase
  .from("org_subscriptions")
  .select("id")
  .eq("stripe_subscription_id", subscriptionId)
  .single()

if (existing) return // Already processed
```

**Atomic payment handler:** The `handlePaymentWebhook` function in `payment-handler.ts` does 7 sequential inserts with no rollback. If step 4 (GHL provisioning) fails, the error is caught and swallowed but steps 1-3 already committed. This is acceptable for GHL (logged, retried) but not for core records (client, session). The fix: wrap client + package + services creation in a Postgres function or use a `try/catch` that deletes partial records on critical failure.

### 5. Supabase Realtime for Dashboard

**Pattern:** Realtime subscriptions require a client component. RSC pages cannot subscribe to real-time. The architecture splits: RSC page does initial server fetch (for SSR), a client wrapper subscribes to changes.

```typescript
// apps/admin/src/components/realtime/RealtimeSessionsProvider.tsx
"use client"

import { createClient } from "@/lib/supabase-client"
import { useEffect, useState } from "react"

export function RealtimeDashboard({ initialData }) {
  const [data, setData] = useState(initialData)
  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-changes")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "onboarding_sessions",
        filter: `org_id=eq.${orgId}`, // Must be org-scoped
      }, (payload) => {
        // Update local state
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase, orgId])

  return <DashboardContent data={data} />
}
```

**Key constraint:** Supabase Realtime respects RLS. The anon/authenticated client must have SELECT permission on the filtered rows. For the dashboard, use the authenticated Supabase client (not anon). The `filter` param on `postgres_changes` is required for org-scoping — without it, the client receives all org's events if RLS allows.

**Scope:** Realtime on `onboarding_sessions`, `escalations`, and `outreach_queue` is sufficient for the live dashboard. `interaction_log` is too high-volume for realtime — query on demand.

### 6. Structured Logging Architecture

**Current state:** `console.error(...)` throughout API routes and shared modules. Vercel captures stdout/stderr in log drains. No correlation IDs.

**Required pattern:** Pino logger with correlation IDs, structured JSON output in production.

```
Request enters middleware.ts
    ↓  generate requestId = crypto.randomUUID()
    ↓  add to request headers (x-request-id)
API route / server action
    ↓  extract requestId from headers
    ↓  create child logger: logger.child({ requestId, orgId, route })
    ↓  logger.info({ event: "webhook_received" })
    ↓  on error: logger.error({ event: "webhook_failed", error: err.message })
```

**Pino + Vercel:** Pino works on Vercel but requires `pino/browser` workaround for edge middleware (middleware.ts runs on Edge runtime). For API routes (Node runtime), standard pino works fine. Use `pino-pretty` in development, raw JSON in production.

**Location:** Create `packages/shared/src/logger/index.ts` — shared logger factory. API routes import and create child loggers with request context.

---

## Data Flow

### New Org Self-Service Flow

```
Agency visits pricing page
    ↓
/api/billing/checkout (POST) → createCheckoutSession()
    ↓
Stripe Checkout page (external)
    ↓  (payment complete)
Stripe → POST /api/webhooks/stripe
    ↓  verifySignature (STRIPE_WEBHOOK_SECRET)
    ↓  processStripeWebhook() → checkout.session.completed
    ↓  check idempotency (stripe_subscription_id already exists?)
    ↓  createOrganization() + createOrgSubscription()
    ↓  send welcome email
    ↓  redirect to /setup wizard
Admin user logs in → dashboard → setup org settings
```

### Admin CRUD Flow (Services/Packages/Templates)

```
Admin opens /services page (RSC)
    ↓  createSupabaseServerClient() → SELECT service_definitions WHERE org_id = user's org
    ↓  renders static list

Admin clicks "Add Service" → opens modal
    ↓  calls createServiceDefinition(formData) server action
    ↓  server action: auth check → org_id lookup → INSERT with org_id
    ↓  revalidatePath("/services") → RSC re-fetches
    ↓  UI updates without full page reload
```

### Widget Response Submission Flow (Hardened)

```
Client browser loads widget embed
    ↓  window.LeadrWizard.init({ sessionId, containerId })
    ↓  useWizardSession → Supabase anon READ (session, client, services, responses)
    ↓  renders next question

Client submits answer
    ↓  POST /api/widget/response { sessionId, fieldKey, fieldValue, clientServiceId }
    ↓  rate limit by sessionId (5 req/min)
    ↓  validate session exists → resolve org_id from session
    ↓  INSERT session_responses with org_id
    ↓  UPDATE session.completion_pct
    ↓  return { nextQuestion, completionPct }
    ↓  widget re-renders with next question
```

### Dashboard Realtime Flow

```
Admin opens /dashboard (RSC)
    ↓  initial data fetch: sessions, escalations, outreach counts
    ↓  renders page with data

RealtimeDashboard client component mounts
    ↓  subscribes to postgres_changes on onboarding_sessions + escalations
    ↓  (filter: org_id = user's org)

Webhook processes client response
    ↓  Supabase UPDATE onboarding_sessions.completion_pct
    ↓  Realtime event fires → dashboard re-renders KPI card live
```

---

## Architectural Patterns to Follow

### Pattern 1: Org Context Resolution

Every mutation must resolve `org_id` before writing. Never trust the client to provide `org_id`.

**For server actions:** Query `org_members` using `auth.uid()` to get `org_id`.
**For API routes (webhook):** Resolve from verified token or session foreign key.
**For widget:** Resolve from `onboarding_sessions.org_id` via validated `session_id`.

```typescript
// apps/admin/src/lib/get-user-org.ts
export async function getUserOrgId(supabase: SupabaseClient): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .single()

  if (!membership) throw new Error("No org membership")
  return membership.org_id
}
```

### Pattern 2: Webhook Hardening (Defense in Depth)

All public webhook endpoints must follow: verify → check idempotency → process → respond.

```typescript
export async function POST(request: Request) {
  // 1. Verify signature FIRST, before any processing
  const body = await request.text()
  const sig = request.headers.get("stripe-signature")
  const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET)

  // 2. Check idempotency
  const { data: existing } = await supabase
    .from("processed_webhook_events")
    .select("id").eq("event_id", event.id).single()
  if (existing) return NextResponse.json({ ok: true }) // already done

  // 3. Process
  await processEvent(supabase, event)

  // 4. Mark processed
  await supabase.from("processed_webhook_events")
    .insert({ event_id: event.id, processed_at: new Date().toISOString() })

  return NextResponse.json({ received: true })
}
```

### Pattern 3: RSC + Client Component Split for Realtime

Server components handle initial data fetch. Client components wrap the server-rendered content to add subscriptions.

```typescript
// page.tsx (RSC) — initial render
export default async function Page() {
  const supabase = await createSupabaseServerClient()
  const sessions = await fetchSessions(supabase)
  return <RealtimeDashboard initialSessions={sessions} orgId={...} />
}

// RealtimeDashboard (client) — real-time updates
"use client"
export function RealtimeDashboard({ initialSessions, orgId }) {
  const [sessions, setSessions] = useState(initialSessions)
  // subscribe to changes, update state
}
```

### Pattern 4: Server Action Co-location

Actions live in the same route folder as the page that uses them. No shared `actions/` barrel — each route owns its mutations.

```
apps/admin/src/app/(dashboard)/
  services/
    page.tsx      ← RSC, reads data
    actions.ts    ← "use server", mutations
    ServiceModal.tsx  ← "use client", calls actions
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Direct Anon Insert from Widget

**What:** Widget calls `supabase.from("session_responses").insert()` with anon key directly.
**Why bad:** RLS can't enforce `org_id` on inserts without knowing the org. Anonymous inserts can be forged with any `session_id`. Rate limiting cannot be applied.
**Instead:** POST to `/api/widget/response` route. Route resolves org_id from session, applies rate limiting, then inserts.

### Anti-Pattern 2: In-Memory Rate Limiter on Serverless

**What:** Using the `Map`-based `checkRateLimit` in `rate-limiter.ts` on Vercel.
**Why bad:** Each Vercel function invocation is stateless. The Map is empty on every cold start. Rate limits never accumulate.
**Instead:** Use Supabase for rate limit counters (atomic upsert + TTL check), or Upstash Redis if latency matters. Given existing stack constraints, Supabase is the right call.

### Anti-Pattern 3: Stripe Webhook Without `constructEvent`

**What:** Current `/api/webhooks/stripe/route.ts` does `JSON.parse(body)` without verifying Stripe's signature.
**Why bad:** Any HTTP request can trigger org provisioning or subscription creation. No authentication on a mutating endpoint.
**Instead:** `stripe.webhooks.constructEvent(rawBody, sigHeader, webhookSecret)` before any processing. Requires `body = await request.text()` not `request.json()`.

### Anti-Pattern 4: Logging with `console.error` Only

**What:** Current approach — `console.error("Vapi webhook error:", error)`.
**Why bad:** Vercel logs are unstructured. Can't trace a single request across webhook → shared module → DB. No correlation IDs. Alerts can't filter by org or request.
**Instead:** Pino child logger per request with `requestId` and `orgId` bound at the top of each route handler.

### Anti-Pattern 5: Partial Failure in Payment Handler

**What:** `handlePaymentWebhook` inserts client, package, services, then tries GHL — on GHL failure, client/session records exist but GHL is broken.
**Why bad:** Retry of the webhook will hit duplicate constraints or create orphaned records.
**Instead:** Wrap core inserts (client, package, services, session) in a try/catch that cleans up on failure. GHL provisioning is already fire-and-forget (correct) — the issue is the core records, not GHL.

---

## Suggested Build Order (Dependencies)

The new features have a clear dependency chain. Build in this order:

```
1. Security Foundation
   ├── Stripe webhook signature verification
   ├── Idempotency key table + checks on payment webhook
   └── RLS hardening migration (session_responses org_id policy)
       ↓ (security must come before exposing new surfaces)

2. Multi-Tenant Self-Service
   ├── Stripe checkout → createOrganization() wiring
   ├── Post-signup onboarding wizard (org settings setup)
   └── Per-org credential storage (Twilio phone, GHL creds)
       ↓ (orgs must exist before CRUD makes sense)

3. Admin CRUD
   ├── Service definitions (create, edit, delete)
   ├── Packages (create, edit, assign services)
   ├── Message templates (create, edit, preview)
   └── Org settings UI (cadence config, integration creds)
       ↓ (CRUD unblocks configuring the widget flow)

4. Widget E2E Flow
   ├── /api/widget/response route (replaces direct anon inserts)
   ├── Widget session load → form step → response loop
   ├── Completion gate + service task trigger
   └── Voice + form hybrid (ElevenLabs + form toggle)
       ↓ (widget + CRUD ready → observability needed before production)

5. Rate Limiting + Logging
   ├── Supabase-backed rate limiter (replace in-memory)
   ├── Pino logger in packages/shared/src/logger/
   ├── Correlation IDs in middleware + route handlers
   └── Replace all console.error calls
       ↓ (all surfaces hardened → add realtime)

6. Realtime Dashboard
   ├── Supabase channel subscriptions for sessions + escalations
   └── RSC + client component split pattern
```

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Stripe | Webhook (`/api/webhooks/stripe`) + REST API via `stripe-adapter.ts` | Must use `constructEvent` for signature verification |
| Twilio | Inbound webhook (`/api/webhooks/twilio`) + outbound via SDK | HMAC-SHA1 already verified |
| Vapi | Inbound webhook (`/api/webhooks/vapi`) + outbound via SDK | Verify Vapi signature if available |
| ElevenLabs | In-browser SDK in widget VoiceBot component | No server-side integration |
| GHL | REST API via `ghl-adapter.ts`, fire-and-forget | Per-org credentials needed |
| Supabase | Direct queries from all layers, Realtime for dashboard | Service key for server, anon key for widget reads |
| Vercel | Cron via `vercel.json` schedule config | Existing cron endpoints remain unchanged |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| admin pages → domain logic | Server actions + shared package imports | No HTTP between admin app and shared |
| widget → admin API | HTTP (REST) via `/api/widget/*` | Widget is isolated, no direct shared package access |
| admin API routes → shared | Direct function imports | Routes are thin wrappers over shared logic |
| shared modules → DB | Supabase client from `packages/shared/src/supabase/client.ts` | Single client factory, server-side only |
| widget → Supabase | Supabase `createClient` with anon key | READ only after RLS hardening, WRITEs via API route |

---

## Scalability Considerations

| Concern | Current (< 100 orgs) | Mid-scale (1K orgs) | Note |
|---------|---------------------|---------------------|------|
| Rate limiting | In-memory (broken serverless) | Supabase-backed atomic counters | Fix now, scales to mid |
| Realtime connections | Supabase Realtime (free tier OK) | Consider connection pooling | Realtime is per-tab, not per-org |
| Cron job concurrency | Single outreach + task cron | Partition queue by org shard | Not a v1 concern |
| Webhook throughput | Vercel serverless (auto-scale) | No changes needed | Stateless, scales fine |
| DB queries | Direct queries from RSC | Add indexes on `org_id` + status columns | Already has org_id indexes in migration 1 |

---

## Sources

- Codebase analysis: `/Users/haseeb/LeadrWizard/.planning/codebase/ARCHITECTURE.md` (HIGH)
- Direct code inspection: middleware.ts, stripe/payment webhook routes, billing adapter, org-manager, widget hook (HIGH)
- Next.js App Router server actions: [Wisp CMS Route Handler vs Server Action](https://www.wisp.blog/blog/route-handler-vs-server-action-in-production-for-nextjs) (MEDIUM)
- Supabase Realtime + Next.js: [Supabase Official Docs](https://supabase.com/docs/guides/realtime/realtime-with-nextjs) (HIGH)
- Stripe webhook signature verification: [Stripe Official Docs](https://docs.stripe.com/webhooks/signature) (HIGH)
- Stripe idempotency pattern: [Stripe Webhooks Guide](https://docs.stripe.com/webhooks) (HIGH)
- Supabase RLS multi-tenant: [Supabase RLS Docs](https://supabase.com/docs/guides/database/postgres/row-level-security) (HIGH)
- Pino + Vercel structured logging: [Arcjet Structured Logging](https://blog.arcjet.com/structured-logging-in-json-for-next-js/) (MEDIUM)
- Pino Vercel template: [Vercel Pino Template](https://vercel.com/templates/next.js/pino-logging) (MEDIUM)

---

*Architecture research for: LeadrWizard — multi-tenant AI onboarding SaaS*
*Researched: 2026-03-13*
