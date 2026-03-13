# Feature Research

**Domain:** Multi-tenant AI-powered autonomous onboarding SaaS (agency platform)
**Researched:** 2026-03-13
**Confidence:** HIGH (webhook/security patterns), MEDIUM (widget hybrid UX), HIGH (multi-tenant provisioning)

---

## Context: What We're Actually Building

This is a **brownfield milestone**. Core onboarding engine works. What's missing:

1. Self-service org signup (Stripe checkout to provisioned org)
2. Admin CRUD for service definitions, packages, message templates, and org settings
3. Widget e2e: session load, voice + form hybrid, response submission, completion
4. Security hardening: idempotency, rate limiting, webhook verification, RLS
5. Observability: structured logging, real-time dashboard

The research question is: what do users EXPECT from each of these, and what's genuinely differentiating?

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that are assumed present. Missing them = platform feels broken or unprofessional.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Stripe checkout auto-provisions org | Self-service is baseline for modern SaaS. Manual provisioning = unacceptable friction | MEDIUM | Stripe `checkout.session.completed` event triggers org creation, membership, and subscription record. Already partially exists; needs e2e wiring |
| Duplicate payment prevention (idempotency) | Stripe retries webhooks on 5xx. Without idempotency, double-provisioning creates ghost orgs and duplicate client sessions | LOW | Store processed `event.id` in DB before processing; check on receipt. TTL 7-30 days. Stripe official docs confirm this is mandatory for production |
| Stripe webhook signature verification | Any unsigned webhook endpoint is a critical security vulnerability. Every SaaS standard since ~2020 | LOW | `stripe.webhooks.constructEvent(body, sig, secret)`. Currently missing in `/api/webhooks/stripe`. The pattern already exists in `/api/webhooks/payment` |
| Rate limiting on public webhook endpoints | Without limits, anyone can DDoS or brute-force fake payloads at payment endpoint | LOW | 100-500 req/min per IP. Middleware-level. Protects against both abuse and misconfigured retry storms |
| Admin CRUD: service definitions | Agencies need to configure what services they offer. Hard-coded = not a product, it's a script | MEDIUM | Create/edit/delete service definitions with required_data_fields and setup_steps. Standard form-based CRUD with validation |
| Admin CRUD: packages | Agencies bundle services into tiered packages. Without this, every pricing change requires a deploy | MEDIUM | Create/edit packages, assign services, set pricing metadata. Drives Stripe product/price alignment |
| Admin CRUD: message templates | Agencies customize outreach copy. Generic templates = low client engagement | MEDIUM | Create/edit templates by channel (SMS, email, voice). Must support preview with variable interpolation |
| Org settings management | Per-org API credentials (GHL, Twilio), cadence config, branding. Without this, credentials are shared globally which is a security risk | HIGH | Encrypted credential storage per org. Form-based UI for Twilio account SID/auth token, GHL API key, outreach cadence config |
| Widget session load and step rendering | Clients embedded the widget expecting a functional UI. A widget that fails to load = broken product delivery | MEDIUM | Session load via `sessionId`, step-by-step form rendering, progress indicator, submit response per step |
| Widget completion state | Clients need confirmation the widget flow is done. No completion state = confusion about whether submission worked | LOW | Success screen after all required fields collected. Clear messaging with next steps |
| Widget error recovery | If a step fails to submit, client needs feedback and retry. Silent failure = abandoned onboarding | LOW | Per-step error states, retry on transient failures, fallback message if all attempts fail |
| Structured logging with correlation IDs | Production debugging without correlation IDs means hunting blind through logs. Expected by any ops-minded team | LOW | Replace `console.error` with JSON-structured logger. Include `correlation_id`, `org_id`, `session_id` on every log line |
| Real-time dashboard updates | Agencies monitoring active onboardings expect live status, not stale polls. Polling UX feels dated | MEDIUM | Supabase realtime subscriptions on `onboarding_sessions` and `escalations` tables. Replace page refresh pattern |
| RLS policy hardening | Anonymous writes to sessions/responses is a known XSS/CSRF vector. Any security-conscious agency will ask about data isolation | MEDIUM | Sessions and responses writable only via authenticated API with org_id validation. Remove anonymous insert policies |

### Differentiators (Competitive Advantage)

