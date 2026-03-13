# Project Research Summary

**Project:** LeadrWizard — AI-powered autonomous onboarding SaaS
**Domain:** Multi-tenant agency platform (brownfield milestone — completing remaining 25%)
**Researched:** 2026-03-13
**Confidence:** HIGH

## Executive Summary

LeadrWizard is a multi-tenant SaaS platform that automates client onboarding for agencies using voice AI, SMS, and form-based data collection. The core engine (agent routing, outreach scheduling, widget IIFE bundle, multi-channel comms) already works. This milestone closes a specific gap: the platform cannot yet safely take self-service payments, the widget has no hardened e2e flow, admin CRUD is missing, and several critical security vulnerabilities exist in production code. The research confirms this is a hardening + completion effort, not a greenfield build.

The recommended approach is phased from security-first to feature-complete. Three critical vulnerabilities must be patched before anything else ships to production: the Stripe webhook accepts requests without signature verification (any actor can forge a paid signup), the payment webhook accepts `body.org_id` without authentication (account takeover vector), and the RLS policies allow anonymous cross-org session injection. These are not theoretical — they are active exploits against currently-deployed code. Every other feature in the roadmap depends on this security layer being correct first.

The most significant architectural decisions have already been made and are sound. Turborepo monorepo, Next.js 15 App Router with RSC + server actions, Supabase with RLS, and the Vite IIFE widget bundle are all well-matched to the domain. The new libraries needed are minimal: `pino` for structured logging, `@upstash/ratelimit` for serverless-safe rate limiting, and the Stripe CLI for local webhook testing. The voice + form hybrid widget is the genuine competitive differentiator — most SaaS tools are form-only.

---

## Key Findings

### Recommended Stack

The stack is locked and appropriate. No architectural changes needed. New additions are surgical: `pino@10.3.1` for structured JSON logging (replaces `console.error` throughout), `@upstash/ratelimit@2.0.8` + `@upstash/redis@1.37.0` for serverless-compatible rate limiting (the existing in-memory rate limiter resets on every Vercel cold start and is non-functional in production), and the Stripe CLI for local webhook development.

Supabase Realtime requires a config change, not a new library. Switch from `postgres_changes` (scales badly — one DB read per subscriber per event) to Broadcast via database triggers (official production recommendation). The existing `@supabase/supabase-js@2.49.0` handles both.

**Core new technologies:**
- `pino@10.3.1`: structured JSON logging — fastest Node.js logger, Vercel-native, correlation ID support via child loggers. Node.js runtime only (not Edge).
- `@upstash/ratelimit@2.0.8`: sliding window rate limiting — HTTP-based Redis, works in both Vercel Edge and Node.js runtimes. Replaces broken in-memory store.
- `@upstash/redis@1.37.0`: HTTP Redis client — peer dep of ratelimit, no persistent connection overhead.
- Stripe CLI v1.37.3: local webhook forwarding — outputs correct `whsec_` signing secret automatically. No ngrok needed.
- Supabase Realtime Broadcast: production-grade realtime — fan-out at channel level, not per-subscriber DB reads.

**Critical version constraints:**
- `stripe@20.4.1`: must use `request.text()` (not `request.json()`) before `constructEvent()` — App Router does not buffer the body.
- `pino`: incompatible with Edge Runtime (`middleware.ts`). API routes only.

### Expected Features

This milestone is a completion sprint, not an MVP build. The full scope was already defined in product requirements. Research confirms what's essential vs. what to defer.

**Must have (table stakes for this milestone):**
- Stripe webhook signature verification — currently missing, blocks safe payment processing
- Idempotency on payment and Stripe webhooks — Stripe retries for 3 days; without this, duplicate orgs and clients accumulate
- Self-service org signup (Stripe checkout → provisioned org with admin access)
- Admin CRUD: service definitions, packages, message templates — agencies can't use the product without these
- Org settings UI: Twilio SID/token, GHL API key, cadence config
- Widget e2e: session load, form steps, response submission, completion state
- Widget voice + form hybrid: ElevenLabs voice AND form-based data collection in the same session
- RLS hardening: remove anonymous `with check (true)` policies, scope to validated sessions
- Supabase-backed rate limiting (replace non-functional in-memory store)
- Structured logging with correlation IDs
- Real-time dashboard updates via Supabase Realtime

**Should have (competitive differentiators, v1.x after core stable):**
- Per-org Twilio phone number (dedicated number per agency, not shared pool)
- Per-org GHL credentials (encrypted, isolated per org — shared credentials is a security risk)
- Atomic payment handler / saga pattern (prevents orphaned records on partial provisioning failure)
- Dead letter queue for failed service tasks (ops visibility + retry without code)
- Website revision approval via widget (fixes known broken flow)
- Sentry error tracking (add when production volume justifies)

