---
phase: 02-self-service-signup
verified: 2026-03-14T20:00:00+05:00
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 2: Self-Service Signup Verification Report

**Phase Goal:** An agency can go from paying on Stripe to having a provisioned org with admin access and an actionable empty state, without any manual intervention.
**Verified:** 2026-03-14T20:00:00+05:00
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Completing a Stripe checkout session creates an org record, membership, and subscription in the database within the same webhook handler execution | VERIFIED | `handleNewOrgSignup` in stripe-adapter.ts (line 243) calls `provision_org` RPC (creates org + org_subscription atomically), then `inviteUserByEmail` (creates auth user), then inserts `org_members` with owner role. All within the single `processStripeWebhook` call triggered by `checkout.session.completed`. Webhook route at `/api/webhooks/stripe/route.ts` calls `processStripeWebhook(supabase, event)` on line 69. |
| 2 | The new org admin receives a welcome email containing a working link to set their password and access the dashboard | VERIFIED | `handleNewOrgSignup` calls `supabase.auth.admin.inviteUserByEmail(adminEmail, { data: { org_id, role, org_name }, redirectTo: appUrl/callback })` on line 291. Supabase handles email delivery. redirectTo points to `/callback` which exchanges auth code for session. |
| 3 | After logging in for the first time, the admin sees an empty-state setup wizard with clear steps: add services, configure package, set up integrations | VERIFIED | Dashboard page.tsx queries `service_definitions` count, `service_packages` count, and `onboarding_completed` flag (lines 39-71). When org has no services/packages and onboarding not complete, `showWizard=true`. SetupWizard component (112 lines) renders three steps with links to /services, /packages, /settings. |
| 4 | A developer running locally can trigger the checkout.session.completed webhook via Stripe CLI and see the full provisioning flow execute against the dev database | VERIFIED | Signup checkout route includes JSDoc with Stripe CLI instructions (lines 13-19). Webhook route at `/api/webhooks/stripe` accepts POST with stripe-signature, verifies via `constructEvent`, processes via `processStripeWebhook`. The metadata.signup="true" branching correctly routes to handleNewOrgSignup. No hardcoded URLs block local testing. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/00006_provision_org.sql` | provision_org plpgsql function | VERIFIED | 72 lines. Security definer, 5 params, returns jsonb with org_id + idempotent flag, validates plan, handles slug collision, creates org + org_subscription atomically. |
| `apps/admin/src/app/api/signup/checkout/route.ts` | Public checkout endpoint | VERIFIED | 65 lines. Exports POST handler, validates input, calls createSignupCheckoutSession, returns checkoutUrl. No auth required. |
| `packages/shared/src/billing/stripe-adapter.ts` | Extended with handleNewOrgSignup + createSignupCheckoutSession | VERIFIED | 511 lines. createSignupCheckoutSession (line 154) sets metadata.signup="true". handleNewOrgSignup (line 243) calls provision_org RPC, inviteUserByEmail, inserts org_members. processStripeWebhook (line 319) branches on metadata.signup. |
| `packages/shared/src/billing/index.ts` | Barrel with new exports | VERIFIED | Exports createSignupCheckoutSession and constructEvent alongside existing exports. |
| `apps/admin/src/middleware.ts` | Updated with signup path exclusions | VERIFIED | Lines 39-40 exclude `/api/signup` and `/signup` from auth redirect. |
| `apps/admin/src/app/(dashboard)/dashboard/setup-wizard.tsx` | SetupWizard client component with 3 steps | VERIFIED | 112 lines (exceeds min_lines: 40). Three steps with correct hrefs: /services, /packages, /settings. Shows completed state with green checkmark. Renders step count. |
| `apps/admin/src/app/(dashboard)/dashboard/page.tsx` | Dashboard with empty-state detection | VERIFIED | Imports SetupWizard (line 2), queries service_definitions/service_packages counts, conditionally renders wizard above KPI cards (line 177). |
| `apps/admin/src/app/(auth)/signup/success/page.tsx` | Post-checkout success page | VERIFIED | 46 lines (exceeds min_lines: 15). Shows "check your email" message, 3 next steps, spam folder note, 24h expiry warning. No auth required (under /signup path excluded by middleware). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| signup/checkout/route.ts | stripe-adapter.ts | `import { createSignupCheckoutSession }` | WIRED | Imported on line 3, called on line 48 |
| stripe-adapter.ts | 00006_provision_org.sql | `supabase.rpc("provision_org", {...})` | WIRED | Called on line 261 with all 5 required params |
| stripe-adapter.ts | supabase auth | `supabase.auth.admin.inviteUserByEmail` | WIRED | Called on line 291 with adminEmail, org data, and redirectTo |
| stripe-adapter.ts | org_members table | `supabase.from("org_members").insert(...)` | WIRED | Called on line 305 with org_id, user_id, role: "owner" |
| webhooks/stripe/route.ts | stripe-adapter.ts | `import { processStripeWebhook }` | WIRED | Imported on line 6, called on line 69 |
| dashboard/page.tsx | setup-wizard.tsx | `import { SetupWizard }` | WIRED | Imported on line 2, rendered conditionally on line 179 |
| dashboard/page.tsx | shared/tenant | `import { getUserOrg }` | WIRED | Imported on line 3, called on line 35 |
| dashboard/page.tsx | service_definitions/service_packages | Supabase queries for counts | WIRED | Queried on lines 44-53, results used for showWizard logic |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SIGN-01 | 02-01, 02-02 | Agency completes Stripe checkout and org is auto-provisioned | SATISFIED | provision_org creates org + subscription atomically. handleNewOrgSignup calls it, then creates user + membership. |
| SIGN-02 | 02-02 | New org admin receives welcome email with link to set password | SATISFIED | inviteUserByEmail sends Supabase invite email with redirectTo /callback for password setup. |
| SIGN-03 | 02-03 | New org dashboard shows empty state with setup wizard | SATISFIED | SetupWizard renders three steps (services, packages, integrations) when org has no content. |
| SIGN-04 | 02-02 | Stripe CLI configured for local webhook testing | SATISFIED | Webhook endpoint accepts signed events, checkout route includes CLI testing instructions in JSDoc, no barriers to local Stripe CLI forwarding. |

No orphaned requirements found. All 4 SIGN requirements are claimed by plans and satisfied.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No anti-patterns detected across any phase files |

Zero TODO/FIXME/PLACEHOLDER/stub patterns found in any artifact.

### Human Verification Required

### 1. Stripe Checkout Flow End-to-End

**Test:** Run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` then POST to `/api/signup/checkout` with valid planSlug/email/orgName, complete Stripe Checkout, verify org + membership + subscription appear in database.
**Expected:** Org record, org_subscription, org_member (owner), and auth user all created. User receives invite email.
**Why human:** Requires running Stripe CLI, a real/test Stripe account, and a running Supabase instance to verify the full provisioning chain.