Features that are not assumed, but create genuine competitive advantage in the agency onboarding space.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Voice + form hybrid widget | Most onboarding tools are form-only or voice-only. Hybrid maximizes completion: voice for conversational clients, form for methodical ones. 34% response rate uplift reported for voice vs text | HIGH | ElevenLabs in-widget voice + form steps in same session. Client can switch mode mid-flow. State shared between channels |
| Per-org Twilio phone number | Agencies get a dedicated number, not a shared pool. Improves deliverability, A2P registration, and client trust in SMS sender | HIGH | Twilio sub-account per org with dedicated number. Provisioned at signup. Updates outreach processor to use org-specific number |
| Per-org GHL credentials | Each agency manages their own GHL instance. Shared credentials = single point of compromise across all clients | HIGH | Encrypted credentials stored per org. Decrypted at runtime for API calls. Enables GHL sub-account scoped to each agency |
| Outreach cadence configuration UI | Agencies can tune follow-up timing without a code change or support ticket. Standard SaaS behavior for configurable services | MEDIUM | Settings UI for cadence (initial delay, retry intervals, max attempts, channel order). Persisted in org settings |
| Atomic payment handler with rollback | Partial provisioning (org created, GHL failed) leaves system in broken state. Atomic or saga-patterned provisioning = reliability agencies can trust | HIGH | Saga pattern: step-by-step with explicit compensating actions on failure. Or wrap entire flow in transaction with documented idempotency per step |
| Dead letter queue for failed tasks | Failed A2P, GMB, or website tasks currently disappear after 3 attempts. DLQ gives operators visibility and retry capability without code | MEDIUM | `dead_letter_queue` table. Tasks moved after 5 failures. Admin UI to view and retry. Escalation auto-created |
| Widget domain allowlist | Prevents widget from being scraped or embedded on unauthorized sites. Agencies want their session data protected | LOW | Optional `allowedOrigins` in `LeadrWizard.init()`. Referrer validation on API calls from widget |
| Website revision approval via widget | Current website approval is broken (no handler). A working approval flow lets agencies close the loop without manual task updates | MEDIUM | Widget step type: preview with approve/request-revision. On approve, calls API to mark task delivered. Max 3 revision rounds |
| Sentry error tracking integration | Aggregate error visibility across all orgs. Without it, operators learn about production issues from angry agency emails | LOW | Single Sentry DSN. Enrich with `org_id`, `session_id`, environment tags. Groups errors by source automatically |

### Anti-Features (Things to Deliberately NOT Build)

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| White-labeling per org | Agencies want to present their own brand | Scope explosion: custom CSS, custom domains, email sender domains, widget theming. Each is a multi-week effort | Defer to v2. Use agency name in outreach copy as a low-effort personalization |
| Client-facing portal | Seems like clients should have a dashboard too | Clients interact via widget, SMS, voice. A portal is a second product with its own auth, data model, and support surface | Widget completion states and SMS notifications serve the same need without the complexity |
| Advanced analytics dashboards | Agencies want to see completion rates, channel performance, time-to-onboard | Building charting infra is weeks of work. KPI cards with basic counts are sufficient for launch | Pre-compute hourly snapshots in `analytics_snapshots`. Display 4-5 key numbers. Real analytics in v2 |
| Real-time everything | Feels like a quality signal | WebSocket connections have cost and complexity. Not all data needs sub-second freshness | Realtime only for live session status and escalations. Static reads for admin CRUD |
| Mobile native app | Agencies want to manage on mobile | Web dashboard is responsive enough for v1. Native apps double the maintenance surface | Ensure admin dashboard is mobile-responsive |
| Automated billing usage metering | Usage-based pricing seems more fair | Metering infra (counting SMS sent, voice minutes, clients onboarded per billing period) is complex to get right. Wrong metering = billing disputes | Manual plan limits per org for v1. Upgrade prompts when approaching limits |
| Custom domain per org | Agencies want `onboarding.theiragency.com` | Wildcard SSL, DNS propagation, Vercel domain config per org. Complex and fragile | Shared platform domain with org slug: `leadrwizard.com/agency-name` |
| Per-tenant database schemas | Extreme isolation | Operational complexity, migration headaches, massive overhead at early stage. RLS on shared schema provides sufficient isolation | Shared schema with RLS. Composite indexes on `org_id` for query performance |