**Defer to v2+:**
- White-labeling per org (scope explosion: custom CSS, domains, email senders)
- Client-facing portal (second product with its own auth surface)
- Advanced analytics dashboards (charting infra is weeks; basic KPI cards suffice)
- Custom domain per org (wildcard SSL, DNS per org, fragile at early stage)
- Automated billing usage metering (wrong metering = billing disputes)

### Architecture Approach

The layered monorepo architecture is correct and should not change. Presentation layer (`apps/admin`, `apps/widget`) sits above an API + middleware layer which calls into the shared domain logic layer (`packages/shared`). The key pattern for new features: RSC pages do server-side initial fetches, server actions handle CRUD mutations (co-located with their route, not in a shared barrel), and a thin API route layer handles external callers (webhooks, widget, third-party integrations). Admin CRUD does NOT get API routes — server actions only.

The most important architectural fix for this milestone: widget response submission must move from direct anonymous Supabase inserts to a server-side API route (`POST /api/widget/response`) that validates the session, resolves `org_id` server-side, and then inserts with proper authorization. This closes the cross-org injection vector and enables server-side rate limiting per session.

**Major components and their responsibilities:**
1. `apps/admin` — RSC dashboard, server actions for mutations, API routes for external callers
2. `apps/widget` — Vite IIFE bundle, shadow DOM, ElevenLabs voice + form hybrid, reads from Supabase anon, writes via API route
3. `packages/shared/billing` — Stripe checkout, subscription lifecycle, webhook processing, org provisioning trigger
4. `packages/shared/tenant` — Org CRUD, member management, invitation flow
5. `packages/shared/automations` — Payment handler (needs atomicity fix), outreach scheduling, task processing
6. `packages/shared/logger` — New: Pino shared logger factory with correlation ID support
7. `supabase/migrations` — RLS policy updates, idempotency tables, Realtime trigger for Broadcast

### Critical Pitfalls

1. **Stripe webhook without signature verification (active exploit)** — Current code fetches the `stripe-signature` header but never calls `constructEvent()`. One-line fix: `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)`. Must use `request.text()`, not `request.json()`. Add before any logic runs.

2. **Payment webhook `body.org_id` fallback (account takeover)** — If no API key or signature resolves, the handler falls back to trusting `body.org_id` from the request body. Any attacker can POST with a victim org's UUID and trigger a full onboarding flow. Delete the fallback. Replace internal test access with an `X-Internal-Secret` header checked against an env var.

3. **Anonymous RLS `with check (true)` on sessions and responses (cross-org injection)** — Three policies in migration `00001` allow any anonymous client to create sessions under any `org_id` and insert responses. Fix: remove `sessions_anon_insert` and `sessions_anon_update`, scope `responses_anon_insert` to `where exists (select 1 from onboarding_sessions where id = session_id and status = 'active')`. Move session creation entirely server-side.

4. **Non-atomic payment handler (orphaned records on failure)** — `payment-handler.ts` runs 7 sequential inserts with no transaction. If step 5 (session creation) fails after client and client_package records committed, the client paid but never gets contacted. Fix: wrap client + client_package + client_services + session creation in a `plpgsql` function via `supabase.rpc('provision_client', {...})`. GHL stays fire-and-forget (correct).

5. **In-memory rate limiter broken on serverless (non-functional in production)** — The existing `checkRateLimit` in `packages/shared/utils/rate-limiter.ts` uses a `Map` that resets on every Vercel cold start. Rate limits never accumulate in production. Replace with `@upstash/ratelimit` using Upstash Redis HTTP client.

---

## Implications for Roadmap

Research produces a clear 6-phase dependency chain. Security must precede self-service, self-service must precede admin CRUD (orgs must exist before CRUD makes sense), CRUD must precede widget e2e (service definitions drive widget steps), observability belongs before production exposure, and realtime is the final layer added once everything else is stable.

### Phase 1: Security Foundation

**Rationale:** Three active exploits exist in deployed code. Nothing else ships until these are closed. This is the highest-leverage work in the milestone — every subsequent phase assumes a hardened security baseline.

**Delivers:** Stripe webhook signature verification, idempotency checks on both webhook handlers, removal of anonymous RLS policies, deletion of `body.org_id` auth fallback, widget response submission moved to authenticated API route.

**Addresses features:** Stripe webhook signature verification (P1), idempotency on payment webhook (P1), RLS hardening (P1).

**Avoids pitfalls:** Pitfalls 1, 2, 3, 4, 5 — all critical severity.

### Phase 2: Multi-Tenant Self-Service Signup

**Rationale:** Platform currently cannot onboard new agencies without manual provisioning. Self-service is table stakes for a SaaS product. Depends on Phase 1: webhook must be verified before it can safely provision orgs.

