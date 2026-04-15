# LeadrWizard Developer Handoff

**Date:** 2026-03-25
**Status:** Current approach STALED. Rebuilding as headless service layer.

---

## What This App Does

LeadrWizard is an AI-powered client onboarding platform for agencies. When an agency sells a service package, LeadrWizard automatically:

1. Provisions the client (database record, GHL sub-account, CRM contact)
2. Reaches out via SMS, voice calls, and email on a configurable cadence
3. Collects required data through an AI agent (asks the right questions through the right channel)
4. Fulfills services automatically (A2P registration, Google Business Profile, website generation, GHL automation)
5. Escalates to humans when the bot can't handle something

The core value: clients get onboarded without human intervention.

---

## Why We're Changing Approach

The current build is a **bundled monolithic SaaS** (Next.js dashboard + embeddable widget + shared business logic). It works end-to-end but it's tightly coupled.

The new approach: **headless service layer**. Each capability becomes an independently callable HTTP endpoint. An external orchestrator (n8n agent, any AI agent, or custom workflow) calls these endpoints to drive the onboarding process.

Think of it as turning LeadrWizard from "an app" into "an API that any agent can use."

---

## What Exists Today (and What to Reuse)

### REUSE: Shared Business Logic (`packages/shared/src/`)

This is the gold. All the core logic is already separated from the UI. These are pure functions that take a Supabase client and return results. They do NOT depend on Next.js.

| Module | Location | What It Does |
|--------|----------|-------------|
| **Agent Router** | `agent/agent-router.ts` | Determines next question based on missing required fields |
| **Agent Context** | `agent/agent-context.ts` | Assembles all client/service/response data for AI prompts |
| **Completion Checker** | `agent/completion-checker.ts` | Calculates % completion, identifies missing fields |
| **Payment Handler** | `automations/payment-handler.ts` | Provisions client + package + services + session atomically |
| **A2P Manager** | `automations/a2p-manager.ts` | Twilio Trust Hub + Brand + Campaign (multi-day approval) |
| **GMB Manager** | `automations/gmb-manager.ts` | Google Business Profile access + optimization |
| **Website Builder** | `automations/website-builder.ts` | Niche template + Claude customization + Vercel deploy |
| **GHL Adapter** | `automations/ghl-adapter.ts` | Sub-account provisioning, snapshot deploy, contact sync |
| **Outreach Scheduler** | `automations/outreach-scheduler.ts` | Queue follow-ups based on cadence config |
| **Task Processor** | `automations/task-processor.ts` | Poll external APIs, retry logic, dead letter queue |
| **Escalation Notifier** | `automations/escalation-notifier.ts` | Slack/Google Chat webhook notifications |
| **SMS Sender** | `comms/twilio-sms.ts` | Send SMS via Twilio with E.164 validation |
| **Voice Caller** | `comms/vapi-calls.ts` | Outbound AI voice calls via Vapi |
| **Email Sender** | `comms/ghl-email.ts` | HTML emails via GoHighLevel |
| **Outreach Processor** | `comms/outreach-processor.ts` | Process pending outreach queue (cron handler) |
| **SMS Parser** | `comms/sms-parser.ts` | Extract intent from inbound SMS (CALL, STOP, data answer) |
| **Message Templates** | `comms/message-templates.ts` | Resolve `{{variable}}` placeholders in templates |
| **Stripe Adapter** | `billing/stripe-adapter.ts` | Checkout sessions, billing portal, webhook processing |
| **Tenant Manager** | `tenant/org-manager.ts` | Decrypt org credentials (AES-256-GCM) |
| **Crypto** | `crypto/index.ts` | AES-256-GCM encrypt/decrypt for stored credentials |
| **Types** | `types/index.ts` | All TypeScript interfaces (40+ types, all enums) |

### REUSE: Database Schema (`supabase/migrations/`)

The schema is solid. 23 tables, 45+ indexes, RLS policies, atomic PL/pgSQL functions. Keep it as-is.