---

## Feature Dependencies

```
[Stripe Checkout] ──creates──> [Org Provisioning]
    └──requires──> [Stripe Webhook Signature Verification]
    └──requires──> [Idempotency Key Storage]
    └──requires──> [Atomic Payment Handler]

[Org Provisioning] ──enables──> [Admin Dashboard Access]
    └──enables──> [Admin CRUD: Service Definitions]
        └──enables──> [Admin CRUD: Packages]
            └──enables──> [Stripe Product/Price Alignment]

[Admin CRUD: Service Definitions] ──feeds──> [Widget Step Renderer]
    └──determines──> [Required Data Fields per Service]

[Widget Session Load] ──requires──> [RLS Hardened Session API]
    └──requires──> [Session validation with org_id]

[Widget Voice + Form Hybrid] ──requires──> [Widget Session Load]
    └──requires──> [ElevenLabs voice component functional]
    └──requires──> [Form step submission working]

[Widget Completion] ──requires──> [Widget Voice + Form Hybrid]
    └──requires──> [All required fields collected by agent]

[Website Revision Approval] ──requires──> [Widget Completion States]
    └──requires──> [Widget e2e flow working]

[Per-Org Twilio] ──requires──> [Org Settings Management UI]
    └──requires──> [Encrypted credential storage]

[Per-Org GHL] ──requires──> [Org Settings Management UI]
    └──requires──> [Encrypted credential storage]

[Real-time Dashboard] ──enhances──> [Admin Dashboard]
    └──requires──> [Supabase realtime subscriptions set up]

[Structured Logging] ──enables──> [Sentry Error Tracking]
    └──correlation IDs flow through both

[Rate Limiting] ──protects──> [Stripe Webhook Endpoint]
[Rate Limiting] ──protects──> [Payment Webhook Endpoint]
[Rate Limiting] ──protects──> [Widget Session API]
```

### Dependency Notes

- **Stripe signature verification must precede idempotency**: You need to know the event is authentic before storing its ID as processed. Verify first, then check/store idempotency key.
- **RLS hardening must precede widget e2e**: The widget e2e flow submits responses via API. If anonymous writes are still allowed, hardening mid-flight will break the widget.
- **Admin CRUD for service definitions before packages**: Packages reference service definitions. Services must exist before packages can be built.
- **Org settings before per-org Twilio/GHL**: Credential storage UI is the mechanism for per-org credentials. Can't provision org-specific numbers without somewhere to store them.
- **Atomic payment handler enhances, doesn't block**: The payment flow works today. Making it atomic is a reliability improvement, not a gating dependency. Build it early to avoid accumulating broken partial orgs in production.

---

## MVP Definition

This is a subsequent milestone on an existing platform. "MVP" here means: what's the minimum to make the active requirements shippable safely to production?

### Launch With (this milestone)

- [ ] Stripe webhook signature verification — blocks safe payment processing
- [ ] Idempotency on payment webhook — blocks reliable provisioning
- [ ] Self-service org signup: Stripe checkout to provisioned org with admin access
- [ ] Admin CRUD for service definitions (create, edit, delete)
- [ ] Admin CRUD for packages (create, edit, assign services)
- [ ] Admin CRUD for message templates (create, edit, preview)
- [ ] Org settings UI (Twilio SID/token, GHL key, cadence config)
- [ ] Widget e2e: session load, step rendering, form submission, completion state
- [ ] Widget voice + form hybrid: ElevenLabs voice AND form-based data collection
- [ ] RLS hardening: sessions and responses require org_id validation
- [ ] Rate limiting on public webhook endpoints
- [ ] Structured logging with correlation IDs
- [ ] Real-time dashboard updates via Supabase realtime

### Add After Validation (v1.x)

- [ ] Per-org Twilio phone number provisioning — valuable but requires Twilio sub-account setup; coordinate with billing
- [ ] Per-org GHL credentials — valuable for security isolation; requires encrypted storage implementation
- [ ] Atomic payment handler / saga pattern — reduces partial-failure orphans; add after basic flow is stable
- [ ] Dead letter queue for failed tasks — improves ops visibility; not blocking for launch
- [ ] Sentry error tracking — add when production volume justifies the cost
- [ ] Website revision approval via widget — fixes known broken flow; medium priority

