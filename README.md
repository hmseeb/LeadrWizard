# LeadrWizard

AI-powered autonomous onboarding agent that automates client service setup through multi-channel conversations (SMS, voice, email, web widget).

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, Tailwind CSS
- **Widget**: Vite (IIFE bundle for third-party embedding)
- **Database**: Supabase (PostgreSQL 15 + Auth + pg_cron)
- **AI**: Claude (agent decision-making), ElevenLabs (voice widget), Vapi (outbound calls)
- **Integrations**: Twilio (SMS/A2P), GoHighLevel (CRM), Google Business Profile, Vercel (hosting)
- **Monorepo**: Turborepo + pnpm

## Project Structure

```
apps/
  admin/          Next.js dashboard — client management, escalations, analytics
  widget/         Vite-built embed widget — voice + form-based onboarding
packages/
  shared/         Business logic — agent, automations, comms, types, utils
  eslint-config/  Shared ESLint config
  tsconfig/       Shared TypeScript config
supabase/
  migrations/     Database schema + pg_cron jobs
  seed.sql        Demo data
```

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10+
- Supabase CLI (for local development)

### Setup

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env.local
# Edit .env.local with your API keys

# Start Supabase locally
supabase start

# Apply migrations
supabase db reset

# Start development
pnpm dev
```

The admin dashboard runs at `http://localhost:3000` and the widget dev server at `http://localhost:5173`.

### Environment Variables

See `.env.example` for all required variables. At minimum you need:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` — Claude API for agent intelligence
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` — SMS
- `CRON_SECRET` — authenticates cron job endpoints

## Scripts

```bash
pnpm dev          # Start all apps in development mode
pnpm build        # Build all apps
pnpm type-check   # Run TypeScript type checking
pnpm test         # Run tests
pnpm lint         # Lint all packages
```

## Architecture

### Agent Flow

1. **Payment webhook** receives a purchase event → creates client, session, and client services
2. **Outreach queue** sends welcome SMS/email with onboarding link
3. **Client responds** via widget, SMS, or voice call
4. **Agent router** determines the next question based on missing fields
5. **Responses are recorded** and completion percentage updates
6. **Service tasks** (A2P registration, GMB access, website generation) run asynchronously
7. **Task processor** (cron) polls external APIs for status updates
8. **Escalation system** alerts humans via Slack/Google Chat when needed

### Webhook Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/webhooks/twilio` | Inbound SMS from clients |
| `POST /api/webhooks/vapi` | Voice call events (end-of-call, function calls) |
| `POST /api/webhooks/payment` | Payment events → onboarding initialization |
| `POST /api/cron/tasks` | Service task processor (called by pg_cron) |
| `POST /api/cron/outreach` | Outreach queue processor (called by pg_cron) |

## Testing

```bash
pnpm test              # Run all tests
pnpm test -- --watch   # Watch mode
```

Tests are written with [Vitest](https://vitest.dev/) and cover:

- Agent routing and decision-making
- Completion checking logic
- Context building and system prompt generation
- SMS parsing and message templates
- Utility functions (phone formatting, slugify, etc.)
## Summary

- **Test suite**: Set up Vitest with 38 tests covering agent routing, context building, completion checking, SMS parsing, message templates, and utility functions
- **CI/CD**: GitHub Actions pipeline that runs type-check, tests, and build on every push/PR to master
- **Security hardening**: Enforced Twilio webhook signature validation (HMAC-SHA1) and added payment webhook HMAC-SHA256 signature verification with API key-based org_id resolution
- **ElevenLabs voice widget**: Full WebSocket integration with real-time audio streaming, microphone capture, live transcript, and client-side tool handling
- **README**: Architecture overview, setup instructions, environment variable reference, and available scripts

## Test plan

- [x] All 38 tests pass (`pnpm test`)
- [ ] Verify Twilio webhook rejects requests with invalid signatures in staging
- [ ] Verify payment webhook resolves org_id from API key header
- [ ] Test ElevenLabs voice widget with a configured agent ID in the browser
- [ ] Confirm CI pipeline runs successfully on this PR