Key migrations to understand:
- `00001_initial_schema.sql` - All core tables, indexes, RLS
- `00002_pg_cron_jobs.sql` - 4 cron jobs + analytics table
- `00003_billing_and_tenancy.sql` - Subscriptions, usage, invitations
- `00005_rls_hardening.sql` - `provision_client()` atomic function
- `00006_provision_org.sql` - `provision_org()` atomic function
- `00008_org_credentials_and_dlq.sql` - Encrypted credentials + dead letter queue

### REUSE: Tests (`packages/shared/src/__tests__/`)

38 tests covering agent routing, completion checking, SMS parsing, message templates, and utilities. All passing.

### STALE: Admin Dashboard (`apps/admin/`)

The Next.js dashboard with all its pages (clients, onboardings, escalations, services, packages, templates, settings, billing, DLQ). This was the "bundled app" UI. Not needed for the headless approach. The API routes inside it are partially reusable as reference for the new endpoints.

### STALE: Embeddable Widget (`apps/widget/`)

The Vite IIFE widget with Shadow DOM, ElevenLabs voice bot, step renderer. Not needed when an external agent drives the process.

---

## The New Architecture

```
                    n8n / AI Agent / Any Orchestrator
                              |
                              | HTTP calls
                              v
                    +-----------------------+
                    |   LeadrWizard API     |
                    |   (headless layer)    |
                    +-----------------------+
                              |
              +---------------+----------------+
              |               |                |
        Supabase DB    External APIs     AI (Claude)
        (PostgreSQL)   (Twilio, Vapi,
                        GHL, Google,
                        Stripe, Vercel)
```

The API is the only thing that needs to be built. It wraps the existing `packages/shared` functions with HTTP endpoints.

---

## API Endpoints to Build

Every function in `packages/shared` should be exposed as an endpoint. Here's the full map:

### Client Management

```
POST   /api/v1/clients/provision
       Body: { customer_name, customer_email, customer_phone?, business_name?, package_id, payment_ref, org_id }
       Uses: automations/payment-handler.ts → handlePaymentWebhook()
       Returns: { client, client_package, client_services, session }

GET    /api/v1/clients/:clientId
       Returns: client record with related data

GET    /api/v1/clients/:clientId/services
       Returns: all client_services with status

PATCH  /api/v1/clients/:clientId
       Body: { name?, email?, phone?, business_name?, metadata? }
       Returns: updated client
```

### Onboarding Sessions

```
GET    /api/v1/sessions/:sessionId
       Returns: session with completion_pct, status, responses

GET    /api/v1/sessions/:sessionId/completion
       Uses: agent/completion-checker.ts → checkCompletion()
       Returns: { completion_pct, missing_fields[], completed_fields[] }

POST   /api/v1/sessions/:sessionId/responses
       Body: { field_key, field_value, answered_via }
       Uses: stores response, recalculates completion
       Returns: { response, new_completion_pct, is_complete }

GET    /api/v1/sessions/:sessionId/context
       Uses: agent/agent-context.ts → buildAgentContext()
       Returns: full agent context (client, services, responses, missing fields, tasks)
```

### AI Agent

```
POST   /api/v1/agent/next-action
       Body: { session_id, current_channel? }
       Uses: agent/agent-router.ts → decideNextAction()
       Returns: { action, service_id?, field_key?, message, options? }

POST   /api/v1/agent/system-prompt
       Body: { session_id, channel }
       Uses: agent/agent-context.ts → contextToSystemPrompt()
       Returns: { prompt } (for feeding to external AI)
```

### Communications

