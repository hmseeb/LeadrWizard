# Codebase Structure

**Analysis Date:** 2026-03-13

## Directory Layout

```
LeadrWizard/
├── apps/                          # Application packages
│   ├── admin/                     # Next.js admin dashboard & API
│   │   ├── src/
│   │   │   ├── app/              # Next.js app directory (pages, API routes)
│   │   │   │   ├── (auth)/       # Auth pages (login, callback, setup)
│   │   │   │   ├── (dashboard)/  # Protected dashboard pages
│   │   │   │   ├── api/          # Webhook and CRUD API routes
│   │   │   │   ├── layout.tsx    # Root layout
│   │   │   │   ├── page.tsx      # Index/home page
│   │   │   │   └── globals.css   # Tailwind imports
│   │   │   ├── components/       # React UI components
│   │   │   ├── lib/              # Utility functions (Supabase clients)
│   │   │   └── middleware.ts     # Auth middleware
│   │   ├── package.json          # Next.js + Tailwind deps
│   │   └── next.config.js        # Next.js config (if present)
│   │
│   └── widget/                    # Vite-built embeddable React widget
│       ├── src/
│       │   ├── main.tsx          # Entry point, exports window.LeadrWizard.init()
│       │   ├── components/       # React components (WizardWidget, StepRenderer, VoiceBot, etc.)
│       │   ├── hooks/            # Custom hooks (useWizardSession)
│       │   └── styles/           # CSS (shadow DOM injected styles)
│       ├── package.json          # Vite + React deps
│       └── vite.config.ts        # Vite build config
│
├── packages/                      # Shared code packages
│   ├── shared/                    # Core domain logic & integrations
│   │   ├── src/
│   │   │   ├── index.ts          # Main export file
│   │   │   ├── types/            # TypeScript type definitions
│   │   │   ├── agent/            # Agent routing & context building
│   │   │   │   ├── agent-router.ts          # Decision logic for next action
│   │   │   │   ├── agent-context.ts         # Context building from DB
│   │   │   │   ├── completion-checker.ts    # Task completion logic
│   │   │   │   ├── response-handler.ts      # Process responses
│   │   │   │   ├── index.ts
│   │   │   │   └── __tests__/               # Agent tests
│   │   │   ├── comms/            # Communication channels
│   │   │   │   ├── twilio-sms.ts            # SMS send/receive
│   │   │   │   ├── vapi-calls.ts            # Voice call integration
│   │   │   │   ├── ghl-email.ts             # Email via GHL
│   │   │   │   ├── message-templates.ts     # Template resolution
│   │   │   │   ├── outreach-processor.ts    # Queue processing
│   │   │   │   ├── index.ts
│   │   │   │   └── __tests__/               # Comms tests
│   │   │   ├── automations/      # Service automation orchestration
│   │   │   │   ├── payment-handler.ts       # Process payment webhooks
│   │   │   │   ├── outreach-scheduler.ts    # Schedule follow-ups
│   │   │   │   ├── a2p-manager.ts           # 10DLC A2P registration
│   │   │   │   ├── gmb-manager.ts           # Google My Business access
│   │   │   │   ├── website-builder.ts       # Website generation
│   │   │   │   ├── ghl-adapter.ts           # GHL sub-account provisioning
│   │   │   │   ├── escalation-notifier.ts   # Escalation management
│   │   │   │   ├── task-processor.ts        # Async task handling
│   │   │   │   └── index.ts
│   │   │   ├── billing/          # Billing & subscription logic
│   │   │   │   └── (internal logic)
│   │   │   ├── tenant/           # Org & tenant management
│   │   │   │   ├── org-manager.ts           # Org CRUD operations
│   │   │   │   └── index.ts
│   │   │   ├── supabase/         # Database client factory
│   │   │   │   └── client.ts
│   │   │   ├── utils/            # Shared utilities
│   │   │   │   ├── rate-limiter.ts          # Rate limiting
│   │   │   │   ├── index.ts
│   │   │   │   └── __tests__/               # Utils tests
│   │   │   └── index.ts          # Barrel export
│   │   ├── package.json          # Exports all submodules
│   │   └── tsconfig.json
│   │
│   ├── tsconfig/                 # Shared TypeScript config
│   │   ├── base.json
│   │   └── package.json
│   │
│   └── eslint-config/            # Shared ESLint config
│       └── package.json
│
├── supabase/                      # Supabase migrations & config
│   └── migrations/                # SQL migration files
│
├── .github/                       # GitHub Actions workflows
│   └── workflows/
│
├── .planning/                     # Planning & documentation
│   └── codebase/                  # Generated codebase analysis (this file)
│
├── package.json                   # Root workspace package.json
├── pnpm-workspace.yaml            # Workspace definition
├── turbo.json                     # Turborepo configuration
├── tsconfig.json                  # Root TypeScript config
├── vitest.config.ts               # Vitest configuration (test runner)
├── README.md                      # Project overview
├── DEVELOPER_HANDOVER.md          # Developer onboarding guide
└── .env.example                   # Environment variables template
```

