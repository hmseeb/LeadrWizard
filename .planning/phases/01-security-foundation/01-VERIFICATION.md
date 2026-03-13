---
phase: 01-security-foundation
verified: 2026-03-14T12:00:00Z
status: passed
score: 14/14 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Send a real Stripe test event with an invalid signature"
    expected: "Route returns 400 with 'Webhook signature verification failed' message"
    why_human: "constructEvent logic is verified in code but actual Stripe SDK signature rejection requires a live HTTP request with real header values"
  - test: "Send a duplicate Stripe event.id twice to /api/webhooks/stripe"
    expected: "Both return 200, processStripeWebhook is only called once"
    why_human: "Idempotency insert-before-process sequencing cannot be confirmed without runtime execution"
  - test: "Send payment webhook with body.org_id set to an arbitrary org UUID (no API key)"
    expected: "Returns 401, org resolution does not use body value"
    why_human: "Confirms exploit closure end-to-end; grep confirms the code is gone but runtime behavior validates it"
---

# Phase 01: Security Foundation Verification Report

**Phase Goal:** Three active exploits in deployed code are closed and all public webhook entry points are hardened against forgery, replay, and unauthorized org resolution
**Verified:** 2026-03-14T12:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Stripe webhooks verify signature before any processing | VERIFIED | `constructEvent(body, sig, webhookSecret)` at line 37 of stripe/route.ts; 400 returned on missing sig (line 22) and on verify failure (line 40) |
| 2 | Replay attacks blocked on Stripe webhook (idempotency on event.id) | VERIFIED | `processed_webhook_events` checked before processing (line 49); upsert with `ignoreDuplicates: true` BEFORE processStripeWebhook call |
| 3 | Replay attacks blocked on payment webhook (idempotency on payment_ref) | VERIFIED | `processed_webhook_events` check + upsert at lines 70-87 of payment/route.ts, before `handlePaymentWebhook` |
| 4 | body.org_id exploit is closed on payment webhook | VERIFIED | `resolveOrgId()` contains zero references to `body.org_id`; replaced with header-based x-internal-secret path |
| 5 | Anonymous RLS exploits (sessions_anon_insert, sessions_anon_update, responses_anon_insert) are removed | VERIFIED | All three `drop policy if exists` statements present in 00005_rls_hardening.sql lines 11-13 |
| 6 | Widget response submission routes through authenticated API, not direct anon inserts | VERIFIED | `useWizardSession.ts` submitResponse() uses `fetch()` to `${apiBaseUrl}/api/widget/response`; no `.insert()` on session_responses or interaction_log in widget hook |
| 7 | Payment provisioning is atomic (no orphaned records on partial failure) | VERIFIED | `handlePaymentWebhook` calls `supabase.rpc('provision_client')` wrapping client+package+services+session in a single plpgsql transaction |
| 8 | Duplicate payment event returns existing records without re-provisioning | VERIFIED | `provisionResult.idempotent === true` branch fetches and returns existing records without any re-insert |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Provides | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/00004_webhook_idempotency.sql` | processed_webhook_events table | VERIFIED | Table definition with id text PK, source text NOT NULL, processed_at timestamptz, payload jsonb; index on processed_at |
| `supabase/migrations/00005_rls_hardening.sql` | RLS drops + scoped replacements + provision_client function | VERIFIED | 4 drop policies, 2 scoped replacement policies, full provision_client plpgsql security definer function |
| `packages/shared/package.json` | stripe dependency | VERIFIED | `"stripe": "20.4.1"` — exact pin, no caret |
| `packages/shared/src/billing/stripe-adapter.ts` | Stripe SDK client + constructEvent wrapper | VERIFIED | Imports Stripe from 'stripe'; exports constructEvent(); no stripeRequest() helper remains; all billing functions use SDK methods |
| `apps/admin/src/app/api/webhooks/stripe/route.ts` | Verified Stripe webhook handler with idempotency | VERIFIED | constructEvent called, 400 on missing/invalid sig, idempotency check+upsert before processStripeWebhook |
| `apps/admin/src/app/api/webhooks/payment/route.ts` | Payment webhook without body.org_id fallback | VERIFIED | resolveOrgId() uses only Authorization Bearer, X-API-Key, or x-internal-secret headers |
| `packages/shared/src/automations/payment-handler.ts` | Atomic payment handler via provision_client rpc | VERIFIED | supabase.rpc('provision_client') with all 8 parameters; sequential direct inserts for client/package/services/session removed |
| `apps/admin/src/app/api/widget/response/route.ts` | Authenticated server-side response route with CORS | VERIFIED | OPTIONS handler (204), POST handler with createServerClient(), session validation before insert, CORS headers on all responses |
| `apps/widget/src/hooks/useWizardSession.ts` | Widget hook with fetch-based write path | VERIFIED | submitResponse() uses fetch() to `${apiBaseUrl}/api/widget/response`; apiBaseUrl param present; no direct supabase write calls |
| `apps/widget/src/main.tsx` | LeadrWizardConfig with required apiBaseUrl field | VERIFIED | apiBaseUrl: string field in interface (line 9); passed to WizardWidget |
| `apps/widget/src/components/WizardWidget.tsx` | Props thread apiBaseUrl to useWizardSession | VERIFIED | WizardWidgetProps includes apiBaseUrl?; passed through to useWizardSession() call |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| stripe-adapter.ts | stripe/route.ts | `constructEvent` exported and imported | WIRED | `export function constructEvent` in adapter; `import { constructEvent } from "@leadrwizard/shared/billing"` in route |
| stripe/route.ts | 00004_webhook_idempotency.sql | queries processed_webhook_events | WIRED | `.from("processed_webhook_events")` at lines 50 and 62 of stripe/route.ts |
| payment/route.ts | 00004_webhook_idempotency.sql | checks processed_webhook_events on payment_ref | WIRED | `.from("processed_webhook_events")` at lines 72 and 82 of payment/route.ts |
| payment-handler.ts | 00005_rls_hardening.sql | calls provision_client via supabase.rpc() | WIRED | `supabase.rpc("provision_client", {...})` at line 44 of payment-handler.ts |
| useWizardSession.ts | widget/response/route.ts | fetch POST to `${apiBaseUrl}/api/widget/response` | WIRED | `fetch(`${baseUrl}/api/widget/response`, ...)` at line 205 of useWizardSession.ts |
| widget/response/route.ts | 00005_rls_hardening.sql | service role insert after anon policies removed | WIRED | `createServerClient()` at line 34 of widget/response/route.ts; anon insert policies confirmed dropped in 00005 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SEC-01 | 01-02, 01-03 | Stripe webhook verifies signature using stripe.webhooks.constructEvent() | SATISFIED | constructEvent() wrapper in stripe-adapter.ts; called in stripe/route.ts before any processing |
| SEC-02 | 01-01, 01-03 | Idempotency key checked against processed_webhook_events; duplicates skipped | SATISFIED | Table in 00004; checked+upserted in both stripe/route.ts and payment/route.ts |
| SEC-03 | 01-01 | Anonymous RLS policies removed and replaced with scoped server-side validation | SATISFIED | 4 drop policy statements + 2 scoped replacement policies in 00005_rls_hardening.sql |
| SEC-04 | 01-03 | Payment webhook body.org_id fallback removed | SATISFIED | resolveOrgId() contains no body.org_id reference; uses header-only org resolution |
| SEC-05 | 01-05 | Widget response submission through authenticated API route instead of direct anon inserts | SATISFIED | /api/widget/response route created; widget hook uses fetch() not direct Supabase inserts |
| ORG-03 | 01-01, 01-04 | Atomic transaction via plpgsql function prevents orphaned records on partial failure | SATISFIED | provision_client security definer function in 00005; called via supabase.rpc() in payment-handler.ts |

No orphaned requirements. All 6 Phase 1 requirements are covered by plans and verified in code.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| payment-handler.ts | 17 | `org_id?: string` in PaymentWebhookPayload interface | Info | Unused field in interface; not passed to provision_client and resolveOrgId() in the route handles org resolution before calling handlePaymentWebhook. No runtime impact. |

No blocker or warning anti-patterns found.

### Human Verification Required

### 1. Stripe Signature Rejection (Live Request)

**Test:** Send a POST to `/api/webhooks/stripe` with `stripe-signature: t=1234,v1=badhash` and any body
**Expected:** HTTP 400 with JSON `{ "error": "Webhook signature verification failed: ..." }`
**Why human:** The constructEvent code path is verified in source, but the actual Stripe SDK rejection behavior (constant-time comparison, timestamp tolerance) requires a real HTTP call to confirm the 400 surfaces correctly

### 2. Idempotency Under Concurrent Requests

**Test:** Send the same Stripe event.id to `/api/webhooks/stripe` twice simultaneously
**Expected:** Both return 200; processStripeWebhook called only once (verify via logs or DB row count in processed_webhook_events)
**Why human:** The upsert-before-process sequencing is correct in code but race condition protection under true concurrency requires runtime validation

### 3. body.org_id Exploit Closure

**Test:** Send POST to `/api/webhooks/payment` with body `{ "org_id": "<any-valid-org-uuid>", "customer_email": "test@test.com", "package_id": "..." }` and no Authorization/X-API-Key header
**Expected:** HTTP 401, org is not resolved from body
**Why human:** Confirms end-to-end exploit closure; grep confirms the code path is gone but runtime verifies nothing else exposes org_id body parsing

### Gaps Summary

No gaps. All 14 artifact-level checks pass across Levels 1 (exists), 2 (substantive), and 3 (wired). All 6 requirement IDs are satisfied with concrete code evidence. Three items flagged for human verification are behavioral/runtime checks that cannot be confirmed via static analysis alone, but the underlying code is fully implemented and correctly wired.

---

_Verified: 2026-03-14T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
