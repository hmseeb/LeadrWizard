# Architecture

**Analysis Date:** 2026-03-13

## Pattern Overview

**Overall:** Monorepo with tiered service layer architecture using event-driven webhooks and async task processing

**Key Characteristics:**
- Multi-app monorepo (admin dashboard, widget, packages)
- Event-driven integration with external services (Twilio, Vapi, Stripe, GHL, etc.)
- Centralized shared package for domain logic and integrations
- Webhook-first communication pattern for voice calls, SMS, and payments
- Async task processing via cron endpoints for polling and state management
- Supabase as primary data store with direct SQL access from API routes

## Layers

**Presentation Layer (Apps):**
- Purpose: User-facing applications
- Location: `apps/admin/`, `apps/widget/`
- Contains: Next.js page components, React UI, route handlers
- Depends on: `@leadrwizard/shared` for domain types and business logic
- Used by: End users (admin dashboard), client onboarding workflows

**API & Webhook Layer:**
- Purpose: External service integrations and HTTP endpoints
- Location: `apps/admin/src/app/api/webhooks/`, `apps/admin/src/app/api/cron/`, `apps/admin/src/app/api/billing/`
- Contains: Route handlers for voice calls (Vapi), SMS (Twilio), payments (Stripe), email (GHL)
- Depends on: Supabase client, shared domain logic, external SDK clients
- Used by: External services (Vapi, Twilio, Stripe), cron schedulers

**Domain & Business Logic Layer:**
- Purpose: Core application logic, service management, and orchestration
- Location: `packages/shared/src/`
- Contains: Agent router, communications, automations, billing, tenant management
- Depends on: Type definitions, Supabase client
- Used by: API routes, cron jobs, other shared modules

**Data Layer:**
- Purpose: Database interaction and entity management
- Location: Supabase (external), accessed via `@supabase/supabase-js` from all layers
- Contains: Organizations, clients, services, sessions, tasks, interactions, outreach queue
- Depends on: None (external service)
- Used by: All application layers via the shared Supabase client

**Authentication & Middleware Layer:**
- Purpose: User authentication, session management, request routing
- Location: `apps/admin/src/middleware.ts`, `apps/admin/src/lib/supabase-*`
- Contains: SSR cookie handling, auth checks, redirects
- Depends on: Supabase SSR client
- Used by: All Next.js requests

## Data Flow

**Onboarding Session Initiation Flow:**

1. User creates organization via `POST /api/org/create`
2. Route handler calls `createOrganization()` from `@leadrwizard/shared/tenant`
3. Shared module writes org + membership to Supabase
4. Admin dashboard displays setup wizard (page at `apps/admin/src/app/(dashboard)/onboardings/page.tsx`)
5. Client receives widget embed for service data collection

**Inbound Voice Call Flow:**

1. Client calls phone number attached to Vapi assistant
2. Vapi initiates call and makes webhook POST to `/api/webhooks/vapi`
3. Route handler receives call metadata (client_id, session_id)
4. For function calls (recordAnswer, escalateToHuman), handler inserts to `session_responses` or `escalations` tables
5. For end-of-call, handler calls `processCallEndEvent()` from shared comms module
6. If call failed/no-answer, handler schedules next follow-up via `scheduleNextFollowUp()` from shared automations
7. Interaction is logged to `interaction_log` table

**Inbound SMS Reply Flow:**

1. Client texts reply to Twilio number
2. Twilio webhooks POST to `/api/webhooks/twilio`
3. Route handler parses SMS via `parseInboundSMS()` from shared comms
4. Handler calls `handleInboundSMSReply()` from shared outreach processor
5. Reply is recorded to `session_responses` table
6. Agent context is rebuilt with updated responses
7. Decision made by agent router to ask next question or advance service

**Automated Outreach Scheduling Flow:**

1. Cron job hits `/api/cron/outreach` periodically
2. Route handler calls `processOutreachQueue()` from shared comms module
3. Shared module pulls pending items from `outreach_queue` table
4. For each item, determines channel (SMS, email, voice) and sends via appropriate service
5. Records `sent_at` timestamp and updates status to "sent" or "failed"
6. If scheduled_at is past limit, escalates or creates escalation record

**Task Processing (Async Services) Flow:**

1. Cron job hits `/api/cron/tasks` periodically
2. Route handler processes pending `ServiceTask` records
3. For A2P registration: calls `checkA2PStatus()` from shared automations
4. For GMB access: calls `checkGMBAccessStatus()` from shared automations
5. For website generation: calls task processor to handle website builder steps
6. Task status updated to "completed" or "waiting_external" based on result
7. If completed, corresponding ClientService status may advance

**Payment Webhook Flow:**

1. Customer completes Stripe checkout
2. Stripe webhooks POST to `/api/webhooks/payment`
3. Route handler calls `handlePaymentWebhook()` from shared automations
4. Shared module:
   - Creates OrgSubscription record
   - Provisions GHL sub-account via `provisionSubAccount()` from shared automations
   - Creates service packages and client services
   - Initiates outreach for onboarding session
5. Client receives initial contact via SMS or voice based on cadence config

**State Management:**

