---
phase: 02-self-service-signup
plan: "02"
status: complete
started: 2026-03-14T00:48:20+05:00
completed: 2026-03-14T00:51:24+05:00
duration: 3 min
tasks_completed: 2
tasks_total: 2
subsystem: billing/signup
tags: [stripe, checkout, signup, webhook, org-provisioning]
dependency_graph:
  requires: [02-01-provision_org]
  provides: [signup-checkout-endpoint, new-org-webhook-handler]
  affects: [stripe-adapter, middleware, billing-barrel]
tech_stack:
  added: []
  patterns: [metadata-based-webhook-branching, atomic-org-provisioning, supabase-auth-invite]
key_files:
  created:
    - apps/admin/src/app/api/signup/checkout/route.ts
  modified:
    - packages/shared/src/billing/stripe-adapter.ts
    - packages/shared/src/billing/index.ts
    - apps/admin/src/middleware.ts
key_decisions:
  - "Branch checkout.session.completed on metadata.signup flag rather than absence of org_id"
  - "handleNewOrgSignup creates org before user (recoverable failure mode)"
  - "Idempotent on duplicate webhooks via provision_org result.idempotent flag"
  - "constructEvent added to billing barrel export for consistency"
requirements:
  - SIGN-01
  - SIGN-02
  - SIGN-04
---

# Phase 2 Plan 02: Signup Checkout + Webhook Handler Summary

Public checkout endpoint for new agency signup, plus webhook handler that provisions orgs and invites admins on checkout completion.

## What was done

- **createSignupCheckoutSession** added to stripe-adapter.ts: creates Stripe Checkout sessions with metadata.signup="true", org_name, admin_email, plan_slug. No existing org or auth required.
- **POST /api/signup/checkout** route created: accepts { planSlug, email, orgName }, validates input, calls createSignupCheckoutSession, returns { checkoutUrl }. Includes JSDoc with Stripe CLI testing instructions (SIGN-04).
- **handleNewOrgSignup** function added: calls provision_org RPC for atomic org+subscription creation, invites admin via supabase.auth.admin.inviteUserByEmail with org metadata, creates org_members record with owner role. Returns early on idempotent (duplicate webhook) events.
- **processStripeWebhook checkout.session.completed** case now branches: metadata.signup="true" routes to handleNewOrgSignup, existing org_id metadata routes to the original upgrade flow (preserved unchanged).
- **Billing barrel export** updated: added createSignupCheckoutSession and constructEvent exports.
- **Middleware** updated: /api/signup/* and /signup/* paths excluded from auth redirect.

## Files changed

| File | Change |
|------|--------|
| `apps/admin/src/app/api/signup/checkout/route.ts` | Created: public checkout endpoint |
| `packages/shared/src/billing/stripe-adapter.ts` | Added createSignupCheckoutSession, handleNewOrgSignup, modified checkout.session.completed branching |
| `packages/shared/src/billing/index.ts` | Added createSignupCheckoutSession and constructEvent to barrel exports |
| `apps/admin/src/middleware.ts` | Added /api/signup and /signup path exclusions |

## Decisions made

1. **Branch on metadata.signup flag**: The webhook handler checks `metadata.signup === "true"` to distinguish new signups from existing org upgrades. This is more explicit than checking for absence of org_id.
2. **Org before user**: handleNewOrgSignup creates the org first via provision_org, then invites the user. If user invite fails, we have an org without a user (recoverable via webhook retry) rather than a user without an org (confusing).
3. **Idempotent via provision_org**: The provision_org RPC returns `{ idempotent: true }` on duplicate stripe_customer_id. When this happens, handleNewOrgSignup skips user creation entirely.
4. **constructEvent in barrel**: Was exported from stripe-adapter.ts but missing from the barrel file. Added for consistency (used by webhook route).

## Deviations from Plan

None - plan executed exactly as written.

## Verification

```
signup route: OK
createSignupCheckoutSession export: OK
metadata.signup branch: OK
provision_org RPC call: OK
inviteUserByEmail call: OK
org_members insert: OK
middleware signup exclusions: OK
shared TypeScript: PASS (zero errors)
admin TypeScript: pre-existing errors only (missing node_modules, not caused by this plan)
```

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 48438d6 | feat(02-02): add public signup checkout endpoint and createSignupCheckoutSession |
| 2 | f1e0a88 | feat(02-02): add handleNewOrgSignup and webhook branching for new signups |