### Future Consideration (v2+)

- [ ] White-labeling per org
- [ ] Advanced analytics dashboards
- [ ] Client-facing portal
- [ ] Custom domain per org
- [ ] Automated billing usage metering

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Stripe webhook signature verification | HIGH | LOW | P1 |
| Idempotency on payment webhook | HIGH | LOW | P1 |
| Self-service org signup (Stripe to provisioned org) | HIGH | MEDIUM | P1 |
| RLS hardening (sessions/responses) | HIGH | MEDIUM | P1 |
| Rate limiting on public webhooks | HIGH | LOW | P1 |
| Admin CRUD: service definitions | HIGH | MEDIUM | P1 |
| Admin CRUD: packages | HIGH | MEDIUM | P1 |
| Admin CRUD: message templates | HIGH | MEDIUM | P1 |
| Org settings management UI | HIGH | HIGH | P1 |
| Widget e2e: session load + form steps | HIGH | MEDIUM | P1 |
| Widget e2e: completion state + error recovery | HIGH | LOW | P1 |
| Widget voice + form hybrid | HIGH | HIGH | P1 |
| Structured logging + correlation IDs | MEDIUM | LOW | P1 |
| Real-time dashboard updates | MEDIUM | MEDIUM | P2 |
| Per-org Twilio number provisioning | HIGH | HIGH | P2 |
| Per-org GHL credentials | HIGH | HIGH | P2 |
| Atomic payment handler / saga pattern | HIGH | HIGH | P2 |
| Dead letter queue for failed tasks | MEDIUM | MEDIUM | P2 |
| Website revision approval in widget | MEDIUM | MEDIUM | P2 |
| Sentry error tracking | MEDIUM | LOW | P2 |
| Widget domain allowlist | LOW | LOW | P3 |
| Advanced analytics dashboards | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for this milestone
- P2: Ship in v1.x after core is stable
- P3: Future consideration

---

## Competitor Feature Analysis

Relevant comparators: Appcues (embeddable onboarding), Intercom (in-app messaging), Onboarder.io (client onboarding SaaS), Copilot (agency client portal).

| Feature | Appcues / Intercom | Copilot / Onboarder | Our Approach |
|---------|---------------------|---------------------|--------------|
| Self-service org signup | Stripe checkout, instant provisioning, email confirmation | Same pattern | Stripe checkout → auto-provision org → admin redirect. No manual steps |
| Admin config (services/templates) | Rich visual editors, live preview | Form-based CRUD with template variables | Form-based CRUD is sufficient. Preview with variable substitution is table stakes |
| Embeddable widget | JS snippet + Shadow DOM, step-by-step forms | iframe or JS widget | Shadow DOM IIFE bundle already exists. Need e2e flow, not architecture |
| Voice in onboarding | Not standard in Appcues. Intercom has voice calls but not in-widget voice AI | Emerging: some tools add voice step as optional channel | Voice + form hybrid is our actual differentiator. Most tools are form-only |
| Multi-channel follow-up | Email-primary, some SMS | Email + SMS | SMS + voice + email already wired. Cadence config differentiates us |
| Webhook security | Always HMAC-verified, rate-limited, idempotent | Same | We're currently behind. Fix brings us to parity with industry standard |
| Observability | Sentry + Datadog standard | Varies | Structured logging + Sentry = minimum viable for production confidence |

---

## Specific Patterns: How These Work in Practice

### Self-Service Signup: Stripe Checkout to Provisioned Org

1. Agency lands on marketing page, clicks "Start free trial" or "Subscribe"
2. Stripe Checkout session created server-side with `metadata: { pending_org_name, admin_email }`
3. Stripe redirects to success URL with `session_id`
4. `checkout.session.completed` webhook fires (HMAC verified, idempotency checked)
5. Handler: create org record, create membership, create subscription record, send admin invite email
6. Admin email contains magic link to set password and access dashboard
7. Dashboard shows empty state with setup wizard: add service definitions, configure package, set up integrations

Key: the success redirect should not be trusted for provisioning. Only the webhook is authoritative. The success page shows "Setting up your account..." and polls or subscribes to realtime for completion.

### Admin CRUD: Service Definitions Pattern