```
POST   /api/v1/sms/send
       Body: { client_id, message, template_slug? }
       Uses: comms/twilio-sms.ts → sendSMS()
       Returns: { message_sid, status }

POST   /api/v1/calls/initiate
       Body: { client_id, session_id, first_message?, system_prompt? }
       Uses: comms/vapi-calls.ts → initiateOutboundCall()
       Returns: { call_id, status }

POST   /api/v1/email/send
       Body: { client_id, subject, html_body?, template_slug? }
       Uses: comms/ghl-email.ts → sendEmail()
       Returns: { status }

POST   /api/v1/sms/handle-inbound
       Body: { client_id, session_id?, message_body }
       Uses: comms/outreach-processor.ts → handleInboundSMSReply()
       Returns: { action, response }
```

### Outreach & Follow-up

```
POST   /api/v1/outreach/schedule
       Body: { client_id, session_id, channel, template, delay_minutes?, priority? }
       Uses: automations/outreach-scheduler.ts → scheduleNextFollowUp()
       Returns: { outreach_id, scheduled_at }

POST   /api/v1/outreach/cancel
       Body: { session_id }
       Uses: automations/outreach-scheduler.ts → cancelPendingOutreach()
       Returns: { cancelled_count }

POST   /api/v1/outreach/process-queue
       Uses: comms/outreach-processor.ts → processOutreachQueue()
       Returns: { processed, errors }
       Note: can also keep this on pg_cron as a fallback
```

### Service Fulfillment

```
POST   /api/v1/services/a2p/register
       Body: { client_service_id }
       Uses: automations/a2p-manager.ts → registerWithTwilio()
       Returns: { task_id, status }

POST   /api/v1/services/gmb/request-access
       Body: { client_service_id }
       Uses: automations/gmb-manager.ts → requestAccessAndOptimize()
       Returns: { task_id, status }

POST   /api/v1/services/website/generate
       Body: { client_service_id, niche_template_id? }
       Uses: automations/website-builder.ts → buildAndDeploy()
       Returns: { task_id, preview_url?, status }

POST   /api/v1/services/ghl/provision
       Body: { client_id, client_service_id }
       Uses: automations/ghl-adapter.ts → provisionSubAccount() + deploySnapshot()
       Returns: { sub_account_id, status }

POST   /api/v1/tasks/process
       Uses: automations/task-processor.ts → processServiceTasks()
       Returns: { processed, completed, failed }
       Note: can also keep on pg_cron

GET    /api/v1/tasks/:taskId
       Returns: task status, external_ref, last_result
```

### Escalations

```
POST   /api/v1/escalations/create
       Body: { client_id, session_id?, reason, context, channel }
       Returns: { escalation_id }

PATCH  /api/v1/escalations/:id
       Body: { status, assigned_to?, resolution? }
       Returns: updated escalation

POST   /api/v1/escalations/:id/notify
       Uses: automations/escalation-notifier.ts
       Returns: { notified: true }
```

### Billing

```
POST   /api/v1/billing/checkout
       Body: { plan_slug, org_id }
       Uses: billing/stripe-adapter.ts → createCheckoutSession()
       Returns: { checkout_url }

POST   /api/v1/billing/portal
       Body: { org_id }
       Uses: billing/stripe-adapter.ts → createBillingPortalSession()
       Returns: { portal_url }
```

### Organization & Config

```
GET    /api/v1/orgs/:orgId
       Returns: org with settings (cadence config, integration status)

PATCH  /api/v1/orgs/:orgId/settings
       Body: { outreach_cadence?, escalation_webhook_url?, escalation_channel? }
       Returns: updated settings

POST   /api/v1/orgs/:orgId/credentials
       Body: { twilio?, ghl?, vapi?, elevenlabs? }
       Uses: tenant/org-manager.ts → saveOrgCredentials() (encrypts with AES-256-GCM)
       Returns: { saved: true }

GET    /api/v1/orgs/:orgId/credentials/status
       Returns: which integrations are configured (boolean flags, never raw keys)
```

### Dead Letter Queue

```
GET    /api/v1/dlq
       Query: { org_id, status? }
       Returns: DLQ items

POST   /api/v1/dlq/:id/retry
       Returns: { retried: true, new_task_id }

POST   /api/v1/dlq/:id/dismiss
       Returns: { dismissed: true }
```

