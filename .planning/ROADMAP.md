# Roadmap: LeadrWizard

## Overview

Brownfield completion sprint closing the final 25% of a working onboarding platform. The core engine already works end-to-end. What remains is a specific gap: three active security exploits must be patched first, then self-service agency signup, admin control plane, widget e2e flow, and production observability. Eight phases, each delivering a coherent and independently verifiable capability, sequenced by hard dependency.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Security Foundation** - Patch three active exploits and harden all public entry points before anything else ships (completed 2026-03-13)
- [x] **Phase 2: Self-Service Signup** - Agencies complete Stripe checkout and get a provisioned org with admin access automatically (completed 2026-03-14)
- [x] **Phase 3: Admin CRUD: Content** - Admins can create and manage service definitions, packages, and message templates (completed 2026-03-14)
- [x] **Phase 4: Org Settings + Per-Org Isolation** - Each org has its own credentials, phone number, and isolated operational config (completed 2026-03-14)
- [x] **Phase 5: Widget Core Flow** - Embeddable widget loads a session, collects responses step-by-step, and reaches completion state (completed 2026-03-14)
- [x] **Phase 6: Widget Voice + Security** - Voice/form hybrid works in the same session and widget validates its embedding origin (completed 2026-03-14)
- [x] **Phase 7: Rate Limiting + Structured Logging** - Production-grade rate limiting replaces the broken in-memory store; pino logs replace console.error everywhere (completed 2026-03-14)
- [x] **Phase 8: Realtime Dashboard** - Admin dashboard updates in realtime without page refresh via Supabase Postgres Changes (completed 2026-03-14)

## Phase Details

### Phase 1: Security Foundation
**Goal**: Three active exploits in deployed code are closed and all public webhook entry points are hardened against forgery, replay, and unauthorized org resolution
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, ORG-03
**Success Criteria** (what must be TRUE):
  1. A POST to `/api/webhooks/stripe` with an invalid signature returns 400 and no processing occurs
  2. Replaying a previously processed Stripe or payment webhook event (same event.id) is silently skipped, no duplicate client or org is created
  3. An anonymous Supabase client cannot directly insert a session or response for any org_id — server-side validation is required
  4. Removing `body.org_id` from a payment webhook payload does not allow the request to proceed without a valid API key or signature
  5. A widget response submission that bypasses the API route (direct anon insert) is rejected at the database level
  6. A partial provisioning failure during payment handling rolls back all created records atomically — no orphaned client or client_package rows exist
**Plans**: 5 plans

Plans:
- [x] 01-01-PLAN.md — DB migrations: idempotency table + RLS hardening + provision_client function
- [ ] 01-02-PLAN.md — Install stripe SDK + refactor stripe-adapter.ts to use SDK client
- [ ] 01-03-PLAN.md — Stripe webhook signature verification (SEC-01) + idempotency in both webhooks (SEC-02) + remove body.org_id fallback (SEC-04)
- [ ] 01-04-PLAN.md — Atomic payment handler via supabase.rpc('provision_client') (ORG-03)
- [ ] 01-05-PLAN.md — Widget response API route with CORS + refactor widget hook write path (SEC-05)

### Phase 2: Self-Service Signup
**Goal**: An agency can go from paying on Stripe to having a provisioned org with admin access and an actionable empty state, without any manual intervention
**Depends on**: Phase 1
**Requirements**: SIGN-01, SIGN-02, SIGN-03, SIGN-04
**Success Criteria** (what must be TRUE):
  1. Completing a Stripe checkout session creates an org record, membership, and subscription in the database within the same webhook handler execution
  2. The new org admin receives a welcome email containing a working link to set their password and access the dashboard
  3. After logging in for the first time, the admin sees an empty-state setup wizard with clear steps: add services, configure package, set up integrations
  4. A developer running locally can trigger the `checkout.session.completed` webhook via Stripe CLI and see the full provisioning flow execute against the dev database
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — Database migration: provision_org plpgsql function for atomic org + subscription creation (SIGN-01)
- [x] 02-02-PLAN.md — Public checkout endpoint + webhook new-signup branch + Supabase auth invite (SIGN-01, SIGN-02, SIGN-04)
- [x] 02-03-PLAN.md — Empty-state setup wizard on dashboard + signup success page (SIGN-03)

