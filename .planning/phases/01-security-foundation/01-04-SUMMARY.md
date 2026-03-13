---
phase: 01-security-foundation
plan: "04"
subsystem: automations
tags: [typescript, supabase, rpc, atomic, idempotency, payment, provisioning]

# Dependency graph
requires:
  - 01-01 (provision_client plpgsql function defined in migration 00005)
provides:
  - Atomic payment handler via supabase.rpc('provision_client')
  - Idempotent duplicate webhook handling in payment-handler.ts
affects:
  - Any caller of handlePaymentWebhook() — return type unchanged, behavior is now atomic

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "supabase.rpc() for cross-table ACID operations instead of sequential inserts"
    - "Idempotent return: check provisionResult.idempotent before proceeding"
    - "Fetch-after-rpc pattern: fetch created records by ID for downstream use"
    - "External API calls (GHL, outreach queue) remain outside DB transaction by design"

key-files:
  created: []
  modified:
    - packages/shared/src/automations/payment-handler.ts

key-decisions:
  - "Fetch-after-rpc pattern chosen over returning full rows from plpgsql — simpler SQL, TypeScript types already defined for client/package/session"
  - "GHL provisioning and outreach queue remain outside the rpc() call — external API calls cannot participate in DB transactions, this is correct by design"
  - "Idempotent case returns early with existing records — no duplicate GHL provisioning or outreach queuing on replay"

patterns-established:
  - "Pattern: rpc() + fetch-after for atomic DB operations that need typed results"

requirements-completed: [ORG-03]

# Metrics
duration: 3min
completed: 2026-03-14
---

# Phase 01 Plan 04: Atomic Payment Handler via provision_client RPC Summary

**Replaced 7 sequential database inserts in payment-handler.ts with a single supabase.rpc('provision_client') call, making client provisioning ACID-atomic and idempotent against duplicate payment webhooks.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-13T19:07:49Z
- **Completed:** 2026-03-13T19:10:37Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Removed 7 sequential async inserts (clients, client_packages, client_services, onboarding_sessions) that had no transactional boundary
- Replaced with single `supabase.rpc('provision_client', {...})` call wrapping all 4 inserts in one plpgsql ACID transaction
- Added idempotency handling: when `provisionResult.idempotent === true`, fetches and returns existing records without duplicate inserts
- Added fetch-after-rpc pattern: fetches client/package/session/services by ID from RPC result for downstream use
- GHL provisioning (provisionSubAccount, deploySnapshot) and outreach queue insert remain unchanged and outside the transaction
- TypeScript type check passes with 0 errors
- Function signature `handlePaymentWebhook(supabase, orgId, payload)` and return type `OnboardingInitResult` unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace sequential inserts with provision_client rpc()** - `f4bf3e3` (feat)

## Files Created/Modified

- `packages/shared/src/automations/payment-handler.ts` - Atomic provisioning via supabase.rpc('provision_client'), idempotent duplicate handling, fetch-after-rpc pattern

## Decisions Made

- Fetch-after-rpc pattern: plpgsql returns IDs, TypeScript fetches full rows. Keeps SQL simple, uses existing TypeScript types.
- GHL provisioning and outreach queue correctly remain outside the transaction. External API calls cannot be rolled back, so they belong after the atomic DB commit.
- Idempotent early return: duplicate payment webhooks return existing records without touching GHL or outreach queue again.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

Run `supabase db push` before testing locally. Migration 00005 (provision_client function) must be deployed or rpc() will fail with "function not found".

## Next Phase Readiness

- ORG-03 requirement fully satisfied: payment failure during provisioning leaves no orphaned rows
- All Phase 1 plans complete: security foundation is done
- Phase 2 can proceed

---
*Phase: 01-security-foundation*
*Completed: 2026-03-14*