### Webhooks (Inbound, keep as-is)

These still need to exist for external services to call back:

```
POST   /api/webhooks/stripe      - Stripe checkout.session.completed
POST   /api/webhooks/twilio      - Inbound SMS from clients
POST   /api/webhooks/vapi        - Voice call events (end-of-call, function calls)
POST   /api/webhooks/payment     - Generic payment notification
```

---

## Authentication for the API

The current app uses Supabase Auth (cookie sessions) for the dashboard and signature verification for webhooks. For the headless API, you need:

### Option A: API Key Auth (recommended for n8n)

Add an `api_keys` table:

```sql
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  key_hash text not null,          -- SHA-256 hash of the key
  key_prefix text not null,        -- first 8 chars for identification (e.g., "lw_live_")
  name text not null,              -- human label ("n8n production")
  scopes text[] default '{}',      -- optional: restrict to specific endpoint groups
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz default now()
);
```

Usage:
```
Authorization: Bearer lw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Middleware extracts org_id from the key, scopes all queries to that org.

### Option B: Supabase Service Role + org_id Header

Simpler but less secure. Pass `X-Org-Id` header with a shared service role key. Only use this for internal/trusted agents.

---

## n8n Integration Pattern

In n8n, each endpoint becomes an **HTTP Request node**. The AI agent decides what to call.

### Example: Automated Follow-up Workflow

```
Trigger (schedule: every 2 hours)
  |
  v
HTTP Request: GET /api/v1/sessions?status=active&stale_minutes=120
  |
  v
For Each Session:
  |
  v
  HTTP Request: POST /api/v1/agent/next-action
    Body: { session_id: "{{session.id}}" }
  |
  v
  Switch on action:
    "ask_question" → HTTP Request: POST /api/v1/sms/send
    "escalate"     → HTTP Request: POST /api/v1/escalations/create
    "complete"     → (done, log it)
```

### Example: AI Agent Orchestration

```
Trigger (webhook: inbound SMS from Twilio)
  |
  v
HTTP Request: POST /api/v1/sms/handle-inbound
  |
  v
Switch on action:
  "call_initiated" → (Vapi will handle it)
  "opt_out"        → HTTP Request: POST /api/v1/outreach/cancel
  "unknown_intent" →
    HTTP Request: POST /api/v1/agent/system-prompt
      |
      v
    AI Agent Node (Claude): parse the message using system prompt
      |
      v
    HTTP Request: POST /api/v1/sessions/:id/responses
```

---

## Build Order (Recommended)

Build incrementally. Each phase is independently useful.

### Phase 1: Core API Skeleton + Auth
- Set up the API framework (can stay in Next.js or move to a lighter framework like Hono/Fastify)
- Implement API key auth middleware
- Create the `api_keys` table

### Phase 2: Read Endpoints
- `GET /sessions/:id`, `GET /clients/:id`, `GET /tasks/:id`
- `GET /sessions/:id/completion`, `GET /sessions/:id/context`
- These are the simplest. Just query Supabase and return JSON.

### Phase 3: Agent Endpoints
- `POST /agent/next-action`, `POST /agent/system-prompt`
- These wrap existing functions directly. Critical for n8n agent integration.

### Phase 4: Communication Endpoints
- `POST /sms/send`, `POST /calls/initiate`, `POST /email/send`
- `POST /sms/handle-inbound`
- These let the orchestrator trigger messages directly.

### Phase 5: Client Provisioning
- `POST /clients/provision`
- `POST /outreach/schedule`, `POST /outreach/cancel`
- Full onboarding flow without the bundled app.

### Phase 6: Service Fulfillment
- A2P, GMB, website, GHL endpoints
- Task processing endpoint
- DLQ management

### Phase 7: Billing & Org Management
- Stripe checkout/portal
- Org settings, credentials

---

## Database Schema Overview

23 tables across these domains:

**Tenancy:** organizations, org_members, org_subscriptions, org_invitations, subscription_plans
**Services:** service_definitions, service_packages, package_services, niche_templates
**Clients:** clients, client_packages, client_services
**Onboarding:** onboarding_sessions, session_responses
**Execution:** service_tasks
**Communication:** outreach_queue, interaction_log, message_templates
**Escalation:** escalations
**Monitoring:** analytics_snapshots, dead_letter_queue, processed_webhook_events

All tables have RLS enabled and are org-scoped. The API should use the Supabase service role client (bypasses RLS) and enforce org scoping in the application layer via the API key's org_id.

Atomic functions to know about:
- `provision_client(p_org_id, p_name, p_email, ...)` - Creates client + package + services + session in one transaction. Idempotent on payment_ref.
- `provision_org(p_stripe_customer_id, ...)` - Creates org + subscription from Stripe webhook. Idempotent on stripe_customer_id.

---

## Environment Variables

```env
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# AI (required)
ANTHROPIC_API_KEY=your-claude-api-key

