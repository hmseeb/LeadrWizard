# LeadrWizard — Developer Handover Document

> **Last updated:** 2026-03-13
>
> This document is the single source of truth for onboarding a developer to the LeadrWizard codebase. It covers architecture, every integration, the database schema, the full onboarding flow, deployment, and what's still TODO.

---

## Table of Contents

1. [What Is LeadrWizard?](#1-what-is-leadrwizard)
2. [Tech Stack](#2-tech-stack)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Getting Started (Local Dev)](#4-getting-started-local-dev)
5. [Environment Variables](#5-environment-variables)
6. [Database Schema](#6-database-schema)
7. [The Onboarding Flow (End-to-End)](#7-the-onboarding-flow-end-to-end)
8. [API Routes](#8-api-routes)
9. [AI Agent System](#9-ai-agent-system)
10. [Integrations](#10-integrations)
11. [Admin Dashboard (UI)](#11-admin-dashboard-ui)
12. [Embeddable Widget](#12-embeddable-widget)
13. [Cron Jobs & Background Processing](#13-cron-jobs--background-processing)
14. [Authentication & Authorization](#14-authentication--authorization)
15. [Deployment](#15-deployment)
16. [Incomplete / TODO Items](#16-incomplete--todo-items)
17. [Key File Index](#17-key-file-index)

---

## 1. What Is LeadrWizard?

LeadrWizard is a **multi-channel, AI-powered client onboarding platform** for agencies that sell service packages (websites, Google Business Profile optimization, A2P registration, GoHighLevel CRM automations).

When a new client pays, LeadrWizard automatically:
1. Creates their account and GHL sub-account
2. Reaches out via SMS to collect required data
3. Escalates through voice calls and email if unresponsive
4. Uses AI (Claude + ElevenLabs) to have natural conversations
5. Executes service fulfillment tasks (build website, register A2P, claim GMB, deploy GHL snapshot)
6. Tracks everything in a dashboard for the agency team

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| **Monorepo** | Turborepo + pnpm workspaces |
| **Admin App** | Next.js 15 (App Router, Server Components) |
| **Widget** | Vite + React (IIFE bundle for embedding) |
| **Shared Logic** | TypeScript package (`packages/shared`) |
| **Database** | Supabase (PostgreSQL 15 + RLS + pg_cron) |
| **Auth** | Supabase Auth (email/password + magic link) |
| **AI - Text** | Anthropic Claude (Sonnet 4) via API |
| **AI - Voice (Phone)** | Vapi (outbound calls, uses Claude as backbone) |
| **AI - Voice (Browser)** | ElevenLabs Conversational AI (WebSocket) |
| **SMS** | Twilio |
| **CRM** | GoHighLevel (sub-accounts, snapshots, email) |
| **Google** | Google Business Profile API (OAuth2) |
| **Website Hosting** | Vercel (static deploy API) |
| **Notifications** | Slack / Google Chat webhooks |
| **Testing** | Vitest |
| **CSS** | Tailwind CSS (admin), Shadow DOM CSS (widget) |

---

## 3. Monorepo Structure

```
LeadrWizard/
├── apps/
│   ├── admin/                    # Next.js 15 admin dashboard
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (auth)/       # Login + OAuth callback
│   │   │   │   ├── (dashboard)/  # All dashboard pages
│   │   │   │   ├── api/          # API routes (webhooks, cron)
│   │   │   │   ├── layout.tsx    # Root layout
│   │   │   │   └── globals.css   # Tailwind
│   │   │   ├── components/
│   │   │   │   └── sidebar.tsx   # Navigation sidebar
│   │   │   └── lib/
│   │   │       ├── supabase-browser.ts
│   │   │       └── supabase-server.ts
│   │   ├── next.config.ts
│   │   └── package.json
│   │
│   └── widget/                   # Embeddable onboarding widget
│       ├── src/
│       │   ├── main.tsx          # Entry point, exports LeadrWizardAPI
│       │   ├── components/
│       │   │   ├── WizardWidget.tsx
│       │   │   ├── StepRenderer.tsx
│       │   │   ├── ProgressBar.tsx
│       │   │   ├── VoiceBot.tsx
│       │   │   └── VoiceBotToggle.tsx
│       │   ├── hooks/
│       │   │   └── useWizardSession.ts
│       │   └── styles/
│       │       └── widget.css
│       ├── vite.config.ts
│       └── package.json
│
├── packages/
│   └── shared/                   # Shared business logic
│       └── src/
│           ├── types/index.ts    # All TypeScript types/interfaces
│           ├── supabase/client.ts # Browser + server Supabase clients
│           ├── agent/            # AI agent logic
│           │   ├── agent-router.ts
│           │   ├── agent-context.ts
│           │   ├── response-handler.ts
│           │   └── completion-checker.ts
│           ├── comms/            # Communication engines
│           │   ├── twilio-sms.ts
│           │   ├── vapi-calls.ts
│           │   ├── ghl-email.ts
│           │   ├── message-templates.ts
│           │   └── outreach-processor.ts
│           └── automations/      # Service orchestration
│               ├── payment-handler.ts
│               ├── outreach-scheduler.ts
│               ├── task-processor.ts
│               ├── ghl-adapter.ts
│               ├── a2p-manager.ts
│               ├── gmb-manager.ts
│               ├── website-builder.ts
│               └── escalation-notifier.ts
│
├── supabase/
│   ├── migrations/
│   │   ├── 00001_initial_schema.sql   # All tables, indexes, RLS
│   │   └── 00002_pg_cron_jobs.sql     # Cron jobs + analytics table
│   ├── seed.sql                       # Demo org, services, templates
│   └── config.toml
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── .env.example
```

---

## 4. Getting Started (Local Dev)

```bash
# 1. Install dependencies
pnpm install

# 2. Set up Supabase (local or remote)
#    Option A: Local
supabase start
#    Option B: Remote
supabase link --project-ref <your-ref>
supabase db push

# 3. Seed the database
supabase db reset   # Runs migrations + seed.sql

# 4. Copy and fill environment variables
cp .env.example .env.local
# Edit .env.local with your real keys

# 5. Run dev servers
pnpm dev            # Starts both admin (Next.js) and widget (Vite)
```

**URLs in dev:**
- Admin: `http://localhost:3000`
- Widget dev server: `http://localhost:5173`

---

## 5. Environment Variables

Every variable, what it's for, and where to get it:

### Supabase (Required)
| Variable | Description | Where to get |
|----------|-------------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase Dashboard → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (RLS-gated) | Same location |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin key (bypasses RLS) | Same location — **keep secret** |

### Anthropic (Required)
| Variable | Description | Where to get |
|----------|-------------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key | console.anthropic.com |

### Twilio (Required for SMS + A2P)
| Variable | Description | Where to get |
|----------|-------------|-------------|
| `TWILIO_ACCOUNT_SID` | Account SID | twilio.com/console |
| `TWILIO_AUTH_TOKEN` | Auth token | Same |
| `TWILIO_PHONE_NUMBER` | Sending number (E.164 format) | Twilio → Phone Numbers |

### Vapi (Required for outbound voice calls)
| Variable | Description | Where to get |
|----------|-------------|-------------|
| `VAPI_API_KEY` | Vapi API key | dashboard.vapi.ai |
| `VAPI_ASSISTANT_ID` | Pre-configured assistant | Create in Vapi dashboard |

### ElevenLabs (Required for in-browser voice)
| Variable | Description | Where to get |
|----------|-------------|-------------|
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | Conversational AI agent | elevenlabs.io dashboard |

### GoHighLevel (Required for CRM)
| Variable | Description | Where to get |
|----------|-------------|-------------|
| `GHL_API_KEY` | Agency-level API key | GHL → Settings → API Keys |
| `GHL_LOCATION_ID` | Default location ID | GHL location settings |
| `GHL_COMPANY_ID` | Agency company ID | GHL company settings |
| `GHL_SNAPSHOT_ID` | Automation snapshot ID | GHL → Snapshots |

### Google Business Profile (Required for GMB service)
| Variable | Description | Where to get |
|----------|-------------|-------------|
| `GOOGLE_CLIENT_ID` | OAuth2 client ID | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth2 client secret | Same |
| `GOOGLE_REFRESH_TOKEN` | Long-lived refresh token | OAuth2 flow (offline access) |

### Vercel (Required for website deployment)
| Variable | Description | Where to get |
|----------|-------------|-------------|
| `VERCEL_TOKEN` | API token | vercel.com/account/tokens |
| `VERCEL_TEAM_ID` | Team/org ID (optional) | Vercel team settings |

### Application
| Variable | Description | Where to get |
|----------|-------------|-------------|
| `NEXT_PUBLIC_WIDGET_URL` | URL where widget is hosted | Your deployment URL |
| `CRON_SECRET` | Bearer token for cron endpoints | Generate a random string |
| `PAYMENT_WEBHOOK_SECRET` | HMAC-SHA256 signing key (optional) | Your payment provider |

### Notifications (At least one required for escalations)
| Variable | Description | Where to get |
|----------|-------------|-------------|
| `SLACK_WEBHOOK_URL` | Incoming webhook URL | Slack app settings |
| `GOOGLE_CHAT_WEBHOOK_URL` | Chat space webhook | Google Chat space settings |

---

## 6. Database Schema

### Entity Relationship Overview

```
organizations ──┬── org_members (user_id → auth.users)
                ├── service_definitions
                │       └── required_data_fields (JSONB)
                ├── service_packages
                │       └── package_services ←→ service_definitions
                ├── niche_templates
                └── clients
                        ├── client_packages → service_packages
                        ├── client_services → service_definitions
                        │       └── service_tasks (A2P, GMB, website, GHL)
                        ├── onboarding_sessions
                        │       ├── session_responses
                        │       ├── outreach_queue
                        │       └── escalations
                        └── interaction_log

analytics_snapshots (daily aggregation, standalone)
```

### All Tables

#### `organizations`
Multi-tenant root. Contains `settings` JSONB with customizable outreach cadence (array of escalation steps: channel, delay, template).

#### `org_members`
Links `auth.users` to organizations with roles: `owner`, `admin`, `member`.

#### `service_definitions`
Services an agency offers (e.g., "AI Website Build", "A2P Registration"). Contains:
- `required_data_fields` (JSONB): Array of `{ key, label, type, options?, description? }` defining what data to collect
- `setup_steps` (JSONB): Array of `{ key, label, description }` for post-collection setup

#### `service_packages`
Bundles of services with a price (e.g., "Starter Package" = $499).

#### `package_services`
Junction table: which services are in which package.

#### `niche_templates`
Website templates by industry (plumbing, dental, restaurant). Contains `template_data` JSONB with layout info.

#### `clients`
People being onboarded. Stores `ghl_sub_account_id` and `ghl_contact_id` after GHL provisioning.

#### `client_packages`
Records which package a client purchased.

#### `client_services`
Per-service status tracking per client. Statuses: `pending_onboarding` → `onboarding` → `ready_to_deliver` → `in_progress` → `delivered`. Can be `opted_out`.

#### `onboarding_sessions`
One per client. Tracks `status` (active/paused/completed/abandoned), `current_channel`, `completion_pct` (0-100).

#### `session_responses`
Individual field answers. Each row = one answer to one question. Tracks `answered_via` (click/voice/sms/voice_call).

#### `service_tasks`
Async operations waiting on external systems. Types: `a2p_registration`, `gmb_access_request`, `website_generation`, `ghl_snapshot_deploy`, `ghl_sub_account_provision`. Has `next_check_at` for polling, `attempt_count` for retries, `last_result` JSONB for API responses.

#### `outreach_queue`
Scheduled messages. Each row = one pending SMS, email, or voice call with `scheduled_at`, `escalation_level`, `priority` (normal/urgent).

#### `escalations`
Human handoff records when the bot can't handle something. Statuses: `open` → `assigned` → `resolved`.

#### `interaction_log`
Complete audit trail of every interaction across all channels (sms, email, voice_call, widget, system). Stores direction (inbound/outbound), content, and metadata JSONB.

#### `analytics_snapshots`
Daily aggregated metrics: session counts, completion averages, channel breakdowns, escalation stats.

### Row-Level Security (RLS)

All tables have RLS enabled:
- **Org-scoped**: Most tables only accessible to members of the owning organization
- **Admin-only writes**: Service definitions, packages, and templates require `owner` or `admin` role to modify
- **Anonymous widget access**: `onboarding_sessions`, `session_responses`, and `interaction_log` allow anonymous INSERT for the widget (no auth required for clients filling out the wizard)

---

## 7. The Onboarding Flow (End-to-End)

This is the core business logic. Here's what happens from payment to completion:

### Step 1: Payment Webhook
```
External payment → POST /api/webhooks/payment
```
The payment handler (`automations/payment-handler.ts`) runs a 7-step initialization:
1. **Creates client** record (name, email, phone, business)
2. **Creates client_package** linking client to purchased package
3. **Creates client_services** for each service in the package (status: `pending_onboarding`)
4. **Provisions GHL sub-account** (creates location + contact in GoHighLevel)
5. **Deploys GHL snapshot** (automation templates: chatbot, missed call text back, etc.)
6. **Creates onboarding_session** (status: `active`)
7. **Queues initial SMS** via outreach_queue

### Step 2: Outreach Cadence
The cron job (`/api/cron/outreach`, every 2 minutes) processes the outreach queue:

**Default 8-step escalation cadence:**
| Time After Payment | Channel | Template |
|-------------------|---------|----------|
| 0 (immediate) | SMS | `welcome_sms` — intro + onboarding link |
| 1 hour | SMS | `reminder_1` |
| 4 hours | SMS | `reminder_2` |
| 24 hours | Voice Call | `call_reminder_1` (AI voice via Vapi) |
| 48 hours | Email + SMS | `email_reminder_1` + `reminder_3` |
| 72 hours | Voice Call | `call_reminder_2` |
| 5 days | SMS | `urgent_reminder` |
| 7 days | Voice Call | `final_call` → escalate to human |

If the client responds at any point, pending outreach is cancelled.

### Step 3: Multi-Channel Data Collection

Clients can respond via:

**A) Widget (browser)**
- Client clicks link in SMS → opens embeddable widget
- Widget has two modes: **Visual** (form steps) and **Voice** (ElevenLabs AI)
- Visual mode: one question at a time, text input or multiple choice
- Voice mode: real-time conversation via WebSocket, AI asks questions naturally
- Progress bar shows completion % per service

**B) SMS (Twilio)**
- Client texts back → webhook at `/api/webhooks/twilio`
- AI parses intent: if data answer, records it; if "CALL", initiates voice call; if "STOP", opts out
- Auto-replies with next question or confirmation

**C) Voice Call (Vapi)**
- AI calls client → Vapi handles conversation with Claude as backbone
- Function calls: `recordAnswer`, `advanceToNextItem`, `requestCallback`, `escalateToHuman`
- End-of-call webhook processes transcript and recorded answers

### Step 4: AI Agent Routing

The agent system (`agent/`) determines what to ask next:
- `buildAgentContext()` assembles: client info, services, missing fields, completed responses, task statuses
- `decideNextAction()` finds the first service with missing fields and returns the next question
- `contextToSystemPrompt()` generates a Claude system prompt: friendly assistant persona, one question at a time, persistent but not annoying

### Step 5: Service Task Execution

Once all required fields for a service are collected, tasks execute:

**A2P Registration** (`a2p-manager.ts`):
1. Create Twilio Trust Hub Customer Profile
2. Add End Users (business info, authorized rep)
3. Submit for evaluation
4. Create A2P Brand Registration (1-7 day approval)
5. Create Messaging Service
6. Create A2P Campaign (1-3 day approval)
7. Poll status via cron every 15 minutes

**GMB Optimization** (`gmb-manager.ts`):
1. Search Google for business listing
2. Request management access (client gets Google email)
3. Poll for approval (remind client via SMS if >24h)
4. Once approved: optimize hours, categories, phone, description

**Website Build** (`website-builder.ts`):
1. Find matching niche template (exact then fuzzy)
2. Claude generates customized HTML from template + client data
3. Deploy to Vercel via file API
4. Set up custom domain (client-slug.leadrwizard.com)
5. Send preview to client for approval (up to 3 revision rounds)

**GHL Automations** (`ghl-adapter.ts`):
1. Sub-account already provisioned at payment
2. Sync all collected data to GHL contact fields
3. Customize snapshot with client-specific info

### Step 6: Completion
- When all services reach `delivered` status, session marked `completed`
- Completion SMS sent to client
- Analytics snapshot updated

### Step 7: Escalation (when needed)
If the bot gets stuck (unusual question, payment issue, client frustrated):
- Creates escalation record with full context
- Sends rich notification to Slack or Google Chat
- Agency team can assign, resolve, and track in dashboard

---

## 8. API Routes

All routes live in `apps/admin/src/app/api/`.

### Webhook Endpoints (Public — no auth required)

#### `POST /api/webhooks/payment`
- **Auth:** Bearer token or X-API-Key header (maps to org), optional HMAC-SHA256 signature
- **Body:** `{ customer: { name, email, phone, business_name }, package_slug, payment_ref, metadata? }`
- **Action:** Triggers full onboarding initialization (see Step 1 above)
- **Returns:** `{ success, client_id, session_id }`

#### `POST /api/webhooks/twilio`
- **Auth:** Twilio signature validation (X-Twilio-Signature, HMAC-SHA1)
- **Body:** Twilio webhook FormData (From, Body, MessageSid, etc.)
- **Action:** Processes inbound SMS, runs intent detection, auto-replies
- **Returns:** TwiML XML response

#### `POST /api/webhooks/vapi`
- **Auth:** None (Vapi sends internally)
- **Body:** Vapi event JSON (`end-of-call-report`, `function-call`, `status-update`)
- **Action:** Processes call results, records answers, schedules follow-ups
- **Returns:** `{ ok: true }`

### Cron Endpoints (Protected by CRON_SECRET)

#### `GET /api/cron/outreach`
- **Auth:** Bearer token = `CRON_SECRET`
- **Frequency:** Every 2 minutes (pg_cron)
- **Action:** Processes pending outreach queue items
- **Returns:** `{ ok, processed, errors, timestamp }`

#### `POST /api/cron/tasks`
- **Auth:** Bearer token = `CRON_SECRET`
- **Frequency:** Every 15 minutes (pg_cron)
- **Action:** Polls async service tasks (A2P, GMB, website, GHL)
- **Returns:** `{ ok, checked, updated, errors }`

---

## 9. AI Agent System

Located in `packages/shared/src/agent/`.

### Architecture

```
                    ┌──────────────────┐
                    │  Agent Router    │
                    │  decideNextAction│
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───┐  ┌──────▼──────┐ ┌────▼────────┐
     │ SMS Handler│  │ Vapi Voice  │ │ Widget      │
     │ (Twilio)   │  │ (Phone)     │ │ (Browser)   │
     └────────────┘  └─────────────┘ └─────────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼─────────┐
                    │ Response Handler │
                    │ recordResponse() │
                    │ logInteraction() │
                    └──────────────────┘
```

### Key Files

**`agent-router.ts`**
- `decideNextAction(context)` — Determines the next question to ask based on what fields are still missing across all services
- `getAgentSystemPrompt(context)` — Generates Claude system prompt for SMS and voice handlers

**`agent-context.ts`**
- `buildAgentContext()` — Assembles the full picture: client, services, responses, tasks, interactions
- `contextToSystemPrompt()` — Converts context to a natural language prompt for Claude. Persona: friendly onboarding assistant, asks one field at a time, persistent but polite

**`response-handler.ts`**
- `recordResponse()` — Saves a field answer to `session_responses`
- `logInteraction()` — Writes to `interaction_log` audit trail
- `updateSessionProgress()` — Recalculates `completion_pct`

**`completion-checker.ts`**
- `checkCompletion()` — Returns per-service and overall completion status
- `getMissingSummary()` — Human-readable summary of what's still needed

---

## 10. Integrations

### 10.1 Twilio (SMS + A2P)

**Files:** `comms/twilio-sms.ts`, `automations/a2p-manager.ts`

**SMS Functions:**
- `sendSMS(to, body)` — Sends via Twilio REST API, logs to interaction_log
- `parseInboundSMS(body)` — Parses webhook payload (handles media)
- `validateTwilioSignature(signature, url, params)` — HMAC-SHA1 verification

**A2P Registration:**
Full 10DLC registration flow via Twilio Trust Hub:
1. Customer Profile creation
2. End User + Authorized Rep
3. Brand Registration (1-7 day review)
4. Messaging Service
5. Campaign Registration (1-3 day review)

**Webhook config in Twilio:** Point SMS webhook to `https://your-domain.com/api/webhooks/twilio`

### 10.2 Vapi (AI Voice Calls)

**File:** `comms/vapi-calls.ts`

- `initiateOutboundCall(phone, context)` — Starts AI call with Claude Sonnet 4 as backbone
- Sends system prompt with full agent context
- Function calls available during call: `recordAnswer`, `advanceToNextItem`, `requestCallback`, `escalateToHuman`
- `processCallEndEvent(event)` — Handles transcript, recordings, tool call results

**Vapi dashboard config:** Set webhook URL to `https://your-domain.com/api/webhooks/vapi`

### 10.3 ElevenLabs (In-Browser Voice)

**File:** `apps/widget/src/components/VoiceBot.tsx`

- WebSocket connection to ElevenLabs Conversational AI
- Real-time bidirectional audio streaming (16kHz)
- Client-side tool calls: `recordAnswer`, `advanceToNextItem`, `requestCallback`
- States: idle → connecting → listening → speaking → thinking

### 10.4 GoHighLevel (CRM)

**Files:** `automations/ghl-adapter.ts`, `comms/ghl-email.ts`

**Sub-account provisioning:**
- `provisionSubAccount(client)` — Creates GHL location + contact
- `deploySnapshot(locationId, snapshotId)` — Deploys automation templates

**Contact sync:**
- `syncContactToGHL(contactId, field, value)` — Syncs individual fields
- `customizeSnapshot(contactId, allResponses)` — Bulk sync all data

**Email:**
- `sendEmail(contactId, subject, htmlBody)` — Sends via GHL Conversations API
- Templates: `welcome()`, `reminder()`, `completion()`

### 10.5 Google Business Profile

**File:** `automations/gmb-manager.ts`

- OAuth2 authentication with refresh token
- `requestGMBAccess(businessName, address)` — Searches and requests management access
- `checkGMBAccessStatus(taskId)` — Polls for client approval
- Auto-optimizes listing (hours, categories, phone) once approved
- Sends SMS reminder if approval pending >24h

### 10.6 Vercel (Website Hosting)

**File:** `automations/website-builder.ts`

- `deployToVercel(html)` — File-based deployment API (index.html + 404.html)
- `setupCustomDomain(slug)` — Maps `{slug}.leadrwizard.com`
- Claude generates HTML by customizing niche templates with client data
- Supports up to 3 revision rounds based on client feedback

### 10.7 Anthropic Claude

**Used in:**
- `website-builder.ts` — HTML generation and revision (Sonnet 4)
- `agent-router.ts` — System prompt generation for voice/SMS handlers
- Vapi voice calls use Claude Sonnet 4 as the AI backbone

### 10.8 Slack / Google Chat

**File:** `automations/escalation-notifier.ts`

- `sendSlackNotification(escalation)` — Rich message with client info, progress, recent interactions
- `sendGoogleChatNotification(escalation)` — Card format with same context
- Channel configured per-org in `organization.settings.escalation_channel`

---

## 11. Admin Dashboard (UI)

All pages in `apps/admin/src/app/(dashboard)/`. Server-rendered with Supabase queries.

### Pages

| Route | File | Description |
|-------|------|-------------|
| `/dashboard` | `dashboard/page.tsx` | KPI cards (active/completed/total sessions, open escalations), avg completion %, outreach breakdown by channel, pending tasks by type, recent escalations, 14-day trend table |
| `/onboardings` | `onboardings/page.tsx` | Active session list: client name, business, status, progress %, channel, last activity. Up to 50 rows. |
| `/clients` | `clients/page.tsx` | Client directory with service progress and completion % |
| `/clients/[id]` | `clients/[id]/page.tsx` | Client detail: services with status cards, full interaction timeline, escalation history |
| `/services` | `services/page.tsx` | Service definitions grid: name, description, field count, required fields |
| `/packages` | `packages/page.tsx` | Service packages grid: name, price, included services |
| `/templates` | `templates/page.tsx` | Niche template gallery: niche name, description, preview URL |
| `/escalations` | `escalations/page.tsx` | Escalation list: reason, client, channel, status (color-coded), assignment |
| `/settings` | `settings/page.tsx` | Integration settings (non-functional UI shell) + outreach cadence display |
| `/login` | `(auth)/login/page.tsx` | Email/password + magic link login via Supabase |

### Navigation
Sidebar component (`components/sidebar.tsx`) with 8 menu items and active-state highlighting.

---

## 12. Embeddable Widget

### How It Works

The widget (`apps/widget`) compiles to a single IIFE JavaScript bundle that agencies embed on their sites or link from SMS messages.

### Embedding

```html
<script src="https://cdn.leadrwizard.com/widget.js"></script>
<div id="leadr-wizard"></div>
<script>
  LeadrWizardAPI.init({
    sessionId: 'uuid-from-onboarding-session',
    containerId: 'leadr-wizard',
    // Optional:
    supabaseUrl: '...',
    supabaseAnonKey: '...',
    theme: {
      primaryColor: '#4F46E5',
      borderRadius: '12px',
      fontFamily: 'Inter, sans-serif'
    }
  });
</script>
```

### Features
- **Shadow DOM isolation** — styles don't leak in or out
- **Visual mode** — one question at a time (text input or multiple choice)
- **Voice mode** — ElevenLabs conversational AI via WebSocket
- **Progress bar** — overall % + per-service breakdown
- **Session persistence** — picks up where client left off
- **Responsive** — works on mobile
- **Themeable** — primary color, border radius, font family

### State Management
`useWizardSession` hook:
- Queries Supabase for session, client, services, responses
- Calculates missing fields and next question
- `submitResponse()` records answers and advances

---

## 13. Cron Jobs & Background Processing

Configured via `pg_cron` in Supabase (migration `00002_pg_cron_jobs.sql`).

| Job | Schedule | Action |
|-----|----------|--------|
| Process Outreach Queue | Every 2 min | `POST /api/cron/outreach` — sends pending SMS, calls, emails |
| Process Service Tasks | Every 15 min | `POST /api/cron/tasks` — polls A2P, GMB, website, GHL status |
| Stale Session Detector | Hourly | Direct SQL — finds sessions inactive 2+ hours, queues reminder |
| Daily Analytics | Midnight UTC | Direct SQL — aggregates daily metrics into `analytics_snapshots` |

**Required Supabase config for HTTP-based cron jobs:**
```sql
ALTER DATABASE postgres SET app.settings.base_url = 'https://your-app.vercel.app';
ALTER DATABASE postgres SET app.settings.cron_secret = 'your-cron-secret';
```

---

## 14. Authentication & Authorization

### Auth Provider
Supabase Auth with:
- Email/password login
- Magic link (OTP) login
- OAuth callback at `/callback`

### Middleware
`apps/admin/src/middleware.ts`:
- Manages Supabase session cookies
- Redirects unauthenticated users to `/login`
- **Public routes** (no auth): `/login`, `/callback`, `/api/webhooks/*`, `/api/cron/*`

### RLS Policies
- Organization members can read/write their org's data
- `owner` and `admin` roles can modify service definitions, packages, templates
- `member` role is read-only for config, read-write for operational data
- Anonymous access allowed for widget operations (session creation, response submission, interaction logging)

---

## 15. Deployment

### Vercel (Recommended for Admin App)

1. Import GitHub repo at vercel.com/new
2. Configure:
   - **Framework:** Next.js
   - **Root Directory:** `apps/admin`
   - **Build Command:** `cd ../.. && pnpm build`
   - **Install Command:** `cd ../.. && pnpm install`
3. Add all environment variables from Section 5
4. Deploy

### Widget CDN
```bash
cd apps/widget && pnpm build
# Upload dist/ to CDN (Vercel, Cloudflare, S3+CloudFront)
```

### Supabase
```bash
supabase link --project-ref <ref>
supabase db push          # Apply migrations
# Seed only for fresh installs:
supabase db reset          # Migrations + seed
```

### Post-Deploy Checklist
- [ ] Set `NEXT_PUBLIC_WIDGET_URL` to actual deployment URL
- [ ] Configure Twilio SMS webhook → `https://your-app/api/webhooks/twilio`
- [ ] Configure Vapi webhook → `https://your-app/api/webhooks/vapi`
- [ ] Configure payment webhook → `https://your-app/api/webhooks/payment`
- [ ] Set Supabase `app.settings.base_url` and `app.settings.cron_secret` for pg_cron
- [ ] Verify cron jobs are running in Supabase dashboard
- [ ] Test full flow: payment webhook → SMS → widget → task execution

---

## 16. Incomplete / TODO Items

These features have UI shells or partial implementations but are **not yet functional**:

| Item | Status | Notes |
|------|--------|-------|
| **Settings page** | UI only | Integration config inputs are disabled ("Coming Soon"). Settings are currently env-var only. |
| **Add Service button** | Non-functional | Services page has button but no create form/API |
| **Add Package button** | Non-functional | Packages page has button but no create form/API |
| **Add Template button** | Non-functional | Templates page has button but no create form/API |
| **CRUD for services/packages/templates** | Missing | Currently seeded via SQL only. Need admin UI forms + API routes |
| **Organization management** | Missing | No UI to create/manage orgs or invite members |
| **User profile/settings** | Missing | No profile page, password change, etc. |
| **Real-time updates** | Not implemented | Dashboard requires page refresh; could use Supabase real-time subscriptions |
| **Widget URL/embed code generator** | Missing | No UI to generate embed snippets for clients |
| **Reporting/export** | Missing | Analytics are display-only, no CSV/PDF export |
| **Multi-org support** | Schema ready, UI not | RLS supports multi-tenant but UI assumes single org |
| **Tests** | Minimal | Vitest configured but test coverage is low |
| **Payment integration** | Webhook only | No Stripe/payment UI; relies on external payment page sending webhook |

---

## 17. Key File Index

### Configuration
| File | Purpose |
|------|---------|
| `package.json` | Root — Turborepo scripts, Vitest |
| `turbo.json` | Turborepo pipeline config |
| `pnpm-workspace.yaml` | Workspace definitions |
| `.env.example` | All required environment variables |
| `supabase/config.toml` | Local Supabase config |

### Database
| File | Purpose |
|------|---------|
| `supabase/migrations/00001_initial_schema.sql` | All tables, indexes, RLS policies |
| `supabase/migrations/00002_pg_cron_jobs.sql` | Cron jobs + analytics_snapshots table |
| `supabase/seed.sql` | Demo org, 4 services, 1 package, 3 niche templates |

### Shared Business Logic
| File | Purpose |
|------|---------|
| `packages/shared/src/types/index.ts` | All TypeScript interfaces and enums |
| `packages/shared/src/supabase/client.ts` | Browser + server Supabase client factories |
| `packages/shared/src/agent/agent-router.ts` | AI decision engine — determines next action |
| `packages/shared/src/agent/agent-context.ts` | Builds full context for AI from database |
| `packages/shared/src/agent/response-handler.ts` | Records responses, logs interactions |
| `packages/shared/src/agent/completion-checker.ts` | Calculates completion % |
| `packages/shared/src/comms/twilio-sms.ts` | Twilio SMS send/receive/validate |
| `packages/shared/src/comms/vapi-calls.ts` | Vapi outbound calls + event processing |
| `packages/shared/src/comms/ghl-email.ts` | GHL email sending + templates |
| `packages/shared/src/comms/message-templates.ts` | All SMS/outreach message templates |
| `packages/shared/src/comms/outreach-processor.ts` | Processes outreach queue + handles SMS replies |
| `packages/shared/src/automations/payment-handler.ts` | Full onboarding initialization on payment |
| `packages/shared/src/automations/outreach-scheduler.ts` | Cadence scheduling + cancellation |
| `packages/shared/src/automations/task-processor.ts` | Polls async tasks (A2P, GMB, etc.) |
| `packages/shared/src/automations/ghl-adapter.ts` | GHL sub-account + snapshot + contact sync |
| `packages/shared/src/automations/a2p-manager.ts` | Twilio A2P 10DLC registration flow |
| `packages/shared/src/automations/gmb-manager.ts` | Google Business Profile access + optimization |
| `packages/shared/src/automations/website-builder.ts` | Claude HTML generation + Vercel deploy |
| `packages/shared/src/automations/escalation-notifier.ts` | Slack/Google Chat escalation alerts |

### Admin App
| File | Purpose |
|------|---------|
| `apps/admin/src/middleware.ts` | Auth middleware + public route allowlist |
| `apps/admin/src/app/api/webhooks/payment/route.ts` | Payment webhook handler |
| `apps/admin/src/app/api/webhooks/twilio/route.ts` | Twilio SMS webhook handler |
| `apps/admin/src/app/api/webhooks/vapi/route.ts` | Vapi voice webhook handler |
| `apps/admin/src/app/api/cron/outreach/route.ts` | Outreach queue processor |
| `apps/admin/src/app/api/cron/tasks/route.ts` | Service task poller |
| `apps/admin/src/app/(dashboard)/dashboard/page.tsx` | Main analytics dashboard |
| `apps/admin/src/app/(dashboard)/clients/[id]/page.tsx` | Client detail view |
| `apps/admin/src/components/sidebar.tsx` | Navigation sidebar |

### Widget
| File | Purpose |
|------|---------|
| `apps/widget/src/main.tsx` | Entry point, `LeadrWizardAPI.init()` |
| `apps/widget/src/components/WizardWidget.tsx` | Main widget container |
| `apps/widget/src/components/VoiceBot.tsx` | ElevenLabs voice integration |
| `apps/widget/src/components/StepRenderer.tsx` | Visual form step renderer |
| `apps/widget/src/hooks/useWizardSession.ts` | Session state management |
