# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-13)

**Core value:** Clients get onboarded without human intervention. The agent asks the right questions through the right channel at the right time, and services get set up automatically.
**Current focus:** Phase 2 — Self-Service Signup

## Current Position

Phase: 2 of 8 (Self-Service Signup) -- COMPLETE
Plan: 3 of 3 in current phase -- COMPLETE
Status: Phase 2 complete, ready for Phase 3
Last activity: 2026-03-14 — Completed plan 02-03 (setup wizard + signup success page)

Progress: [████████░░] 40%

## Performance Metrics

**Velocity:**
- Total plans completed: 8
- Average duration: 4 min
- Total execution time: 33 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-security-foundation | 5 | 25 min | 5 min |
| 02-self-service-signup | 3 | 8 min | 3 min |

**Recent Trend:**
- Last 5 plans: 01-04 (3 min), 01-05 (8 min), 02-01 (1 min), 02-02 (3 min), 02-03 (4 min)
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Interleave hardening + features per phase — ship usable increments while tightening security progressively
- [Roadmap]: ORG-01/02 placed in Phase 4 (Org Settings) — they are config, not foundational security
- [Roadmap]: ORG-03 (atomic payment handler) placed in Phase 1 — it prevents orphaned records on the same failure surface as the other security fixes
- [Roadmap]: ORG-04 (dead letter queue) placed in Phase 4 — admin UI for DLQ belongs alongside other org operational controls
- [Roadmap]: Phase 7 depends on Phase 1, not Phase 6 — rate limiting and logging can run after security foundation regardless of widget progress
- [01-01]: provision_client placed in 00005 alongside RLS hardening — both security foundational, single migration boundary
- [01-01]: No RLS on processed_webhook_events — service role only, RLS overhead with zero security benefit
- [01-01]: interactions_valid_session_insert uses session_id EXISTS check for consistency with response insert pattern
- [01-02]: Pinned stripe to exact 20.4.1 (no ^ caret) — security-critical dependency, no surprise upgrades
- [01-02]: Used Stripe API version 2026-02-25.clover (latest stable, from SDK's ApiVersion constant)
- [01-02]: getStripeClient() creates per-call instance — avoids boot failures when STRIPE_SECRET_KEY missing at import time
- [01-02]: Stripe v20 moved current_period_start/end to SubscriptionItem; invoice.subscription to parent.subscription_details
- [01-03]: Return 200 on duplicate webhooks, not 4xx/5xx — Stripe retries on 5xx causing infinite loops
- [01-03]: Upsert processed_webhook_events BEFORE processing to prevent race conditions under concurrent requests
- [01-03]: Replace body.org_id fallback with x-internal-secret + x-org-id headers — body never trusted for org resolution
- [01-03]: STRIPE_WEBHOOK_SECRET missing throws at verification time, not silently passes
- [01-04]: Fetch-after-rpc pattern — plpgsql returns IDs, TypeScript fetches full rows using existing types
- [01-04]: GHL provisioning and outreach queue remain outside rpc() — external API calls cannot participate in DB transactions
- [Phase 01-05]: widget write path uses fetch() to admin API so that RLS-removed anon insert policies are never needed
- [Phase 01-05]: apiBaseUrl defaults to empty string so fetch() is relative URL in dev (same-origin)
- [Phase 01-05]: interaction_log insert moved fully server-side — widget never touches interaction_log directly
- [Phase 01-05]: org_id and client_id resolved from server-validated session — never trusted from client request body
- [02-01]: provision_org follows provision_client pattern from 00005 for consistency
- [02-01]: Idempotent on stripe_customer_id to handle webhook retries safely
- [02-01]: 30-day hardcoded initial period, updated by customer.subscription.updated event
- [02-01]: Slug collision appends random 6-char suffix; empty slugs get generated fallback
- [02-02]: Branch checkout.session.completed on metadata.signup flag rather than absence of org_id
- [02-02]: handleNewOrgSignup creates org before user (recoverable failure mode)
- [02-02]: Idempotent on duplicate webhooks via provision_org result.idempotent flag
- [02-02]: constructEvent added to billing barrel export for consistency
- [02-03]: Wizard visibility gated on onboarding_completed boolean AND missing services/packages
- [02-03]: Integration check looks for twilio_account_sid or ghl_api_key in org settings JSON
- [02-03]: getUserOrg imported from @leadrwizard/shared/tenant for org resolution
- [02-03]: Success page placed in (auth) route group for minimal layout (no sidebar)

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Vapi webhook signature verification not covered by any requirement — research flagged this. May surface during Phase 1 planning.
- [Phase 6]: ElevenLabs voice + form hybrid state machine needs design before implementation — complex UX with shared state across mode switches.
- [Phase 7]: Upstash Redis account setup is a deployment dependency — must be provisioned before Phase 7 can ship.

## Session Continuity

Last session: 2026-03-14
Stopped at: Completed 02-03-PLAN.md (setup wizard + signup success page). Phase 2 complete.
Resume file: None