## Directory Purposes

**apps/admin:**
- Purpose: Next.js application serving admin dashboard and API backend
- Contains: Pages (dashboard, clients, settings), API routes (webhooks, CRUD), middleware
- Key files: `src/app/(dashboard)/layout.tsx`, `src/app/api/`

**apps/widget:**
- Purpose: Embeddable React widget for client onboarding
- Contains: React components, hooks, styles for wizard UI
- Key files: `src/main.tsx`, `src/components/WizardWidget.tsx`

**packages/shared:**
- Purpose: Centralized domain logic and service integrations
- Contains: Type definitions, agent logic, comms handlers, automation orchestration
- Key files: `src/index.ts` (main export), `src/types/index.ts`, `src/agent/`, `src/comms/`, `src/automations/`

**packages/tsconfig:**
- Purpose: Shared TypeScript configurations
- Contains: Base config templates for different package types
- Used by: All packages inherit from this

**supabase/migrations:**
- Purpose: Database schema and data migrations
- Contains: SQL files for creating tables, indexes, policies
- Pattern: Named with timestamps (e.g., `20240101_init.sql`)

## Key File Locations

**Entry Points:**

| Location | Purpose |
|----------|---------|
| `apps/admin/src/app/page.tsx` | Dashboard home (redirects to dashboard/dashboard/page.tsx) |
| `apps/admin/src/app/(auth)/login/page.tsx` | Login page |
| `apps/admin/src/app/(dashboard)/dashboard/page.tsx` | Main admin dashboard |
| `apps/widget/src/main.tsx` | Widget init function exported to window.LeadrWizard |

**Configuration:**

| Location | Purpose |
|----------|---------|
| `package.json` | Root workspace definition |
| `pnpm-workspace.yaml` | Workspace package configuration |
| `turbo.json` | Turborepo build/dev task orchestration |
| `tsconfig.json` | Root TypeScript config |
| `vitest.config.ts` | Test runner configuration |
| `.env.example` | Template for required environment variables |

**Core Logic:**

| Location | Purpose |
|----------|---------|
| `packages/shared/src/agent/agent-router.ts` | Agent decision-making logic |
| `packages/shared/src/comms/outreach-processor.ts` | Outreach queue processing |
| `packages/shared/src/automations/payment-handler.ts` | Payment webhook orchestration |
| `packages/shared/src/tenant/org-manager.ts` | Organization management |

**API Routes (Admin):**

| Location | Purpose |
|----------|---------|
| `apps/admin/src/app/api/webhooks/vapi/route.ts` | Vapi voice call webhooks |
| `apps/admin/src/app/api/webhooks/twilio/route.ts` | Twilio SMS webhooks |
| `apps/admin/src/app/api/webhooks/stripe/route.ts` | Stripe payment webhooks |
| `apps/admin/src/app/api/cron/outreach/route.ts` | Periodic outreach queue processing |
| `apps/admin/src/app/api/cron/tasks/route.ts` | Periodic task polling |
| `apps/admin/src/app/api/org/create/route.ts` | Organization creation |
| `apps/admin/src/app/api/billing/checkout/route.ts` | Stripe checkout initiation |

**Testing:**