**Delivers:** Stripe checkout → `checkout.session.completed` webhook → auto-provision org + membership + subscription record → welcome email with admin access. End-to-end verifiable with Stripe CLI.

**Uses:** `stripe@20.4.1`, Stripe CLI local forwarding, `packages/shared/tenant/org-manager.ts`, `packages/shared/billing/stripe-adapter.ts`.

**Implements:** Multi-tenant org provisioning flow. Idempotency check prevents duplicate orgs on Stripe retries.

**Avoids pitfalls:** Pitfall 5 (duplicate event → duplicate subscription), Pitfall 4 (partial provisioning).

### Phase 3: Admin CRUD

**Rationale:** Agencies need to configure services, packages, and templates before any client onboarding can happen. Admin CRUD is the control plane. Depends on Phase 2: orgs must exist before admins can log in to configure them.

**Delivers:** Service definitions CRUD (create/edit/delete, soft delete to preserve FK integrity), packages CRUD (assign services, pricing metadata), message templates CRUD (preview with variable interpolation), org settings UI (Twilio SID/token, GHL API key, cadence config, encrypted storage).

**Architecture:** Server actions co-located with routes (no API routes for admin CRUD). RSC for reads, server actions for mutations, `revalidatePath` for cache invalidation.

**Avoids pitfalls:** Pitfall 8 (N+1 queries — use Supabase FK expansion, explicit column selects), Pitfall 9 (race conditions — use `RETURNING id` checks + `updated_at` optimistic locking).

### Phase 4: Widget E2E Flow

**Rationale:** The embeddable widget is the product delivery mechanism. It must work end-to-end before any client can complete onboarding. Depends on Phase 3: service definitions drive what questions the widget asks. Depends on Phase 1: response submission must go through hardened API route, not direct anon inserts.

**Delivers:** Widget session load, step-by-step form rendering with progress indicator, per-step response submission via `/api/widget/response`, completion state, error recovery with retry. Voice + form hybrid: ElevenLabs voice mode AND form fallback in the same session, shared state, client can switch mid-flow. Widget origin validation (`allowedOrigins` in `init()`).

**Uses:** Existing Vite IIFE bundle + shadow DOM setup (no new libraries). `POST /api/widget/response` route (new, thin). ElevenLabs browser SDK already integrated.

**Avoids pitfalls:** Pitfall 7 (widget embedded on untrusted domains — origin validation), Pitfall 3 (anon inserts — route enforces server-side org_id resolution).

### Phase 5: Rate Limiting + Structured Logging

**Rationale:** Observability and rate limiting should come before production exposure. Research recommends adding structured logging early (Pitfall 10: adding logging late means retrofitting correlation IDs through every function call chain). Rate limiting is functionally broken in production (in-memory store) — fix before real traffic arrives.

**Delivers:** Pino shared logger in `packages/shared/src/logger/index.ts`, correlation IDs generated in `middleware.ts` and threaded through all route handlers, all `console.error` calls replaced. Upstash Redis-backed rate limiter replacing broken in-memory store. Rate limits applied to webhook endpoints, widget response API, and session API.

**Uses:** `pino@10.3.1`, `pino-pretty` (dev only), `@upstash/ratelimit@2.0.8`, `@upstash/redis@1.37.0`. New env vars: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `LOG_LEVEL`.

**Avoids pitfalls:** Pitfall 10 (logging too late), Pitfall 2b (in-memory rate limiter non-functional on serverless).

### Phase 6: Realtime Dashboard

**Rationale:** Last because it enhances rather than enables. Core functionality works without realtime — agencies can use the dashboard with server-rendered data. Realtime is the polish that makes live monitoring feel native. Depends on all prior phases: data model must be stable and RLS hardened before adding subscriptions.

**Delivers:** Supabase Realtime subscriptions on `onboarding_sessions` and `escalations`. RSC page provides initial server-rendered data, client component wraps and subscribes to changes. Broadcast via `realtime.broadcast_changes()` DB trigger (not `postgres_changes` — scales badly). Org-scoped filters on all subscriptions.

**Uses:** Existing `@supabase/supabase-js@2.49.0`, Broadcast trigger (server-side DB function). No new packages.

**Avoids pitfalls:** Pitfall 6 (Realtime RLS performance — filtered subscriptions + Broadcast instead of `postgres_changes`).

### Phase Ordering Rationale

- Security first because active exploits exist in deployed code. Every subsequent phase assumes this is closed.
- Self-service before CRUD because orgs must exist before admins can configure them.
- CRUD before widget because service definitions are the input to widget step rendering.
- Widget before logging/realtime because it's the highest-value user-facing deliverable.
- Logging and rate limiting before production traffic (ideally alongside other phases, but grouped as a phase for clarity).
- Realtime last because it's additive, not blocking, and depends on stable data model + hardened RLS.

### Research Flags