### 2. Invite Email and Password Setup

**Test:** Click the invite link in the welcome email, set a password, confirm redirect to dashboard.
**Expected:** User lands on /callback, session is established, redirected to dashboard showing the SetupWizard.
**Why human:** Email delivery, link clicking, and password form interaction cannot be tested programmatically in this context.

### 3. Setup Wizard Visual Appearance

**Test:** Log in as a new org admin with no services/packages. Verify the wizard renders above KPI cards with three clear steps.
**Expected:** Dashed border container with "Welcome to LeadrWizard, {orgName}!", three clickable steps linking to /services, /packages, /settings. Step counter shows "0 of 3 steps completed."
**Why human:** Visual rendering, styling, and interactive behavior need browser verification.

### 4. Wizard Disappearance After Setup

**Test:** Add at least one service definition and one service package to the org, then reload dashboard.
**Expected:** SetupWizard no longer renders. Only KPI cards and normal dashboard content visible.
**Why human:** Requires database state changes and page reload to verify conditional rendering logic.

### Gaps Summary

No gaps found. All 4 observable truths are verified with supporting artifacts at all three levels (exists, substantive, wired). All 4 SIGN requirements are satisfied. No anti-patterns or stub implementations detected. The codebase contains the complete self-service signup flow from Stripe Checkout through webhook provisioning to the empty-state dashboard with setup wizard.

The only items requiring human verification are the end-to-end runtime behaviors: actual Stripe webhook delivery, email receipt, password setup flow, and visual rendering of the setup wizard.

---

_Verified: 2026-03-14T20:00:00+05:00_
_Verifier: Claude (gsd-verifier)_
