---
phase: 02-self-service-signup
plan: "01"
subsystem: database
tags: [plpgsql, postgres, stripe, provisioning, idempotency]

# Dependency graph
requires:
  - phase: 01-security-foundation
    provides: "provision_client pattern (00005), billing tables (00003), RLS hardening"
provides:
  - "provision_org plpgsql function for atomic org + subscription creation"
  - "Idempotent org provisioning keyed on stripe_customer_id"
affects: [02-self-service-signup, stripe-webhook-handler]

# Tech tracking
tech-stack:
  added: []
  patterns: [security-definer-rpc, idempotent-provisioning, slug-collision-handling]

key-files:
  created:
    - supabase/migrations/00006_provision_org.sql
  modified: []

key-decisions:
  - "Follows provision_client pattern from 00005 for consistency"
  - "Idempotent on stripe_customer_id to handle webhook retries safely"
  - "30-day hardcoded initial period, updated by customer.subscription.updated event"
  - "Slug collision appends random 6-char suffix; empty slugs get generated fallback"

patterns-established:
  - "provision_* security definer functions for atomic multi-table inserts via rpc()"

requirements-completed: [SIGN-01]

# Metrics
duration: 1min
completed: 2026-03-14
---

# Phase 2 Plan 01: Provision Org Migration Summary

**Atomic provision_org plpgsql function for self-service signup with idempotency on stripe_customer_id and slug collision handling**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-13T19:44:41Z
- **Completed:** 2026-03-13T19:45:47Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Created provision_org security definer function that atomically creates organization + org_subscription in a single transaction
- Idempotency check on stripe_customer_id prevents duplicate orgs from Stripe webhook retries
- Plan validation raises exception on invalid/inactive plan_slug, causing Stripe to retry
- Slug generation sanitizes org name to URL-safe format with collision handling

## Task Commits

Each task was committed atomically:

1. **Task 1: Create provision_org migration (00006)** - `8e8198d` (feat)

## Files Created/Modified
- `supabase/migrations/00006_provision_org.sql` - Atomic org provisioning plpgsql function (security definer, idempotent, validates plan, handles slug collisions)

## Decisions Made
- Followed provision_client (00005) pattern exactly for consistency across provisioning functions
- security definer bypasses RLS since webhook handler calls via service role client
- Idempotent on stripe_customer_id so duplicate checkout.session.completed events are harmless
- Plan validation raises exception (causes 500 -> Stripe retry) rather than silently creating an org without a valid subscription
- 30-day hardcoded initial period since customer.subscription.updated webhook will sync the real period shortly after checkout
- Slug collision handling appends random 6-char hex suffix; all-special-char org names get a generated "org-{hash}" fallback

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- provision_org function is ready to be called via `supabase.rpc('provision_org', {...})` from the Stripe webhook handler (Plan 02-02)
- Function follows the same pattern as provision_client, so the webhook handler implementation can follow the same fetch-after-rpc pattern established in Phase 1

---
*Phase: 02-self-service-signup*
*Completed: 2026-03-14*