Service definitions are the core configurable unit. Each has:
- `name`, `description` (display)
- `required_data_fields` (array: what the agent collects)
- `setup_steps` (ordered array: what automations run)
- `status` (active/inactive)

CRUD UI: table list view with edit-in-modal pattern. No inline editing (fragile). Validation on submit. Soft delete (inactive, not deleted, because existing client services reference them).

### Widget E2E Flow

Standard pattern for embeddable onboarding widgets (Appcues, Intercom, LeadrWizard):

1. `LeadrWizard.init({ sessionId, containerId })` called by host page
2. Widget loads: fetches session + questions from API (authenticated by sessionId scoped to org)
3. Render step N of M with progress bar. Show current question.
4. User answers via form input OR via voice (ElevenLabs widget, transcription captured)
5. Submit response via `POST /api/sessions/{sessionId}/responses`. On success, advance to next step.
6. On final step submission, render completion state with next-steps copy.
7. Agent router independently processes responses and queues service fulfillment tasks.

Error recovery: per-step retry on network failure (3 attempts, exponential backoff). If all fail, show "Something went wrong, your progress is saved" with retry button. Never lose already-submitted responses.

### Webhook Security: Minimum Viable Pattern

```
Request arrives at /api/webhooks/stripe
  1. Read raw body (before JSON parse)
  2. Verify Stripe-Signature header with stripe.webhooks.constructEvent(rawBody, sig, secret)
     - Reject with 401 if invalid
  3. Check if event.id already exists in processed_webhook_events table
     - Return 200 if duplicate (idempotent)
  4. Return 200 immediately (acknowledge receipt)
  5. Process asynchronously (or synchronously if fast, but within 30s Stripe timeout)
  6. Insert event.id into processed_webhook_events on successful completion
```

Rate limiting applied at middleware level before signature check. 100-500 req/min per IP.

### Structured Logging: Minimum Viable Pattern

Replace `console.error(...)` with a structured logger that outputs JSON:

```json
{
  "level": "error",
  "timestamp": "2026-03-13T10:00:00Z",
  "correlation_id": "req_abc123",
  "org_id": "org_xyz",
  "session_id": "sess_123",
  "event": "stripe_webhook_processing_failed",
  "error": "GHL sub-account provisioning timeout",
  "stack": "..."
}
```

Every request gets a `correlation_id` at the edge (middleware). Passed through context to all downstream operations. Supabase queries, external API calls, and webhook handlers all log with the same ID.

---

## Sources

- [Stripe Idempotent Requests (Official)](https://docs.stripe.com/api/idempotent_requests) — HIGH confidence
- [WorkOS: Developer's Guide to Multi-Tenant SaaS Architecture](https://workos.com/blog/developers-guide-saas-multi-tenant-architecture) — HIGH confidence
- [Inventive HQ: Webhook Best Practices Production Guide](https://inventivehq.com/blog/webhook-best-practices-guide) — MEDIUM confidence (multiple sources agree)
- [Twilio Multi-Tenancy Docs](https://www.twilio.com/docs/messaging/features/multi-tenancy) — HIGH confidence
- [Webhook Security: 9 Patterns (PentestTesting)](https://www.pentesttesting.com/webhook-security-best-practices/) — MEDIUM confidence
- [SaaS Onboarding Best Practices 2025 (Flowjam)](https://www.flowjam.com/blog/saas-onboarding-best-practices-2025-guide-checklist) — MEDIUM confidence
- [Sentry Structured Logs GA (Official)](https://sentry.io/about/press-releases/sentry-structured-logs-now-available-to-all/) — HIGH confidence
- [Handling Payment Webhooks: Idempotency, Retries, Validation (Medium)](https://medium.com/@sohail_saifii/handling-payment-webhooks-reliably-idempotency-retries-validation-69b762720bf5) — MEDIUM confidence
- [Supabase Realtime Features (Official)](https://supabase.com/features/realtime-postgres-changes) — HIGH confidence
- [Makerkit: Building Embeddable React Widgets](https://makerkit.dev/blog/tutorials/embeddable-widgets-react) — MEDIUM confidence

---

*Feature research for: LeadrWizard (AI-powered autonomous onboarding SaaS)*
*Researched: 2026-03-13*
