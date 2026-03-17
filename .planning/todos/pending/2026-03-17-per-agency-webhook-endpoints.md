---
created: 2026-03-17T14:38:16.371Z
title: Per-agency webhook endpoints
area: api
files:
  - apps/admin/src/app/api/webhooks/payment/route.ts
  - apps/admin/src/app/(dashboard)/settings/page.tsx
  - apps/admin/src/app/(dashboard)/settings/credentials-form.tsx
  - packages/shared/src/billing/stripe-adapter.ts
---

## Problem

The current payment webhook is a single static endpoint (`/api/webhooks/payment`) that requires the agency to include `org_id` in the payload. This is naive — every agency should get their own webhook URL with org_id auto-resolved, and the payload should be as minimal as possible.

Current issues:
- Agency must know and include their `org_id` in every payload
- Single shared endpoint, no per-org isolation
- No webhook secret management UI in Settings
- `payment_ref` is required but could be auto-generated
- `package_id` is required even if the agency only has one package

## Solution

1. **Per-agency webhook URL:** `/api/webhooks/payment/{org_slug}` — org_id resolved from slug, not payload
2. **Per-org webhook secret:** auto-generated on org creation, stored encrypted in organizations table, visible in Settings with copy + regenerate buttons
3. **Minimal payload:** only `name`, `email`, `phone`, `business_name` required. `package_id` optional (defaults to only package if one exists). `payment_ref` auto-generated if missing.
4. **Settings page webhook section:** shows the agency's unique endpoint URL, webhook secret (masked with copy button), regenerate secret button, test button to send a dummy payload, and inline payload documentation
5. Keep backward compatibility with the existing `/api/webhooks/payment` endpoint for any current integrations
