---
phase: "01"
plan: "03"
subsystem: webhook-security
tags: [security, webhooks, stripe, idempotency, hardening]
dependency_graph:
  requires: ["01-01", "01-02"]
  provides: ["SEC-01", "SEC-02", "SEC-04"]
  affects: ["apps/admin/src/app/api/webhooks/stripe/route.ts", "apps/admin/src/app/api/webhooks/payment/route.ts"]
tech_stack:
  added: []
  patterns: ["constructEvent signature verification", "upsert with ignoreDuplicates idempotency", "env-var-gated internal secret header"]
key_files:
  created: []
  modified:
    - apps/admin/src/app/api/webhooks/stripe/route.ts
    - apps/admin/src/app/api/webhooks/payment/route.ts
decisions:
  - "Return 200 on duplicate webhooks, not 4xx/5xx — Stripe retries on 5xx causing infinite loops"
  - "Upsert processed_webhook_events BEFORE processing to prevent race conditions under concurrent requests"
  - "Replace body.org_id fallback with x-internal-secret + x-org-id headers — body never trusted for org resolution"
  - "STRIPE_WEBHOOK_SECRET missing throws at verification time, not silently passes"
metrics:
  duration: "3 min"
  completed: "2026-03-14"
  tasks_completed: 2
  files_modified: 2
---

# Phase 1 Plan 03: Webhook Hardening Summary

**One-liner:** Stripe webhook verified via constructEvent() + replay protection via processed_webhook_events, payment webhook account-takeover exploit closed by removing body.org_id.

## What Was Done

### Task 1: Stripe webhook signature verification and idempotency (435e526)

Rewrote `apps/admin/src/app/api/webhooks/stripe/route.ts`. The route previously parsed events with `JSON.parse(body)` and ignored the `stripe-signature` header entirely.

Now:
- Returns 400 if `stripe-signature` header is missing
- Throws `Error` at verification time if `STRIPE_WEBHOOK_SECRET` is not set (fail loudly)
- Calls `constructEvent(body, sig, webhookSecret)` from `@leadrwizard/shared/billing` — catches `StripeSignatureVerificationError` and returns 400
- Checks `processed_webhook_events` for the `event.id` before processing
- On duplicate: returns 200 immediately, no processing
- On new event: upserts `{ id: event.id, source: "stripe" }` with `ignoreDuplicates: true` BEFORE calling `processStripeWebhook`
- Inner try/catch for `constructEvent` + outer try/catch for unexpected errors (500)

### Task 2: Payment webhook idempotency and body.org_id removal (7c87e3c)

Made two surgical changes to `apps/admin/src/app/api/webhooks/payment/route.ts`:

**SEC-04 — account takeover fix:** Removed `body.org_id` fallback from `resolveOrgId()`. The exploit allowed any caller to pass `{ org_id: "victim-org" }` in the request body and get authenticated as that org. Replaced with an `x-internal-secret` header check gated by `INTERNAL_WEBHOOK_SECRET` env var — testing capability preserved without the exploit.

**SEC-02 — replay protection:** Added idempotency check on `payment_ref` (or `body.id`) against `processed_webhook_events` before `handlePaymentWebhook` call. Duplicate payment returns 200 immediately without creating a second client.

## Verification Results

```
SEC-01: constructEvent present in stripe/route.ts         PASS
SEC-02: processed_webhook_events in stripe/route.ts       PASS
SEC-02: processed_webhook_events in payment/route.ts      PASS
SEC-04: body.org_id absent from payment/route.ts          PASS
```

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

Files exist:
- FOUND: apps/admin/src/app/api/webhooks/stripe/route.ts
- FOUND: apps/admin/src/app/api/webhooks/payment/route.ts

Commits exist:
- FOUND: 435e526 (Task 1 — Stripe webhook hardening)
- FOUND: 7c87e3c (Task 2 — payment webhook hardening)