| Location | Purpose |
|----------|---------|
| `packages/shared/src/**/__tests__/` | Unit tests for shared modules |
| `vitest.config.ts` | Global test configuration |

## Naming Conventions

**Files:**

- Route handlers: `route.ts` (not `index.ts`) in Next.js app directories
- Feature modules: kebab-case (e.g., `agent-router.ts`, `outreach-processor.ts`)
- Components: PascalCase (e.g., `WizardWidget.tsx`, `StepRenderer.tsx`)
- Utilities: kebab-case (e.g., `rate-limiter.ts`, `message-templates.ts`)
- Tests: Same name as source file + `.test.ts` or `.spec.ts` suffix (e.g., `agent-router.test.ts`)

**Directories:**

- Feature directories: kebab-case (e.g., `outreach-scheduler`, `payment-handler`)
- Grouped pages: parentheses for layout groups in Next.js (e.g., `(auth)`, `(dashboard)`)
- Test directories: `__tests__` (double underscore prefix for visibility)

**TypeScript Types:**

- Interfaces: PascalCase (e.g., `OnboardingSession`, `ClientService`)
- Enums: PascalCase (e.g., `ServiceStatus`, `ChannelType`)
- Type unions: Kebab-case as string literals (e.g., `"sms" | "email" | "voice_call"`)

## Where to Add New Code

**New Feature (e.g., add a service automation):**

- Primary code: `packages/shared/src/automations/[feature-name].ts`
- Export: Add to `packages/shared/src/automations/index.ts`
- Types: Add to `packages/shared/src/types/index.ts` if new types needed
- Tests: `packages/shared/src/automations/__tests__/[feature-name].test.ts`
- Usage: Call from API route in `apps/admin/src/app/api/`

**New API Endpoint:**

- Route handler: `apps/admin/src/app/api/[resource]/[action]/route.ts`
- Auth check: Use middleware (already validates auth) or check in route handler
- Supabase client: Import from `@/lib/supabase-server` (Next.js path alias)
- Response: Return NextResponse.json with 200/400/500 status

**New Communication Channel (e.g., WhatsApp):**

- Integration: `packages/shared/src/comms/whatsapp.ts`
- Export: Add to `packages/shared/src/comms/index.ts`
- Webhook: Create `apps/admin/src/app/api/webhooks/whatsapp/route.ts`
- Channel type: Add to `ChannelType` union in `packages/shared/src/types/index.ts`

**New Admin Dashboard Page:**

- Route: `apps/admin/src/app/(dashboard)/[feature]/page.tsx`
- Layout context: Inherits from `apps/admin/src/app/(dashboard)/layout.tsx`
- Auth: Middleware already enforces auth
- Supabase: Import `createSupabaseServerClient` from `@/lib/supabase-server`

**Shared Utilities:**

- Location: `packages/shared/src/utils/[utility-name].ts`
- Export: Add to `packages/shared/src/utils/index.ts`
- Tests: `packages/shared/src/utils/__tests__/[utility-name].test.ts`
- Reuse: Import across apps and packages

**New Test:**

- Convention: Place `__tests__` in same directory as source file
- Runner: Vitest (configured in root `vitest.config.ts`)
- Command: `pnpm test` runs all, `pnpm test:watch` for dev mode
- Path aliases: Same as source (e.g., `@leadrwizard/shared`)

## Special Directories

**supabase/migrations/:**
- Purpose: Database schema evolution
- Generated: Manual SQL files
- Committed: Yes, all migrations in version control
- Pattern: Timestamp-prefixed filenames; cumulative (never modify old migrations)

**.planning/codebase/:**
- Purpose: Generated architecture documentation
- Generated: Yes, by GSD tooling
- Committed: Yes, helps onboarding
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, STACK.md, INTEGRATIONS.md, CONCERNS.md

**.next/, dist/, node_modules/:**
- Purpose: Build outputs and dependencies
- Generated: Yes, via `pnpm install` and `turbo build`
- Committed: No, in .gitignore

**apps/admin/.next/, apps/widget/dist/:**
- Purpose: Built Next.js and Vite outputs
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-03-13*