Phases needing deeper research during planning:
- **Phase 2 (Self-Service Signup):** Stripe checkout session metadata pattern needs validation against actual `processStripeWebhook` code path to confirm `org-manager.ts` is correctly wired. Per ARCHITECTURE.md, `stripe-adapter.ts` is currently disconnected from tenant provisioning.
- **Phase 4 (Widget E2E):** ElevenLabs voice + form hybrid state machine needs design before implementation. The "client can switch mode mid-flow with shared state" is complex UX. Verify ElevenLabs SDK browser compatibility across target environments.
- **Phase 5 (Rate Limiting):** Upstash Redis account setup and env var provisioning is a deployment dependency — needs to be done before phase can ship. Confirm Vercel env var access pattern.

Phases with standard patterns (skip research-phase):
- **Phase 3 (Admin CRUD):** Server actions + RSC is well-documented Next.js 15 pattern. Supabase FK expansion for avoiding N+1 is documented in official Supabase docs.
- **Phase 6 (Realtime Dashboard):** Supabase Broadcast pattern is documented in official Supabase docs. RSC + client component split is a standard Next.js pattern.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All libraries verified against npm registry and official docs. No greenfield decisions needed. |
| Features | HIGH (security/webhooks), MEDIUM (widget hybrid UX) | Webhook security patterns are industry-standard with official documentation. Voice + form hybrid completion rate uplift (34% cited) is a single-source claim. |
| Architecture | HIGH | Based on direct codebase inspection + official docs for all patterns (server actions, Realtime Broadcast, Stripe signature verification). |
| Pitfalls | HIGH | Pitfalls 1-5 are grounded in direct code inspection of actual files. Not inferred — actual vulnerable lines identified and cited. |

**Overall confidence:** HIGH

### Gaps to Address

- **ElevenLabs browser SDK stability:** Research notes "ElevenLabs beta drops connection silently" as a known failure mode. No authoritative documentation on reliability SLAs. Design widget voice mode with fallback-to-form as the happy path, not an edge case.
- **Twilio sub-account provisioning (deferred v1.x):** Per-org Twilio numbers require Twilio sub-account API which has non-trivial setup. Deferred correctly to v1.x — but when scoped, needs its own research spike on A2P registration implications.
- **GHL sub-account API reliability:** PITFALLS.md notes GHL API is "slow and flaky." The payment handler already moves GHL to async `service_task` with retry (correct). Verify current implementation does this correctly before closing Phase 1.
- **Vapi signature verification:** ARCHITECTURE.md flags `/api/webhooks/vapi` as "unknown" for signature verification. Research did not cover Vapi's webhook signature scheme. Should be addressed in Phase 1 alongside Stripe.

---

## Sources

### Primary (HIGH confidence)
- [Stripe official webhook docs](https://docs.stripe.com/webhooks) — idempotency, retry behavior, signature verification
- [Stripe CLI install/use docs](https://docs.stripe.com/stripe-cli) — local webhook forwarding, `whsec_` secret
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Supabase Realtime official docs](https://supabase.com/docs/guides/realtime/getting_started) — Broadcast vs postgres_changes production recommendation
- [Supabase RLS official docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits) — per-subscriber RLS evaluation cost
- Codebase direct inspection: `apps/admin/src/app/api/webhooks/stripe/route.ts`, `apps/admin/src/app/api/webhooks/payment/route.ts`, `packages/shared/src/automations/payment-handler.ts`, `supabase/migrations/00001_initial_schema.sql`
- `.planning/codebase/ARCHITECTURE.md` — first-party codebase analysis

### Secondary (MEDIUM confidence)
- [Upstash blog: Next.js rate limiting](https://upstash.com/blog/nextjs-ratelimiting) — Upstash + Next.js middleware pattern
- [Vercel template: rate limit with Upstash](https://vercel.com/templates/next.js/ratelimit-with-upstash-redis)
- [Wisp CMS: Route Handler vs Server Action in Next.js](https://www.wisp.blog/blog/route-handler-vs-server-action-in-production-for-nextjs)
- [SigNoz pino guide 2026](https://signoz.io/guides/pino-logger/)
- [MakerKit: Supabase RLS best practices](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
- [Stigg: Stripe webhook post-mortem](https://www.stigg.io/blog-posts/best-practices-i-wish-we-knew-when-integrating-stripe-webhooks)
- [Kitson Broadhurst: Next.js App Router + Stripe signature verification](https://kitson-broadhurst.medium.com/next-js-app-router-stripe-webhook-signature-verification-ea9d59f3593f)

### Tertiary (LOW confidence — needs validation)
- Voice + form hybrid 34% response rate uplift claim — single source, unverified
- ElevenLabs beta reliability characterization — community observation, no official SLA data

---
*Research completed: 2026-03-13*
*Ready for roadmap: yes*
