# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-13)

**Core value:** Clients get onboarded without human intervention. The agent asks the right questions through the right channel at the right time, and services get set up automatically.
**Current focus:** Phase 8 — Realtime Dashboard

## Current Position

Phase: 8 of 8 (Realtime Dashboard)
Plan: 1 of 2 in current phase
Status: In Progress
Last activity: 2026-03-14 — Completed plan 08-01 (org_id on escalations + realtime publication)

Progress: [█████████████████████████] 96%

## Performance Metrics

**Velocity:**
- Total plans completed: 25
- Average duration: 4 min
- Total execution time: 89 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-security-foundation | 5 | 25 min | 5 min |
| 02-self-service-signup | 3 | 8 min | 3 min |
| 03-admin-crud-content | 4 | 14 min | 4 min |
| 04-org-settings-isolation | 4 | 15 min | 4 min |
| 05-widget-core-flow | 3 | 9 min | 3 min |
| 06-widget-voice-security | 2 | 3 min | 2 min |
| 07-rate-limiting-logging | 3 | 13 min | 4 min |
| 08-realtime-dashboard | 1 | 2 min | 2 min |

**Recent Trend:**
- Last 5 plans: 06-01 (2 min), 07-01 (4 min), 07-03 (2 min), 07-02 (7 min), 08-01 (2 min)
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
- [04-04]: moveToDLQ resolves org_id via client_services -> clients join chain (no direct org_id on service_tasks)
- [04-04]: Escalation creation failure does not block DLQ insertion (try/catch around createEscalation)
- [04-04]: retryDLQEntry resets attempt_count to 0 and status to in_progress for fresh retry cycle
- [04-04]: GHL handlers updated from 3 to 5 attempts with exponential backoff (was fixed 30min intervals)
- [04-03]: Encrypted values NEVER sent to client: server component passes has_*_creds booleans, not encrypted strings
- [04-03]: Credential inputs always empty on load (security best practice, admin re-enters to update)
- [04-03]: Cadence display is read-only for v1, editing deferred to future phase
- [04-03]: Provision number button appears only after Twilio creds saved
- [04-03]: Dynamic import for provisionTwilioNumber to avoid pulling automations into admin bundle
- [04-02]: Optional orgConfig parameter pattern: adapters accept per-org creds as last optional param, fall back to env vars when absent
- [04-02]: getOrgCredentials returns empty object when org has no credentials, enabling graceful fallback
- [04-02]: Twilio provisioner uses raw REST API (no SDK) consistent with existing twilio-sms.ts pattern
- [04-02]: Config functions (getTwilioConfig, getGHLConfig, getVapiConfig) exported for direct use by settings UI
- [05-01]: Service role client for widget reads: bypasses RLS since widget has no auth context, server validates session existence
- [05-01]: Both active AND completed sessions returned from GET: completed sessions load completion screen, only invalid/abandoned get 404
- [05-01]: Client fields limited to id/name/business_name: email and phone not exposed to widget for privacy
- [05-01]: completionPct updated on every POST submission: dashboard always shows accurate progress
- [05-02]: Flat ServiceWithProgress shape (clientServiceId, serviceId, serviceName) instead of nested objects: matches API response directly
- [05-02]: Default mode changed from 'voice' to 'visual': voice is Phase 6 scope
- [05-02]: stepError displays user-friendly message after all retry attempts fail, clearable via clearStepError callback
- [05-02]: withRetry is a standalone generic utility: clean, testable, no framework dependencies
- [05-03]: Voice toggle and VoiceBot removed from WizardWidget rendering but component files preserved for Phase 6
- [05-03]: Completion screen shows next-steps section with 3 bullet points explaining post-onboarding flow
- [05-03]: ProgressBar unchanged from 05-02: already uses flat ServiceWithProgress shape
- [06-01]: VoiceBot onAnswer scans missingFields to find matching service for clientServiceId resolution
- [06-01]: Completion screen shows in voice mode via StepRenderer fallthrough (no mode-switch forced)
- [06-02]: Three-tier origin detection: ancestorOrigins (Chromium) > document.referrer (Firefox) > window.location.origin (direct script tag)
- [06-02]: Validation runs before any DOM manipulation or React mounting to prevent flash of content on unauthorized domains
- [07-01]: Lazy Redis init via getRedis() prevents boot crashes when UPSTASH env vars are missing (build time, tests)
- [07-01]: pino-pretty installed as regular dependency (not dev) since pino resolves transport targets at runtime
- [07-01]: Sentry v10 with tunnelRoute /monitoring to bypass ad blockers on client-side error reporting
- [07-01]: serverExternalPackages at top level per Next.js 15 convention (not under experimental)
- [07-03]: Used x-forwarded-for and x-real-ip headers for IP extraction (request.ip not available in NextRequest type)
- [07-03]: Rate limiting runs before Supabase auth to short-circuit early on abuse
- [07-03]: Fail-open on Upstash errors so rate limiter outage never blocks legitimate requests
- [07-03]: Correlation ID set on both request (for downstream handlers) and response (for client debugging)
- [07-02]: Module-level loggers for shared package files (called outside request context, no correlation_id)
- [07-02]: No Sentry in shared package (framework-agnostic, errors bubble up to route handlers)
- [07-02]: err key (not error) in pino log objects to trigger built-in error serializer
- [07-02]: Vapi route uses moduleLog for helper functions outside handler scope
- [08-01]: Nullable-first backfill pattern for org_id on escalations: add nullable, UPDATE from clients join, SET NOT NULL
- [08-01]: createEscalation resolves org_id from client as fallback so existing callers need no changes
- [08-01]: Direct inserts in Twilio/Vapi/website-builder do separate org_id lookup rather than refactoring to use createEscalation

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Vapi webhook signature verification not covered by any requirement — research flagged this. May surface during Phase 1 planning.
- [Phase 6]: ElevenLabs voice + form hybrid state machine needs design before implementation — complex UX with shared state across mode switches.
- [Phase 7]: Upstash Redis account setup is a deployment dependency — must be provisioned before Phase 7 can ship.

## Session Continuity

Last session: 2026-03-14
Stopped at: Completed 08-01-PLAN.md (org_id on escalations + realtime publication)
Resume file: None