### Phase 3: Admin CRUD: Content
**Goal**: Admins can create and manage the content that drives onboarding: service definitions, packages, and message templates
**Depends on**: Phase 2
**Requirements**: CRUD-01, CRUD-02, CRUD-03
**Success Criteria** (what must be TRUE):
  1. Admin can create a service definition with required_data_fields and setup_steps, edit it, and soft-delete it — soft-deleted services no longer appear in package assignment but their FKs are preserved
  2. Admin can create a package, assign services to it, set pricing metadata, edit it, and delete it
  3. Admin can create a message template for a specific channel (SMS, email, voice), edit it, preview the rendered output with variable substitution, and delete it
**Plans**: 4 plans

Plans:
- [x] 03-01-PLAN.md — Database migration: message_templates table + package_services write RLS fix (CRUD-02, CRUD-03)
- [x] 03-02-PLAN.md — Services CRUD: server actions + form with dynamic field builders + page routes (CRUD-01)
- [ ] 03-03-PLAN.md — Packages CRUD: server actions + form with service assignment + page routes (CRUD-02)
- [ ] 03-04-PLAN.md — Message Templates CRUD: server actions + form with live preview + page routes (CRUD-03)

### Phase 4: Org Settings + Per-Org Isolation
**Goal**: Each org operates with fully isolated credentials and its own dedicated Twilio phone number, configured through a self-service settings UI
**Depends on**: Phase 3
**Requirements**: CRUD-04, CRUD-05, ORG-01, ORG-02, ORG-04
**Success Criteria** (what must be TRUE):
  1. Admin can enter Twilio account SID/auth token and GHL API key via the org settings UI — credentials are stored encrypted per-org, not shared globally
  2. An outreach SMS from one org uses that org's dedicated Twilio phone number, not a shared pool number
  3. A CRM operation for org A uses org A's GHL API key — org B's key is never accessed or used
  4. A service task that fails 5 or more times is moved to a dead letter queue, visible in the admin UI with a retry action
**Plans**: 4 plans

Plans:
- [ ] 04-01-PLAN.md — DB migration: encrypted credential columns + DLQ table + UPDATE RLS (CRUD-05, ORG-04)
- [ ] 04-02-PLAN.md — Adapter refactoring: per-org credential injection in Twilio/GHL/Vapi + Twilio provisioner (ORG-01, ORG-02)
- [ ] 04-03-PLAN.md — Settings UI: credential forms + cadence display + escalation config (CRUD-04)
- [ ] 04-04-PLAN.md — Dead letter queue: task-processor DLQ logic + admin DLQ page with retry/dismiss (ORG-04)

### Phase 5: Widget Core Flow
**Goal**: An embedded widget can load a session, walk the client through data collection step-by-step, and reach a confirmed completion state
**Depends on**: Phase 3
**Requirements**: WIDG-01, WIDG-03, WIDG-04, WIDG-05
**Success Criteria** (what must be TRUE):
  1. Embedding the widget with a valid sessionId renders the correct questions fetched from the API with a progress bar showing position in the flow
  2. Submitting a step response advances the widget to the next step — the response is persisted server-side via the authenticated API route (not a direct anon Supabase insert)
  3. After all required fields are collected, the widget displays a completion screen with next-steps messaging
  4. If a step submission fails, the widget retries up to 3 times with exponential backoff and shows a fallback error message if all attempts fail
**Plans**: 3 plans

Plans:
- [ ] 05-01-PLAN.md — Session load API endpoint + auto-completion on response submission (WIDG-01, WIDG-03, WIDG-04)
- [ ] 05-02-PLAN.md — Widget hook refactor: fetch-based reads, retry logic, Supabase removal (WIDG-01, WIDG-03, WIDG-05)
- [ ] 05-03-PLAN.md — Widget UI: completion screen, error/retry display, voice toggle hidden (WIDG-01, WIDG-03, WIDG-04, WIDG-05)

