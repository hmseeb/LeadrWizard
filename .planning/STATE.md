# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-13)

**Core value:** Clients get onboarded without human intervention. The agent asks the right questions through the right channel at the right time, and services get set up automatically.
**Current focus:** Phase 4 — Org Settings + Per-Org Isolation

## Current Position

Phase: 4 of 8 (Org Settings + Per-Org Isolation)
Plan: 1 of 4 in current phase
Status: Executing
Last activity: 2026-03-14 — Completed plan 04-01 (org credentials foundation)

Progress: [█████████████] 65%

## Performance Metrics

**Velocity:**
- Total plans completed: 13
- Average duration: 4 min
- Total execution time: 50 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-security-foundation | 5 | 25 min | 5 min |
| 02-self-service-signup | 3 | 8 min | 3 min |
| 03-admin-crud-content | 4 | 14 min | 4 min |
| 04-org-settings-isolation | 1 | 3 min | 3 min |

**Recent Trend:**
- Last 5 plans: 03-01 (2 min), 03-02 (5 min), 03-03 (3 min), 03-04 (4 min), 04-01 (3 min)
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
- [03-01]: channel uses 'voice' not 'voice_call' — message templates describe content rendering, not interaction channels
- [03-01]: package_services_modify uses 'for all using(...)' — covers insert/update/delete and acts as with check for inserts
- [03-01]: TEMPLATE_VARIABLES defined as const tuple for type-safe iteration in template editor UI
- [03-02]: Slug auto-generated from name on create, NOT updated on edit to preserve existing references
- [03-02]: softDeleteService sets is_active=false rather than deleting rows to preserve FK references
- [03-02]: DeleteDialog uses native <dialog> element with showModal() for free focus trapping and Escape-to-close
- [03-02]: DataFieldBuilder and SetupStepBuilder serialize arrays as JSON into hidden inputs for FormData
- [03-02]: ServiceForm uses useActionState (React 19) for error handling and pending state
- [03-02]: UI says "Deactivate" not "Delete" since soft-delete is reversible
- [03-03]: Hard delete for packages per requirements ('delete' not 'soft-delete'), FK cascade cleans up package_services
- [03-03]: Delete-then-insert pattern for service assignments on update, simpler than diff-based upsert
- [03-03]: Price stored as integer cents, displayed as dollars with $ prefix, converted via hidden input onChange handler
- [03-03]: Service assignment uses checkbox list not multi-select dropdown for better scannability
- [03-04]: Email templates require subject line, validated server-side in both create and update actions
- [03-04]: Hard delete for message templates (unlike soft-delete for services) since no FK references depend on them
- [03-04]: Templates list page repurposed from niche_templates to message_templates per CRUD-03 requirement
- [03-04]: Sidebar icon changed from Layout to MessageSquare to reflect message templates instead of website templates
- [04-01]: v1: prefix on encrypted values for future key rotation support
- [04-01]: Non-secret identifiers (phone number, location/company/assistant/agent IDs) stored as plain text
- [04-01]: No RLS INSERT on dead_letter_queue — service role inserts only
- [04-01]: DLQ entries never deleted, only retried or dismissed (audit trail)
- [04-01]: Partial index idx_dlq_active filters to non-retried/non-dismissed entries

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Vapi webhook signature verification not covered by any requirement — research flagged this. May surface during Phase 1 planning.
- [Phase 6]: ElevenLabs voice + form hybrid state machine needs design before implementation — complex UX with shared state across mode switches.
- [Phase 7]: Upstash Redis account setup is a deployment dependency — must be provisioned before Phase 7 can ship.

## Session Continuity

Last session: 2026-03-14
Stopped at: Completed 04-01-PLAN.md (org credentials foundation)
Resume file: None