# Twilio - SMS + A2P (required for comms)
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890

# Vapi - Outbound voice calls (required for voice)
VAPI_API_KEY=your-vapi-api-key
VAPI_ASSISTANT_ID=your-assistant-id

# GoHighLevel - CRM + email (required for GHL features)
GHL_API_KEY=your-ghl-api-key
GHL_LOCATION_ID=your-location-id
GHL_COMPANY_ID=your-company-id
GHL_SNAPSHOT_ID=your-snapshot-id

# Google Business Profile (required for GMB features)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REFRESH_TOKEN=your-google-refresh-token

# Vercel (required for website generation)
VERCEL_TOKEN=your-vercel-token
VERCEL_TEAM_ID=your-vercel-team-id

# Stripe (required for billing)
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Security
CRON_SECRET=your-cron-secret
PAYMENT_WEBHOOK_SECRET=your-webhook-signing-secret
# ENCRYPTION_KEY is optional — when unset, the credential encryption key is
# derived deterministically from SUPABASE_SERVICE_ROLE_KEY via HKDF-SHA256.
# Only set this if you have legacy v1 blobs still encrypted with an older
# manual key and you want them to remain readable. See packages/shared/src/crypto/index.ts.
# ENCRYPTION_KEY=32-byte-hex-key-for-aes-256-gcm

# Notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx
GOOGLE_CHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/xxx

