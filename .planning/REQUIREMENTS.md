# Requirements: LeadrWizard

**Defined:** 2026-03-13
**Core Value:** Clients get onboarded without human intervention. The agent asks the right questions through the right channel at the right time, and services get set up automatically.

## Launch Requirements

Requirements for production launch. Each maps to roadmap phases.

### Security Hardening

- [x] **SEC-01**: Stripe webhook endpoint verifies signature using `stripe.webhooks.constructEvent()` before processing any event
- [x] **SEC-02**: Payment and Stripe webhook handlers check idempotency key (event.id) against processed_webhook_events table and skip duplicates
- [x] **SEC-03**: Anonymous RLS policies (`sessions_anon_insert`, `sessions_anon_update`, `responses_anon_insert`) removed and replaced with org_id-scoped server-side validation
- [x] **SEC-04**: Payment webhook `body.org_id` fallback removed. Org resolution requires valid API key or webhook signature only
- [x] **SEC-05**: Widget response submission routes through authenticated API endpoint (`POST /api/widget/response`) instead of direct anonymous Supabase inserts
- [ ] **SEC-06**: Rate limiting applied to all public webhook endpoints and widget API using Upstash Redis (replacing broken in-memory rate limiter)

### Self-Service Signup

- [x] **SIGN-01**: Agency completes Stripe checkout and org is auto-provisioned (org record + membership + subscription) via `checkout.session.completed` webhook
- [x] **SIGN-02**: New org admin receives welcome email with link to set password and access dashboard
- [x] **SIGN-03**: New org dashboard shows empty state with setup wizard guiding through: add services, configure package, set up integrations
- [x] **SIGN-04**: Stripe CLI configured for local webhook testing with forwarding to dev server

### Admin CRUD

- [x] **CRUD-01**: Admin can create, edit, and soft-delete service definitions with required_data_fields and setup_steps
- [x] **CRUD-02**: Admin can create, edit, and delete packages with assigned services and pricing metadata
- [x] **CRUD-03**: Admin can create, edit, and delete message templates with variable interpolation preview per channel (SMS, email, voice)
- [x] **CRUD-04**: Admin can configure org settings: Twilio account SID/auth token, GHL API key, outreach cadence config
- [x] **CRUD-05**: Org settings credentials stored encrypted per-org (not shared globally)

### Widget

- [x] **WIDG-01**: Widget loads session by sessionId, fetches questions from API, and renders step-by-step form with progress indicator
- [ ] **WIDG-02**: Widget supports voice + form hybrid: ElevenLabs voice AND form-based data collection in same session, client can switch mode mid-flow
- [x] **WIDG-03**: Widget submits responses per step via authenticated API route, advances to next step on success
- [x] **WIDG-04**: Widget shows completion state with next-steps messaging after all required fields collected
- [x] **WIDG-05**: Widget handles errors per step with retry (3 attempts, exponential backoff) and fallback message if all fail
- [x] **WIDG-06**: Widget supports optional `allowedOrigins` parameter in `init()` to prevent embedding on unauthorized domains

### Per-Org Isolation

- [x] **ORG-01**: Each org gets a dedicated Twilio phone number provisioned at signup, used for all outreach instead of shared pool
- [x] **ORG-02**: Each org stores its own GHL API credentials (encrypted), used for CRM operations instead of shared global key
- [x] **ORG-03**: Payment handler uses atomic transaction (plpgsql function) to prevent orphaned records on partial provisioning failure
- [x] **ORG-04**: Failed service tasks (5+ failures) moved to dead letter queue table with admin UI to view and retry

### Observability

- [ ] **OBS-01**: Structured JSON logging via pino with correlation_id, org_id, session_id on every log line, replacing all console.error calls
- [ ] **OBS-02**: Sentry error tracking integrated with org_id and session_id enrichment tags
- [ ] **OBS-03**: Dashboard updates in realtime via Supabase Broadcast subscriptions for onboarding_sessions and escalations

## Out of Scope

Explicitly excluded. Not deferred, just not this product.

| Feature | Reason |
|---------|--------|
| White-labeling per org | Scope explosion: custom CSS, domains, email senders. Agency name in copy is sufficient |
| Client-facing portal | Clients interact via widget, SMS, voice. A portal is a second product |
| Advanced analytics dashboards | KPI cards with basic counts sufficient. Charting infra is weeks of work |
| Custom domain per org | Wildcard SSL, DNS per org is complex and fragile |
| Automated billing usage metering | Wrong metering = billing disputes. Manual plan limits for launch |
| Mobile native app | Web dashboard is responsive. Native apps double maintenance |
| Per-tenant database schemas | RLS on shared schema provides sufficient isolation |
| Real-time chat | Not core to onboarding value prop |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1 | Complete |
| SEC-02 | Phase 1 | Complete |
| SEC-03 | Phase 1 | Complete |
| SEC-04 | Phase 1 | Complete |
| SEC-05 | Phase 1 | Complete |
| SEC-06 | Phase 7 | Pending |
| SIGN-01 | Phase 2 | Complete |
| SIGN-02 | Phase 2 | Complete |
| SIGN-03 | Phase 2 | Complete |
| SIGN-04 | Phase 2 | Complete |
| CRUD-01 | Phase 3 | Complete |
| CRUD-02 | Phase 3 | Complete |
| CRUD-03 | Phase 3 | Complete |
| CRUD-04 | Phase 4 | Complete |
| CRUD-05 | Phase 4 | Complete |
| WIDG-01 | Phase 5 | Complete |
| WIDG-02 | Phase 6 | Pending |
| WIDG-03 | Phase 5 | Complete |
| WIDG-04 | Phase 5 | Complete |
| WIDG-05 | Phase 5 | Complete |
| WIDG-06 | Phase 6 | Complete |
| ORG-01 | Phase 4 | Complete |
| ORG-02 | Phase 4 | Complete |
| ORG-03 | Phase 1 | Complete |
| ORG-04 | Phase 4 | Complete |
| OBS-01 | Phase 7 | Pending |
| OBS-02 | Phase 7 | Pending |
| OBS-03 | Phase 8 | Pending |

**Coverage:**
- Launch requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

---
*Requirements defined: 2026-03-13*
*Last updated: 2026-03-13 after roadmap creation — all 28 requirements mapped*
