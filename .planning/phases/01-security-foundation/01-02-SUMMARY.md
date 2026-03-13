---
phase: 01-security-foundation
plan: "02"
subsystem: payments
tags: [stripe, stripe-sdk, webhooks, billing, typescript]

# Dependency graph
requires: []
provides:
  - Stripe SDK client via getStripeClient() in packages/shared
  - constructEvent(rawBody, sig, secret) exported from stripe-adapter.ts for webhook signature verification
  - SDK-based checkout, customer, and billing portal calls replacing raw fetch
affects:
  - 01-03 (webhook route — imports constructEvent)
  - any future billing features

# Tech tracking
tech-stack:
  added:
    - stripe@20.4.1 (exact pin, no caret)
  patterns:
    - Stripe SDK client instantiated per-call via getStripeClient() helper (lazy, avoids module-load errors when env var missing)
    - constructEvent exported as thin wrapper — throws original Stripe error for caller to handle as 400
    - Webhook event types cast to specific Stripe.* types (Stripe.Subscription, Stripe.Invoice, etc.)

key-files:
  created: []
  modified:
    - packages/shared/package.json
    - packages/shared/src/billing/stripe-adapter.ts

key-decisions:
  - "Pinned stripe to exact version 20.4.1 (no ^ caret) — security-critical dependency, no surprise upgrades"
  - "Used Stripe API version 2026-02-25.clover (latest stable) instead of plan's example 2025-01-27.acacia"
  - "current_period_start/end read from subscription.items.data[0] — Stripe v20 moved these fields off Subscription to SubscriptionItem"
  - "invoice.subscription accessed via invoice.parent.subscription_details.subscription — Stripe v20 API change"
  - "constructEvent validates secret presence at call time, not module load time — avoids boot failures"

patterns-established:
  - "Stripe SDK: instantiate per-call via getStripeClient(), never at module level"
  - "Stripe types: cast event.data.object to specific Stripe.* type per event case"

requirements-completed: [SEC-01]

# Metrics
duration: 9min
completed: 2026-03-14
---

# Phase 1 Plan 02: Stripe SDK Integration Summary

**Stripe SDK 20.4.1 installed in packages/shared, stripe-adapter.ts fully migrated from raw fetch to SDK with constructEvent exported for webhook signature verification**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-03-13T18:52:09Z
- **Completed:** 2026-03-14T18:59:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- stripe@20.4.1 installed in packages/shared with exact version pin (no `^`)
- All raw `stripeRequest()` fetch calls replaced with Stripe SDK methods
- `constructEvent(rawBody, sig, secret)` exported — ready for Plan 03 webhook route
- TypeScript type-check passes with 0 errors against Stripe v20 types

## Task Commits

Each task was committed atomically:

1. **Task 1: Install stripe SDK in packages/shared** - `60e5b4c` (chore)
2. **Task 2: Refactor stripe-adapter.ts to use Stripe SDK** - `1d41b28` (feat)

**Plan metadata:** (docs commit pending)

## Files Created/Modified
- `packages/shared/package.json` - Added stripe 20.4.1 dependency (exact pin)
- `pnpm-lock.yaml` - Updated with resolved stripe package tree
- `packages/shared/src/billing/stripe-adapter.ts` - Full SDK migration: removed stripeRequest helper, added constructEvent export, Stripe.* typed webhook handlers

## Decisions Made
- Pinned stripe to exact `20.4.1` with no `^` caret as specified for security-critical dependencies
- Used latest Stripe API version `2026-02-25.clover` (SDK's `ApiVersion` constant) rather than the plan's example `2025-01-27.acacia`
- `getStripeClient()` creates a new instance per-call rather than a module-level singleton, avoiding crashes if `STRIPE_SECRET_KEY` is missing at import time
- `constructEvent` validates the `secret` argument at call time and throws `Error("STRIPE_WEBHOOK_SECRET is not set")` if empty

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Adapted to Stripe SDK v20 breaking API changes**
- **Found during:** Task 2 (Refactor stripe-adapter.ts)
- **Issue:** TypeScript errors on `subscription.current_period_start`, `subscription.current_period_end`, and `invoice.subscription` — all three removed from their parent types in Stripe v20
- **Fix:** `current_period_start/end` read from `subscription.items.data[0]` (moved to SubscriptionItem in v20). `invoice.subscription` accessed via `invoice.parent?.subscription_details?.subscription` (new parent-based invoice model)
- **Files modified:** packages/shared/src/billing/stripe-adapter.ts
- **Verification:** `pnpm --filter @leadrwizard/shared type-check` exits 0
- **Committed in:** `1d41b28` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug, Stripe v20 API change)
**Impact on plan:** Fix necessary for TypeScript correctness and runtime correctness against the installed SDK version. No scope creep.

## Issues Encountered
- `pnpm` not on PATH — invoked via `npx pnpm` (corepack symlink was broken). No functional impact.
- Stripe SDK v20 removed `current_period_start/end` from `Subscription` type and changed how invoice's subscription is referenced. Both fixed inline during Task 2.

## User Setup Required
None - no external service configuration required. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` env vars are expected to be pre-configured (they were referenced by the old adapter too).

## Next Phase Readiness
- `constructEvent` is exported and ready for Plan 03 to import in the webhook route handler
- All existing checkout/portal/customer function signatures unchanged — callers unaffected
- No blockers

## Self-Check: PASSED

- packages/shared/package.json: FOUND
- packages/shared/src/billing/stripe-adapter.ts: FOUND
- .planning/phases/01-security-foundation/01-02-SUMMARY.md: FOUND
- Task 1 commit 60e5b4c: FOUND
- Task 2 commit 1d41b28: FOUND

---
*Phase: 01-security-foundation*
*Completed: 2026-03-14*
