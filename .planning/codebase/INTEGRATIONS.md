# External Integrations

**Analysis Date:** 2025-03-13

## APIs & External Services

**Communications - SMS:**
- Twilio - SMS sending and inbound SMS handling
  - SDK/Client: Native REST API via fetch (no SDK)
  - Auth: Basic Auth (Account SID + Auth Token)
  - Implementation: `packages/shared/src/comms/twilio-sms.ts`
  - Env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
  - Webhook: `POST /api/webhooks/twilio` - Receives inbound SMS
  - Signature verification: HMAC-SHA1 with X-Twilio-Signature header

**Communications - Voice Calls:**
- Vapi - Outbound AI voice calls and call management
  - SDK/Client: Native REST API via fetch
  - Auth: Bearer token (API key)
  - Implementation: `packages/shared/src/comms/vapi-calls.ts`
  - Env vars: `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`
  - Webhook: `POST /api/webhooks/vapi` - Receives call events (end-of-call, function calls, status updates)
  - Features: Transcription, recording URL, tool calling, metadata pass-through

**Communications - Voice Widget:**
- ElevenLabs - In-browser voice synthesis
  - Auth: Agent ID token
  - Env var: `NEXT_PUBLIC_ELEVENLABS_AGENT_ID`

**CRM & Automation:**
- GoHighLevel (GHL) - CRM, chatbot provisioning, contact sync
  - SDK/Client: Native REST API via fetch
  - Auth: Bearer token (Location API key or Agency API key)
  - Base URL: `https://services.leadconnectorhq.com`
  - API Version: `2021-07-28`
  - Implementation: `packages/shared/src/automations/ghl-adapter.ts`
  - Env vars: `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_COMPANY_ID`, `GHL_SNAPSHOT_ID`
  - Operations:
    - Provision sub-accounts (locations) for clients
    - Deploy snapshots (pre-built chatbot/automation configs)
    - Sync client data to GHL contacts (bi-directional)
    - Custom field mapping for business info

**Business Profile:**
- Google Business Profile (GMB) - Business listing optimization
  - SDK/Client: Native REST API via fetch
  - Auth: OAuth2 with refresh token + service account
  - Implementation: `packages/shared/src/automations/gmb-manager.ts`
  - Env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
  - Flow:
    1. Search for business listing by name/address
    2. Request management access (client receives Google approval email)
    3. Poll for access approval
    4. Once approved, optimize listing (hours, categories, description, phone)
  - Endpoints:
    - Account lookup: `https://mybusinessaccountmanagement.googleapis.com/v1/accounts`
    - Location search: `https://mybusinessbusinessinformation.googleapis.com/v1/{account}/locations`
    - Admin access: `https://mybusinessaccountmanagement.googleapis.com/v1/{location}/admins`
    - Optimization: `https://mybusinessbusinessinformation.googleapis.com/v1/{location}`

**Website Builder:**
- Vercel - Website hosting and deployment
  - SDK/Client: Native REST API via fetch (Vercel API)
  - Auth: Bearer token
  - Implementation: `packages/shared/src/automations/website-builder.ts` (inferred)
  - Env vars: `VERCEL_TOKEN`, `VERCEL_TEAM_ID`

**AI & Agents:**
- Claude (Anthropic) - AI brain for conversational logic
  - Implementation: Used via Vapi assistant's LLM configuration
  - Env var: `ANTHROPIC_API_KEY`
  - Model: Claude Sonnet 4 or configured per assistant override

## Data Storage

**Databases:**
- Supabase PostgreSQL
  - Connection: Supabase URL + Anon Key (browser) or Service Role Key (server)
  - Client: `@supabase/supabase-js` 2.49.0
  - Env vars:
    - `NEXT_PUBLIC_SUPABASE_URL`
    - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
    - `SUPABASE_SERVICE_ROLE_KEY`

**File Storage:**
- Supabase Storage (inferred from database service)
- Google Cloud Storage (for GMB photos in `automations/gmb-manager.ts`)

**Caching:**
- Not detected

## Authentication & Identity

**Auth Provider:** Supabase Auth (inferred from middleware.ts)