- **Session State:** Stored in `onboarding_sessions` table with status (active, paused, completed, abandoned)
- **Agent Context:** Built in-memory by querying client, session, services, responses, tasks, interaction_history
- **Task Tracking:** Persistent in `service_tasks` table with external_ref for polling third-party APIs
- **Outreach Queue:** Persistent in `outreach_queue` table for retry logic and cadence scheduling
- **Escalation State:** Persistent in `escalations` table with assignment and resolution tracking

## Key Abstractions

**Agent Context:**
- Purpose: Encapsulates all information AI agent needs to make routing decisions
- Examples: `packages/shared/src/agent/agent-context.ts`
- Pattern: Built dynamically from raw database queries, converted to system prompt for Claude API

**Service Definition:**
- Purpose: Represents configurable onboarding service with required fields and setup steps
- Examples: Built from `ServiceDefinition` type, stored in `service_definitions` table
- Pattern: Each service has required_data_fields (what to ask) and setup_steps (what to do)

**Outreach Cadence:**
- Purpose: Configurable retry/follow-up schedule with channel progression
- Examples: `packages/shared/src/automations/outreach-scheduler.ts`
- Pattern: Stored in org settings, applied when initial contact fails or session stalls

**Client Package:**
- Purpose: Represents purchased service bundle for a client
- Examples: `ClientPackage` type mapping client → package → services
- Pattern: Links billing to service delivery; triggers task creation when purchased

**Service Task:**
- Purpose: Async long-running operation with polling state
- Examples: A2P registration, GMB access request, website generation, GHL deployment
- Pattern: Created in "pending", polled periodically, transitioned to "completed" or "failed"

## Entry Points

**Admin App - Main Dashboard:**
- Location: `apps/admin/src/app/(dashboard)/dashboard/page.tsx`
- Triggers: Authenticated user navigates to `/`
- Responsibilities: Display org overview, active clients, onboarding progress

**Admin App - Org Creation:**
- Location: `apps/admin/src/app/api/org/create` (API route)
- Triggers: New user completes signup, calls POST /api/org/create
- Responsibilities: Create org record, set owner, initialize org settings

**Admin App - Auth:**
- Location: `apps/admin/src/app/(auth)/login/page.tsx`
- Triggers: Unauthenticated user or session expired
- Responsibilities: OAuth with Supabase, set auth cookies, redirect to dashboard

**Widget App - Onboarding Widget:**
- Location: `apps/widget/src/main.tsx` exports `init()` function
- Triggers: Client website calls `window.LeadrWizard.init({sessionId, containerId})`
- Responsibilities: Render wizard UI in shadow DOM, collect responses via API calls

**Voice Call Webhook:**
- Location: `apps/admin/src/app/api/webhooks/vapi/route.ts`
- Triggers: Vapi call status changes or call ends
- Responsibilities: Record interaction, parse tool calls, schedule follow-ups

**SMS Webhook:**
- Location: `apps/admin/src/app/api/webhooks/twilio/route.ts`
- Triggers: Inbound SMS received by Twilio number
- Responsibilities: Parse SMS, record session response, update outreach status

**Payment Webhook:**
- Location: `apps/admin/src/app/api/webhooks/stripe/route.ts` (or `/api/webhooks/payment`)
- Triggers: Stripe payment_intent.succeeded or subscription.updated
- Responsibilities: Create subscription, provision GHL account, trigger onboarding

**Outreach Cron:**
- Location: `apps/admin/src/app/api/cron/outreach`
- Triggers: External scheduler (every 5 min recommended)
- Responsibilities: Process outreach queue, send SMS/voice/email, handle retries

**Task Processing Cron:**
- Location: `apps/admin/src/app/api/cron/tasks`
- Triggers: External scheduler (every 5-10 min recommended)
- Responsibilities: Poll task status from third-party APIs, update completion state

## Error Handling

**Strategy:** Multi-layered with fallback escalation

**Patterns:**

- **API Route Errors:** Try-catch wrapper returns NextResponse.json with 500 status and error message logged to console
- **External Service Failures:** Recorded in task status as "failed", retried via next cron execution
- **Validation Errors:** Caught at entry point (org creation, session response), return 400 with clear message
- **Database Errors:** Logged, return 500, may trigger escalation if user-facing
- **Webhook Signature Validation:** Twilio signature validated before processing; invalid requests rejected (401)
- **Task Polling Exhaustion:** After max attempts, task marked "failed", escalation created for manual review

## Cross-Cutting Concerns

**Logging:**
- Approach: Console.error for errors, console.log for key events
- Places: All API routes, webhook handlers, shared modules
- Examples: `console.error("Vapi webhook error:", error)`

**Validation:**
- Approach: Manual checks in route handlers (required fields, auth state)
- Places: `/api/org/create` validates name length; middleware checks auth
- Examples: Supabase auth check in middleware, SMS signature validation

**Authentication:**
- Approach: Supabase SSR with middleware
- Places: `apps/admin/src/middleware.ts` validates session on every request
- Pattern: Redirect unauthenticated users to `/login`, allow webhooks and cron (exempted)

**Concurrency:**
- Approach: Database-level row-level locking via Supabase
- Concern: Multiple cron instances may process same queue item (mitigated by "sent" status check)
- Safeguard: Task status must be "pending" before updating to "in_progress"

---

*Architecture analysis: 2026-03-13*