### Phase 6: Widget Voice + Security
**Goal**: Clients can choose between voice and form input within the same session, and the widget validates that it is only embedded on authorized domains
**Depends on**: Phase 5
**Requirements**: WIDG-02, WIDG-06
**Success Criteria** (what must be TRUE):
  1. A client can start in form mode, switch to ElevenLabs voice mode mid-flow, and the session state (collected fields, current step) is preserved across the mode switch
  2. A client can start in voice mode, switch to form mode mid-flow, and collected responses from voice mode are retained
  3. Embedding the widget on a domain not listed in `allowedOrigins` shows an error state instead of the form — the session never loads
**Plans**: 2 plans

Plans:
- [ ] 06-01-PLAN.md — Voice/form hybrid wiring: session API voiceConfig + useWizardSession voiceConfig state + WizardWidget VoiceBot re-enablement (WIDG-02)
- [ ] 06-02-PLAN.md — Origin validation: allowedOrigins parameter in init() with ancestorOrigins/referrer/origin detection (WIDG-06)

### Phase 7: Rate Limiting + Structured Logging
**Goal**: All public endpoints have production-grade rate limiting that persists across serverless cold starts, and every log line carries correlation IDs for debugging
**Depends on**: Phase 1
**Requirements**: SEC-06, OBS-01, OBS-02
**Success Criteria** (what must be TRUE):
  1. Making more than the configured number of requests to a webhook or widget API endpoint within the window returns 429 — this limit holds across multiple Vercel function instances (not reset on cold start)
  2. Every server log line includes correlation_id, org_id, and session_id in structured JSON — no bare `console.error` calls remain in the codebase
  3. An unhandled error in any API route is captured in Sentry with the org_id and session_id attached as tags, visible in the Sentry dashboard
**Plans**: 3 plans

Plans:
- [x] 07-01-PLAN.md — Install deps + pino logger factory + Upstash rate limiter + Sentry config + next.config.ts (SEC-06, OBS-01, OBS-02)
- [ ] 07-02-PLAN.md — Replace all 23 console calls with pino structured logging + Sentry error capture (OBS-01, OBS-02)
- [ ] 07-03-PLAN.md — Middleware rate limiting + correlation ID injection for public endpoints (SEC-06)

### Phase 8: Realtime Dashboard
**Goal**: The admin dashboard reflects live changes to onboarding sessions and escalations without requiring a page refresh
**Depends on**: Phase 7
**Requirements**: OBS-03
**Success Criteria** (what must be TRUE):
  1. When an onboarding session status changes in the database, the sessions list in the admin dashboard updates within 2 seconds without a page reload
  2. When a new escalation is created, it appears in the escalations view in the admin dashboard within 2 seconds without a page reload
  3. Realtime updates are scoped to the logged-in org — an event from org B does not appear in org A's dashboard
**Plans**: 2 plans

Plans:
- [ ] 08-01-PLAN.md — Migration: add org_id to escalations + backfill + enable supabase_realtime publication (OBS-03)
- [ ] 08-02-PLAN.md — Realtime client components: useRealtimeTable hook + RealtimeSessions + RealtimeEscalations + RealtimeDashboard (OBS-03)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

Note: Phase 5 depends on Phase 3 (service definitions drive widget steps). Phase 7 depends on Phase 1. These can be parallelized if desired, but the default order is sequential.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security Foundation | 5/5 | Complete | 2026-03-13 |
| 2. Self-Service Signup | 3/3 | Complete | 2026-03-14 |
| 3. Admin CRUD: Content | 4/4 | Complete | 2026-03-14 |
| 4. Org Settings + Per-Org Isolation | 4/4 | Complete | 2026-03-14 |
| 5. Widget Core Flow | 3/3 | Complete | 2026-03-14 |
| 6. Widget Voice + Security | 2/2 | Complete | 2026-03-14 |
| 7. Rate Limiting + Structured Logging | 3/3 | Complete | 2026-03-14 |
| 8. Realtime Dashboard | 2/2 | Complete | 2026-03-14 |
