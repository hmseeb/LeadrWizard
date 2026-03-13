# Technology Stack

**Analysis Date:** 2025-03-13

## Languages

**Primary:**
- TypeScript 5.7.0 - Used across all apps and packages
- JavaScript/JSX - React components, build configs

**Secondary:**
- SQL - Supabase migrations and seed data
- XML - TwiML responses for Twilio

## Runtime

**Environment:**
- Node.js (no specific version pinned, inferred from Next.js 15 support)

**Package Manager:**
- pnpm 10.29.3 (enforced via `packageManager` field)
- Lockfile: pnpm-lock.yaml (inferred)

## Frameworks

**Core:**
- Next.js 15.1.0 - Admin dashboard (`apps/admin`)
- React 19.0.0 - UI framework (admin and widget)
- React DOM 19.0.0 - DOM rendering
- Vite 6.0.0 - Widget bundler (`apps/widget`)

**Styling:**
- Tailwind CSS 3.4.0 - Utility-first CSS
- PostCSS 8.4.0 - CSS transformation
- Autoprefixer 10.4.0 - Browser prefixes

**UI Components:**
- Lucide React 0.468.0 - Icon library (admin only)

**Build & Dev:**
- Turbo 2.4.0 - Monorepo orchestration (root)
- TypeScript 5.7.0 - Type checking (all packages)
- Vitest 4.1.0 - Unit test runner
- @vitest/coverage-v8 4.1.0 - Coverage reporting

**Build Plugins:**
- @vitejs/plugin-react 4.3.0 - React Fast Refresh
- vite-plugin-css-injected-by-js 3.5.0 - CSS injection for widget

## Key Dependencies

**Critical:**
- @supabase/supabase-js 2.49.0 - Supabase client (all apps/shared)
- @supabase/ssr 0.5.0 - Server-side rendering support (admin only)

**Infrastructure:**
- Monorepo structure with workspaces:
  - `@leadrwizard/admin` - Dashboard app
  - `@leadrwizard/widget` - Embeddable widget
  - `@leadrwizard/shared` - Shared types, utilities, integrations
  - `@leadrwizard/tsconfig` - Shared TypeScript config
  - `@leadrwizard/eslint-config` - Shared ESLint rules

## Configuration

**Build Outputs:**
- Admin: `.next/` (Next.js build)
- Widget: `dist/widget.js` (single IIFE bundle with CSS injected)
- Shared: Type definitions compiled to TypeScript

**Package Manager Config:**
- `pnpm.onlyBuiltDependencies` - Ensures native builds (esbuild, sharp)

**Next.js Config (`apps/admin/next.config.ts`):**
- `transpilePackages: ["@leadrwizard/shared"]` - Transpiles shared package for Next.js

**Vite Config (`apps/widget/vite.config.ts`):**
- Entry: `src/main.tsx`
- Output: Single IIFE named "LeadrWizard"
- CSS: Injected into JS, code split disabled
- Minifier: esbuild

## Scripts

**Root monorepo:**
```bash
pnpm dev          # Run all apps in dev mode (Turbo)
pnpm build        # Build all apps (Turbo dependency graph)
pnpm lint         # Lint all packages
pnpm type-check   # TypeScript check all packages
pnpm test         # Run Vitest suite once
pnpm test:watch   # Run Vitest in watch mode
pnpm clean        # Clean build artifacts
```

**Admin app:**
```bash
pnpm dev          # Next.js dev server on port 3000
pnpm build        # Next.js production build
pnpm start        # Run production server
pnpm lint         # Next.js linter
pnpm type-check   # TypeScript check
```

**Widget app:**
```bash
pnpm dev          # Vite dev server
pnpm build        # Vite production build to dist/widget.js
pnpm preview      # Preview production build
pnpm type-check   # TypeScript check
```

## Database

**Provider:** Supabase (PostgreSQL)

**Client Setup:**
- Browser clients: Anon key (RLS enforced)
- Server clients: Service role key (RLS bypassed)
- Clients created in `packages/shared/src/supabase/client.ts`

**Migrations:**
- Location: `supabase/migrations/`
- Files:
  - `00001_initial_schema.sql` - Core tables
  - `00002_pg_cron_jobs.sql` - PostgreSQL Cron
  - `00003_billing_and_tenancy.sql` - Org/billing tables
  - `seed.sql` - Test data

## Platform Requirements

**Development:**
- Node.js with pnpm
- Environment variables (see `.env.example`)

**Production:**
- Vercel (for admin dashboard - Next.js)
- Supabase Postgres hosting
- Static hosting capability for widget (IIFE bundle)

---

*Stack analysis: 2025-03-13*
