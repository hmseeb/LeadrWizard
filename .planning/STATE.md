# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-13)

**Core value:** Clients get onboarded without human intervention. The agent asks the right questions through the right channel at the right time, and services get set up automatically.
**Current focus:** Phase 1 — Security Foundation

## Current Position

Phase: 1 of 8 (Security Foundation)
Plan: 5 of 5 in current phase (phase complete)
Status: In progress
Last activity: 2026-03-14 — Completed plan 01-05 (authenticated widget response API route + widget hook refactor)

Progress: [█████░░░░░] 25%

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: 5 min
- Total execution time: 25 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-security-foundation | 5 | 25 min | 5 min |

**Recent Trend:**
- Last 5 plans: 01-01 (2 min), 01-02 (9 min), 01-03 (3 min), 01-04 (3 min), 01-05 (8 min)
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

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Vapi webhook signature verification not covered by any requirement — research flagged this. May surface during Phase 1 planning.
- [Phase 2]: `stripe-adapter.ts` may be disconnected from tenant provisioning — requires code inspection before planning Phase 2.
- [Phase 6]: ElevenLabs voice + form hybrid state machine needs design before implementation — complex UX with shared state across mode switches.
- [Phase 7]: Upstash Redis account setup is a deployment dependency — must be provisioned before Phase 7 can ship.

## Session Continuity

Last session: 2026-03-14
Stopped at: Completed 01-05-PLAN.md (authenticated widget response API route + widget hook refactor)
Resume file: None