**Implementation:**
- Custom auth flow in `apps/admin/src/middleware.ts`
- Callback route: `apps/admin/src/app/(auth)/callback/route.ts`
- Session management via Supabase client

## Monitoring & Observability

**Error Tracking:**
- Not detected (no Sentry, Rollbar, etc.)

**Logs:**
- Console logging (console.error, console.warn)
- Interaction audit trail stored in `interaction_log` Supabase table

**Secrets Rotation:**
- Not detected

## CI/CD & Deployment

**Hosting:**
- Vercel (Next.js admin app)
- Supabase managed Postgres

**CI Pipeline:**
- GitHub Actions (inferred from `.github/workflows/`)

**Environment Configuration:**
- `.env.example` provided (checked into repo)
- Actual `.env` files not committed

## Webhooks & Callbacks

**Incoming (app receives):**
- `POST /api/webhooks/twilio` - Inbound SMS replies
- `POST /api/webhooks/vapi` - Call events (end-of-call, function calls, status updates)
- `POST /api/webhooks/stripe` - Payment events
- `POST /api/webhooks/payment` - Generic payment webhook (optional HMAC-SHA256 verification)

**Outgoing (app sends to):**
- Slack - Escalation notifications
  - Env var: `SLACK_WEBHOOK_URL`
  - Implementation: `packages/shared/src/automations/escalation-notifier.ts` (inferred)
- Google Chat - Escalation notifications
  - Env var: `GOOGLE_CHAT_WEBHOOK_URL`
  - Implementation: same as Slack

**Background Jobs:**
- Cron triggers:
  - `POST /api/cron/tasks` - Service task processor (next_check_at scheduler)
  - `POST /api/cron/outreach` - Outreach queue scheduler
  - Auth: `CRON_SECRET` header validation

## Payment & Billing

**Provider:** Stripe

**Implementation:** `packages/shared/src/billing/stripe-adapter.ts`

**Env vars:**
- `STRIPE_SECRET_KEY` - Server-side billing operations
- `STRIPE_WEBHOOK_SECRET` - Webhook validation
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - Browser-side checkout

**Operations:**
- Create customer record in Stripe
- Create checkout sessions
- Create billing portal sessions
- Process subscription webhooks (purchase, update, cancel, payment failure)
- Check plan limits (feature gating)

**Webhook endpoint:** `POST /api/webhooks/stripe`

## Environment Configuration

**Required env vars (from `.env.example`):**

**Core Infrastructure:**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Public anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Server-side service role

**Communications:**
- `TWILIO_ACCOUNT_SID` - Twilio account ID
- `TWILIO_AUTH_TOKEN` - Twilio auth token
- `TWILIO_PHONE_NUMBER` - Twilio SMS source number

**Voice Calls:**
- `VAPI_API_KEY` - Vapi API key
- `VAPI_ASSISTANT_ID` - Default assistant for outbound calls

**Voice Widget:**
- `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` - ElevenLabs agent ID (public)

**CRM:**
- `GHL_API_KEY` - GoHighLevel API key
- `GHL_LOCATION_ID` - GHL location/sub-account ID
- `GHL_COMPANY_ID` - GHL company ID
- `GHL_SNAPSHOT_ID` - GHL automation snapshot template ID

**Business Profile:**
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth secret
- `GOOGLE_REFRESH_TOKEN` - Google OAuth refresh token

**AI:**
- `ANTHROPIC_API_KEY` - Claude API key (used via Vapi)

**Billing:**
- `STRIPE_SECRET_KEY` - Stripe secret (server)
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - Stripe public key

**Deployment:**
- `VERCEL_TOKEN` - Vercel API token
- `VERCEL_TEAM_ID` - Vercel team ID

**Notifications:**
- `SLACK_WEBHOOK_URL` - Slack incoming webhook for escalations
- `GOOGLE_CHAT_WEBHOOK_URL` - Google Chat webhook for escalations

**Widget:**
- `NEXT_PUBLIC_WIDGET_URL` - Public widget onboarding URL

**Security:**
- `CRON_SECRET` - Secret token for cron job verification
- `PAYMENT_WEBHOOK_SECRET` - HMAC-SHA256 secret for payment webhooks (optional)

---

*Integration audit: 2025-03-13*