# App
NEXT_PUBLIC_APP_URL=https://app.leadrwizard.com
NEXT_PUBLIC_WIDGET_URL=https://app.leadrwizard.com/onboard
```

Per-org credentials (Twilio, GHL, Vapi, ElevenLabs) are stored encrypted in the `organizations` table and decrypted at runtime via `tenant/org-manager.ts`.

---

## Gotchas and Things to Know

1. **pg_cron is running.** There are 4 cron jobs in Supabase that hit `/api/cron/outreach` and `/api/cron/tasks`. If you rebuild the API at different URLs, update the cron jobs in Supabase (`supabase/migrations/00002_pg_cron_jobs.sql`). Or replace them with n8n scheduled workflows.

2. **Idempotency matters.** The payment webhook uses `processed_webhook_events` table to deduplicate. `provision_client()` is idempotent on `payment_ref`. Don't break this.

3. **Credential encryption.** Org credentials are AES-256-GCM encrypted in the DB. The format is `v1:iv:tag:ciphertext`. Use the existing `crypto/index.ts` module. The encryption key is derived deterministically from `SUPABASE_SERVICE_ROLE_KEY` via HKDF-SHA256, so no separate env var is needed. Legacy `ENCRYPTION_KEY` is honored as a decrypt-only fallback for historical data.

4. **A2P registration is multi-day.** It's not a single API call. It creates a Trust Hub, Brand, and Campaign on Twilio, then polls for approval over 3-7 days. The task processor handles this via `next_check_at` polling.

5. **RLS is enabled on all tables.** The API should use the service role client (`SUPABASE_SERVICE_ROLE_KEY`) which bypasses RLS. But always scope queries to the org_id from the API key.

6. **The widget URL pattern.** Onboarding links are `{WIDGET_URL}?session={session_id}`. If you're not using the widget anymore, the n8n agent needs another way to collect responses (maybe the agent asks via SMS/voice and submits to `POST /sessions/:id/responses`).

7. **Outreach cadence is configurable.** Each org has `settings.outreach_cadence.steps[]` with delay, channel, and template. The outreach scheduler reads this to queue follow-ups. The n8n agent can replicate this logic or call the schedule endpoint directly.

8. **Test suite.** Run `pnpm test` from root. All 38 tests should pass. They cover the shared package only (agent, completion, SMS parsing, templates, utils).

---

## Tech Stack Reference

| Layer | Current | Keep/Change |
|-------|---------|-------------|
| Database | Supabase PostgreSQL 15 | Keep |
| Auth (API) | Supabase Auth (cookies) | Replace with API key auth |
| Business Logic | `packages/shared` (TypeScript) | Keep, wrap with HTTP |
| API Framework | Next.js API Routes | Your choice (can stay or use Hono/Fastify) |
| SMS | Twilio | Keep |
| Voice | Vapi + ElevenLabs | Keep |
| CRM | GoHighLevel | Keep |
| Billing | Stripe | Keep |
| Hosting | Vercel | Keep or move to Railway/Fly |
| Monitoring | Sentry | Keep |
| Rate Limiting | Upstash Redis | Keep |

---

## File Map (Quick Reference)

```
packages/shared/src/
  types/index.ts              <- All TypeScript types (448 lines)
  agent/
    agent-router.ts           <- decideNextAction(), getAgentSystemPrompt()
    agent-context.ts          <- buildAgentContext(), contextToSystemPrompt()
    completion-checker.ts     <- checkCompletion(), getMissingSummary()
  automations/
    payment-handler.ts        <- handlePaymentWebhook()
    a2p-manager.ts            <- registerWithTwilio()
    gmb-manager.ts            <- requestAccessAndOptimize()
    website-builder.ts        <- buildAndDeploy()
    ghl-adapter.ts            <- provisionSubAccount(), deploySnapshot()
    outreach-scheduler.ts     <- scheduleNextFollowUp(), cancelPendingOutreach()
    task-processor.ts         <- processServiceTasks()
    escalation-notifier.ts    <- notifyEscalation()
  comms/
    twilio-sms.ts             <- sendSMS()
    vapi-calls.ts             <- initiateOutboundCall()
    ghl-email.ts              <- sendEmail(), emailTemplates
    outreach-processor.ts     <- processOutreachQueue(), handleInboundSMSReply()
    sms-parser.ts             <- parseIntent()
    message-templates.ts      <- resolveTemplate()
  billing/
    stripe-adapter.ts         <- createCheckoutSession(), processStripeWebhook()
  tenant/
    org-manager.ts            <- getOrgCredentials(), saveOrgCredentials()
  crypto/
    index.ts                  <- encryptAES256GCM(), decryptAES256GCM()
  supabase/
    client.ts                 <- createClient()
  utils/
    logger.ts                 <- createRouteLogger()
    rate-limiter.ts           <- getRateLimiter()

supabase/migrations/
  00001_initial_schema.sql    <- All tables, indexes, RLS
  00002_pg_cron_jobs.sql      <- Cron jobs + analytics
  00003_billing_and_tenancy.sql
  00004_webhook_idempotency.sql
  00005_rls_hardening.sql     <- provision_client() function
  00006_provision_org.sql     <- provision_org() function
  00007_message_templates_and_rls.sql
  00008_org_credentials_and_dlq.sql
  00009_realtime_setup.sql
```

---

## Questions? Contact

Reach out to Haseeb for any questions about business logic, integration credentials, or architectural decisions.
