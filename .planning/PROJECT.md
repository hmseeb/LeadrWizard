# LeadrWizard

## What This Is

AI-powered autonomous onboarding agent that automates client service setup through multi-channel conversations (SMS, voice, email, web widget). Agencies purchase a package, their clients get onboarded automatically via an intelligent agent that collects required data and provisions services (A2P registration, Google Business Profile, website generation, GoHighLevel CRM setup). Multi-tenant SaaS where agencies self-serve via Stripe checkout.

## Core Value

Clients get onboarded without human intervention. The agent asks the right questions through the right channel at the right time, and services get set up automatically.

## Requirements

### Validated

- ✓ Payment webhook creates client, session, and queues outreach — existing
- ✓ Multi-channel outreach: SMS (Twilio), voice (Vapi), email (GHL) — existing
- ✓ Agent router determines next question based on missing fields — existing
- ✓ Service task processing: A2P registration, GMB access, website gen, GHL provisioning — existing
- ✓ Outreach queue with retry logic and cadence scheduling — existing
- ✓ Escalation system with Slack/Google Chat notifications — existing
- ✓ Admin dashboard with read-only views: clients, onboardings, billing, escalations — existing
- ✓ Widget with shadow DOM isolation, voice bot, step renderer, progress bar — existing (components)
- ✓ Supabase auth with middleware session management — existing
- ✓ Database schema with RLS, pg_cron, multi-tenant tables — existing
- ✓ Stripe billing adapter: checkout sessions, portal, subscription management — existing
- ✓ Twilio webhook signature verification (HMAC-SHA1) — existing
- ✓ Payment webhook HMAC-SHA256 signature verification — existing
- ✓ ElevenLabs in-browser voice widget — existing (component)
- ✓ CI/CD pipeline via GitHub Actions (type-check, test, build) — existing
- ✓ 38 unit tests covering agent routing, context building, SMS parsing, templates, utils — existing

### Active

- [ ] Self-service org signup: Stripe checkout → auto-provision org → admin access
- [ ] Admin CRUD for service definitions (create, edit, delete)
- [ ] Admin CRUD for packages (create, edit, assign services)
- [ ] Admin CRUD for message templates (create, edit, preview)
- [ ] Org settings management UI (integration credentials, cadence config)
- [ ] Widget end-to-end flow: session load → form steps → response submission → completion
- [ ] Widget voice + form hybrid: ElevenLabs voice AND form-based data collection
- [ ] Stripe webhook signature verification in /api/webhooks/stripe route
- [ ] Idempotency keys on payment webhook to prevent duplicate client creation
- [ ] Atomic payment handler (rollback on partial failure)
- [ ] RLS policy hardening: sessions/responses require org_id validation, not anonymous insert
- [ ] Rate limiting on public webhook endpoints
- [ ] Stripe CLI integration for local webhook testing
- [ ] Test coverage expansion: automations, API routes, payment edge cases, multi-org isolation
- [ ] Structured logging with correlation IDs (replace console.error)
- [ ] Real-time dashboard updates via Supabase realtime subscriptions
- [ ] Per-org Twilio phone number support
- [ ] Per-org GHL credentials (stored encrypted in org settings)

### Out of Scope

- Mobile native app — web-first, widget embeds on client sites
- Custom domain per org — shared platform domain for v1
- White-labeling / custom branding — agencies use LeadrWizard brand for now
- Advanced analytics / reporting dashboards — basic KPI cards sufficient for launch
- Client-facing portal — clients interact via widget, SMS, or voice only
- Automated billing usage metering — manual plan limits for v1

## Context

This is a brownfield codebase at ~75% implementation. The core onboarding engine works end-to-end: payment → client creation → outreach → agent conversation → service fulfillment. What's missing is primarily admin UX (CRUD operations), production hardening (security, tests, observability), and the widget e2e flow.

The codebase is a Turborepo monorepo with pnpm:
- `apps/admin` — Next.js 15 dashboard
- `apps/widget` — Vite IIFE bundle for third-party embedding
- `packages/shared` — Business logic (agent, automations, comms, billing, types)
- `supabase/migrations` — 3 production-ready migrations

Key integrations: Twilio (SMS), Vapi (voice calls), ElevenLabs (browser voice), GoHighLevel (CRM), Google Business Profile, Stripe (billing), Vercel (website deploys), Claude (AI agent).

See `.planning/codebase/` for detailed analysis of each layer.

## Constraints

- **Tech stack**: Existing monorepo (Next.js 15, Vite, Supabase, pnpm). No framework changes.
- **Package manager**: pnpm 10+ (enforced via packageManager field)
- **Database**: Supabase PostgreSQL with pg_cron. No migration to other providers.
- **Hosting**: Vercel for admin app, Supabase managed Postgres.
- **Integrations**: All existing integrations (Twilio, Vapi, GHL, GMB, ElevenLabs, Stripe, Vercel) must remain. No replacements.
- **Multi-tenancy**: Row-level security (RLS) enforced. Every query must be org-scoped.
- **Backward compatibility**: Existing webhook endpoints and database schema must not break. Additive changes only.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Interleave hardening + features per phase | Ship usable increments while tightening security progressively | — Pending |
| Self-service via Stripe checkout → auto-provision | Reduces manual onboarding of agencies, scales better | — Pending |
| Keep all services in v1 (A2P, GMB, website, GHL) | Full value proposition from launch, no half-baked offering | — Pending |
| Voice + form hybrid widget | Maximizes accessibility, some clients prefer typing, others voice | — Pending |
| Stripe CLI for local development | Enables testing webhooks without deploying, faster iteration | — Pending |

---
*Last updated: 2026-03-13 after initialization*
