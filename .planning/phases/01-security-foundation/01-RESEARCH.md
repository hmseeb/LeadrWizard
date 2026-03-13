# Phase 1: Security Foundation - Research

**Researched:** 2026-03-13
**Domain:** Webhook security, Supabase RLS hardening, atomic DB provisioning, Next.js 15 App Router
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-01 | Stripe webhook endpoint verifies signature using `stripe.webhooks.constructEvent()` before processing any event | Stripe SDK must be installed — not currently present. Raw `fetch` in `stripe-adapter.ts` cannot call `constructEvent()`. Install `stripe` npm package in `packages/shared`. |
| SEC-02 | Payment and Stripe webhook handlers check idempotency key (event.id) against `processed_webhook_events` table and skip duplicates | Table does not exist yet. Requires new migration `00004_webhook_idempotency.sql`. Pattern: check before insert, return 200 on duplicate. |
| SEC-03 | Anonymous RLS policies (`sessions_anon_insert`, `sessions_anon_update`, `responses_anon_insert`) removed and replaced with org_id-scoped server-side validation | Policies are in `00001_initial_schema.sql` lines 361-369. Fix requires a new migration (cannot modify a deployed migration). |
| SEC-04 | Payment webhook `body.org_id` fallback removed. Org resolution requires valid API key or webhook signature only | Line 114 of `apps/admin/src/app/api/webhooks/payment/route.ts` — one-function change in `resolveOrgId()`. |
| SEC-05 | Widget response submission routes through authenticated API endpoint (`POST /api/widget/response`) instead of direct anonymous Supabase inserts | `useWizardSession.ts` `submitResponse()` currently calls `supabase.from('session_responses').insert()` directly (line 205). New API route required + hook refactor. |
| ORG-03 | Payment handler uses atomic transaction (plpgsql function) to prevent orphaned records on partial provisioning failure | `payment-handler.ts` runs 7 sequential inserts with no transaction. Fix: new `provision_client` plpgsql function called via `supabase.rpc()`. |
</phase_requirements>

---

## Summary

Phase 1 is purely a hardening sprint: fix three confirmed active exploits and add one architectural guardrail. No new features. Every file that needs changing is already identified from direct codebase inspection — this is not speculative research. The changes are surgical and can be planned as six independent tasks with no inter-task dependencies except that SEC-05 depends on the new API route existing before the widget hook is updated.

The most important discovery: the `stripe` npm SDK is NOT installed. `stripe-adapter.ts` uses raw `fetch` with the Stripe REST API. `constructEvent()` is a stripe-sdk-only function — it cannot be replicated with raw crypto without significant effort and risk. The fix for SEC-01 requires installing `stripe` in `packages/shared` and replacing the raw fetch calls in `stripe-adapter.ts` with the SDK client. This is a slightly larger change than a one-liner, but still straightforward and well-documented.

The `processed_webhook_events` idempotency table does not exist — it must be created in a new migration. The three exploitable RLS policies are in a deployed migration (`00001`) so the fix must come via a new migration (`00004`) that DROPs the old policies and adds correctly scoped ones. The payment handler atomicity fix requires a new plpgsql function deployed via migration, called via `supabase.rpc()`. The widget refactor is the most structural change: a new API route at `POST /api/widget/response` must be created and the `useWizardSession.ts` `submitResponse()` function must switch from direct Supabase inserts to `fetch()` calls against that route.

**Primary recommendation:** Execute as six tasks in two groups. Group A (pure server-side, no coordination needed): SEC-01, SEC-02, SEC-03, SEC-04, ORG-03. Group B (requires Group A's new API route): SEC-05. Plan as a two-wave execution.

---

## Standard Stack

### Core (already installed, no changes needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | 2.49.0 | DB operations, RLS, `rpc()` calls | Already in use throughout |
| `next` | 15.1.0 | App Router, route handlers | Already in use |
| `crypto.subtle` | Web API | HMAC verification in payment webhook | Already used in `verifyWebhookSignature()` |

### New (must be installed)
| Library | Version | Purpose | Why Needed |
|---------|---------|---------|------------|
| `stripe` | 17.x latest | `constructEvent()` for signature verification | Only way to safely verify Stripe HMAC — SDK handles timestamp tolerance, encoding, constant-time comparison |

### No New Libraries for Other Requirements
- SEC-02 (idempotency): SQL table + Supabase client query — no library needed
- SEC-03 (RLS): SQL migration — no library needed
- SEC-04 (remove fallback): Delete 3 lines of TypeScript — no library needed
- SEC-05 (API route): Next.js `route.ts` + `fetch()` in widget — no library needed
- ORG-03 (atomicity): plpgsql function + `supabase.rpc()` — no library needed

**Installation:**
```bash
# Install stripe SDK in the shared package
cd /path/to/repo && pnpm add stripe --filter @leadrwizard/shared
```

Check current stripe version before pinning:
```bash
pnpm info stripe version
```

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `stripe` SDK for `constructEvent()` | Manual HMAC-SHA256 reimplementation | Manual impl is ~40 lines, error-prone, misses timestamp tolerance check. SDK is 1 import. Use SDK. |
| New migration for RLS fix | Editing `00001_initial_schema.sql` | Never modify deployed migrations. Always add new migration for policy changes. |
| `supabase.rpc()` for atomicity | App-level try/catch with cleanup rollback | App-level rollback is fragile and cannot guarantee cleanup. plpgsql transaction is the correct tool. |

---

## Architecture Patterns

### Recommended File Changes

```
apps/admin/src/app/
├── api/
│   ├── webhooks/
│   │   ├── stripe/route.ts         # SEC-01: add constructEvent()
│   │   └── payment/route.ts        # SEC-04: remove body.org_id fallback
│   └── widget/
│       └── response/route.ts       # SEC-05: NEW file

apps/widget/src/
└── hooks/
    └── useWizardSession.ts          # SEC-05: submitResponse() uses fetch, not supabase

packages/shared/src/
├── billing/
│   └── stripe-adapter.ts           # SEC-01: add stripe SDK, expose constructEvent wrapper
└── automations/
    └── payment-handler.ts          # ORG-03: replace sequential inserts with supabase.rpc()

supabase/migrations/
├── 00004_webhook_idempotency.sql   # SEC-02: processed_webhook_events table
└── 00005_rls_hardening.sql         # SEC-03: drop anon policies, add scoped ones
                                    # ORG-03: provision_client plpgsql function
```

### Pattern 1: Stripe Webhook Signature Verification (SEC-01)

**What:** Replace `JSON.parse(body)` with `stripe.webhooks.constructEvent(rawBody, sig, secret)`. The SDK returns the parsed Stripe event or throws `Stripe.errors.StripeSignatureVerificationError`.

**Critical constraint:** `request.text()` is already correctly used in `stripe/route.ts` — the raw body is preserved. Do NOT switch to `request.json()`. The raw string must reach `constructEvent()` unmodified.

**Example:**
```typescript
// Source: https://docs.stripe.com/webhooks/signature-verification
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-01-27.acacia",
});

export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  // event is now a verified Stripe.Event — pass it to processStripeWebhook
  await processStripeWebhook(supabase, event);
  return NextResponse.json({ received: true });
}
```

### Pattern 2: Idempotency Table + Check (SEC-02)

**What:** Before processing any webhook, check `processed_webhook_events` for the event ID. If found, return 200 immediately. If not found, insert it (with `on conflict do nothing`) and process.

**Why return 200 on duplicate:** Stripe retries on 5xx. Returning 200 tells Stripe delivery succeeded. Returning 500 on a duplicate causes infinite retries.

**Migration schema:**
```sql
-- supabase/migrations/00004_webhook_idempotency.sql
create table public.processed_webhook_events (
  id           text primary key,          -- Stripe event.id or payment webhook idempotency key
  source       text not null,             -- 'stripe' | 'payment'
  processed_at timestamptz not null default now(),
  payload      jsonb                      -- optional: store event summary for debugging
);

-- No RLS needed — only accessed via service role in server-side routes
-- Cleanup old events after 30 days to prevent unbounded growth
create index idx_processed_webhook_events_at on public.processed_webhook_events(processed_at);
```

**Check pattern:**
```typescript
// Source: https://docs.stripe.com/webhooks/best-practices#handle-duplicate-events
async function isAlreadyProcessed(supabase: SupabaseClient, eventId: string): Promise<boolean> {
  const { data } = await supabase
    .from("processed_webhook_events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  return data !== null;
}

async function markProcessed(supabase: SupabaseClient, eventId: string, source: string): Promise<void> {
  await supabase
    .from("processed_webhook_events")
    .insert({ id: eventId, source })
    .throwOnError();
}
```

For Stripe webhook: use `event.id`. For payment webhook: use `body.payment_ref` (already a unique payment identifier) or require caller to pass an idempotency key header.

### Pattern 3: RLS Policy Replacement (SEC-03)

**What:** New migration drops the three exploitable anonymous policies and replaces them with correctly scoped ones. Session creation moves entirely server-side.

```sql
-- supabase/migrations/00005_rls_hardening.sql

-- Drop the three exploitable anon policies
drop policy if exists "sessions_anon_insert" on public.onboarding_sessions;
drop policy if exists "sessions_anon_update" on public.onboarding_sessions;
drop policy if exists "responses_anon_insert" on public.session_responses;

-- Responses: can only insert for a session that legitimately exists and is active
create policy "responses_valid_session_insert" on public.session_responses
  for insert with check (
    exists (
      select 1 from public.onboarding_sessions
      where id = session_id
        and status = 'active'
    )
  );

-- interactions_anon_insert also needs scoping (currently with check (true))
drop policy if exists "interactions_anon_insert" on public.interaction_log;
create policy "interactions_valid_client_insert" on public.interaction_log
  for insert with check (
    exists (
      select 1 from public.onboarding_sessions
      where id = session_id
    )
  );
```

Session creation (previously done by anon clients in widget) is now ONLY possible via the server-side `POST /api/widget/response` route (which runs as service role) or other authenticated server code.

### Pattern 4: Remove body.org_id Fallback (SEC-04)

**What:** Delete lines 113-116 from `resolveOrgId()` in `payment/route.ts`. Return `null` if no API key resolves.

**Before:**
```typescript
// Fallback: explicit org_id in the body (for testing / trusted internal calls)
if (typeof body.org_id === "string" && body.org_id) {
  return body.org_id;
}
```

**After:** These lines are deleted. `resolveOrgId` returns `null` if API key lookup fails. The 401 branch at the call site already handles this correctly.

**For internal testing:** Replace with `X-Internal-Secret` header checked against `process.env.INTERNAL_WEBHOOK_SECRET`. This provides equivalent dev access without the account takeover risk.

### Pattern 5: Authenticated Widget Response Endpoint (SEC-05)

**What:** New `POST /api/widget/response` route that accepts `{ sessionId, fieldKey, fieldValue, clientServiceId, answeredVia }`, validates the session exists and is active, resolves `org_id` server-side, and inserts via service role. Widget `submitResponse()` switches from direct Supabase insert to `fetch()` against this route.

```typescript
// apps/admin/src/app/api/widget/response/route.ts
export async function POST(request: Request) {
  const body = await request.json();
  const { sessionId, fieldKey, fieldValue, clientServiceId, answeredVia } = body;

  if (!sessionId || !fieldKey || fieldValue === undefined) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const supabase = createServerClient(); // service role — bypasses RLS for server insert

  // Validate session exists and is active
  const { data: session } = await supabase
    .from("onboarding_sessions")
    .select("id, org_id, client_id, status")
    .eq("id", sessionId)
    .eq("status", "active")
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Session not found or not active" }, { status: 404 });
  }

  // Insert response with server-resolved org context
  await supabase.from("session_responses").insert({
    session_id: sessionId,
    client_service_id: clientServiceId || null,
    field_key: fieldKey,
    field_value: String(fieldValue),
    answered_via: answeredVia || "click",
  });

  return NextResponse.json({ ok: true });
}
```

**Widget hook change:** In `useWizardSession.ts` `submitResponse()`, replace `supabase.from('session_responses').insert(...)` with:
```typescript
await fetch("/api/widget/response", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId, fieldKey, fieldValue, clientServiceId, answeredVia }),
});
```

The widget also still reads from Supabase directly (for session load, question fetching) — only the write path changes. Reading with anon key against existing RLS is fine; writing must go through the API.

**Important:** The `NEXT_PUBLIC_SUPABASE_URL` that widget uses for reads must point to the admin app's Supabase instance. The API URL `/api/widget/response` must be absolute or configurable since the widget runs as an IIFE on third-party sites. Pass the API base URL as part of `LeadrWizardConfig`.

### Pattern 6: Atomic Payment Handler (ORG-03)

**What:** New plpgsql function `provision_client` wraps steps 1-3 and step 5 (client, client_package, client_services, session) in a single transaction. Called via `supabase.rpc('provision_client', params)`. GHL provisioning (step 4) stays outside — external API calls cannot participate in DB transactions.

```sql
-- Part of supabase/migrations/00005_rls_hardening.sql or separate 00006

create or replace function public.provision_client(
  p_org_id         uuid,
  p_name           text,
  p_email          text,
  p_phone          text,
  p_business_name  text,
  p_payment_ref    text,
  p_package_id     uuid,
  p_metadata       jsonb
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_client         public.clients%rowtype;
  v_client_package public.client_packages%rowtype;
  v_session        public.onboarding_sessions%rowtype;
  v_service_ids    uuid[];
begin
  -- Idempotency: return existing if payment_ref already processed
  select * into v_client
  from public.clients
  where payment_ref = p_payment_ref and org_id = p_org_id;

  if found then
    -- Return existing IDs so handler can continue with GHL etc.
    return jsonb_build_object(
      'client_id', v_client.id,
      'idempotent', true
    );
  end if;

  -- 1. Create client
  insert into public.clients (org_id, name, email, phone, business_name, payment_ref, metadata)
  values (p_org_id, p_name, p_email, p_phone, p_business_name, p_payment_ref, p_metadata)
  returning * into v_client;

  -- 2. Create client_package
  insert into public.client_packages (client_id, package_id)
  values (v_client.id, p_package_id)
  returning * into v_client_package;

  -- 3. Create client_services for each service in the package
  insert into public.client_services (client_id, service_id, client_package_id, status, opted_out)
  select v_client.id, ps.service_id, v_client_package.id, 'pending_onboarding', false
  from public.package_services ps
  where ps.package_id = p_package_id;

  -- 4. Create onboarding session
  insert into public.onboarding_sessions (client_id, org_id, status, completion_pct)
  values (v_client.id, p_org_id, 'active', 0)
  returning * into v_session;

  return jsonb_build_object(
    'client_id',   v_client.id,
    'package_id',  v_client_package.id,
    'session_id',  v_session.id,
    'idempotent',  false
  );
end;
$$;
```

The handler in `payment-handler.ts` becomes:
```typescript
const { data: result, error } = await supabase.rpc("provision_client", {
  p_org_id: orgId,
  p_name: payload.customer_name,
  p_email: payload.customer_email,
  p_phone: payload.customer_phone || null,
  p_business_name: payload.business_name || null,
  p_payment_ref: payload.payment_ref,
  p_package_id: payload.package_id,
  p_metadata: payload.metadata || {},
});

if (error) throw new Error(`Provisioning failed: ${error.message}`);
if (result.idempotent) {
  // Duplicate webhook — return early with 200
  return NextResponse.json({ received: true, duplicate: true });
}
// Continue with GHL provisioning (fire-and-forget), outreach queue, interaction log
```

### Anti-Patterns to Avoid

- **Never use `request.json()` before `constructEvent()`:** The body stream is consumed. Even if you buffer it, the JSON parsing mutates the bytes. Always `request.text()` → pass raw string to `constructEvent()`.
- **Never make STRIPE_WEBHOOK_SECRET optional:** The current code in `stripe-adapter.ts` returns empty string if the env var is missing. An empty secret means `constructEvent()` will verify against nothing (will likely throw). Throw at startup if missing.
- **Never return 5xx on duplicate webhook:** Stripe retries on 5xx for 3 days. A 5xx on "already processed" causes infinite retries and duplicate client creation if idempotency check has a race. Return 200.
- **Never modify deployed migrations:** The three bad RLS policies are in `00001`. Create `00005_rls_hardening.sql` to drop and replace them.
- **Never put external API calls in a DB transaction:** GHL provisioning cannot be inside the plpgsql function. It must remain a separate step after `rpc()` returns.
- **Never trust body.org_id in payment webhook:** Delete it. No exceptions. Internal callers get an env-var-gated secret header.
- **Never expose the widget's Supabase anon key for writes:** The anon key will continue to exist in the widget for reads (session load, question fetch). Write path must be API-only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stripe signature verification | Custom HMAC with timestamp tolerance | `stripe.webhooks.constructEvent()` | Stripe's HMAC includes a `t=` timestamp in the header that must be checked for replay protection (default 300s tolerance). Custom impl must handle this correctly — error-prone. SDK handles it. |
| Idempotency deduplication | In-memory Map keyed by event.id | `processed_webhook_events` table | In-memory Map resets on every Vercel cold start. Database is the only durable store across serverless instances. |
| Partial rollback on payment failure | Application-level try/catch with compensating deletes | plpgsql `BEGIN/COMMIT` via `supabase.rpc()` | Application-level rollback can fail partway through the rollback, leaving doubly-corrupted state. DB transaction is atomic by definition. |

**Key insight:** Every "clever" shortcut in payment and webhook processing has a failure mode that's worse than the original problem. Use the standard solution.

---

## Common Pitfalls

### Pitfall 1: Installing stripe SDK causes TypeScript conflicts
**What goes wrong:** `stripe-adapter.ts` currently uses a custom `StripeConfig` interface and raw fetch patterns. Adding the SDK introduces a `Stripe` client that has different method signatures.
**Why it happens:** The raw fetch adapter was written without the SDK as a deliberate choice to avoid the dependency.
**How to avoid:** When adding `stripe` SDK, replace the `stripeRequest()` function entirely. Don't mix raw fetch and SDK client in the same file. The SDK's `stripe.checkout.sessions.create()` replaces `stripeRequest('/checkout/sessions', ...)`, etc.
**Warning signs:** TypeScript errors about conflicting `StripeConfig` types after install.

### Pitfall 2: Widget API calls fail cross-origin
**What goes wrong:** Widget runs as an IIFE on third-party sites. `fetch("/api/widget/response")` is a relative URL — it resolves to the third-party domain, not the LeadrWizard admin app.
**Why it happens:** Relative URLs in browser fetch resolve against `window.location.origin`.
**How to avoid:** Pass `apiBaseUrl` as part of `LeadrWizardConfig` in `init()`. Use `${config.apiBaseUrl}/api/widget/response` in `submitResponse()`. The admin app needs CORS headers on this route: `Access-Control-Allow-Origin: *` (or restrict to known widget domains). Add a `OPTIONS` handler to the route.
**Warning signs:** 404 or CORS errors in browser console when widget tries to submit.

### Pitfall 3: plpgsql function not deployed before payment handler is updated
**What goes wrong:** If `payment-handler.ts` is updated to call `supabase.rpc('provision_client')` before the migration runs, every payment fails with "function provision_client does not exist".
**Why it happens:** Code deployed before DB migration in a serverless/Vercel environment.
**How to avoid:** Deploy migration first, verify via Supabase dashboard or a health check, then deploy the updated `payment-handler.ts`. In the planner, sequence DB migration task before the code task.
**Warning signs:** `supabase.rpc()` returning error with "function not found" message.

### Pitfall 4: Duplicate `stripe-signature` header check
**What goes wrong:** Current `stripe/route.ts` fetches `signature` but never uses it. After adding `constructEvent()`, a bug where `sig` is null (missing header) must return 400, not throw an unhandled exception.
**How to avoid:** Always null-check `sig` before passing to `constructEvent()`. The SDK throws if sig is null/empty, but return a controlled 400 instead of a 500.

### Pitfall 5: Widget reads break after RLS hardening
**What goes wrong:** SEC-03 removes anonymous session insert/update but may inadvertently affect the anon SELECT path that the widget uses to load session data.
**Why it happens:** The migration drops policies by name — if `sessions_select` is accidentally dropped too, widget reads fail.
**How to avoid:** The migration only drops `sessions_anon_insert`, `sessions_anon_update`, and `responses_anon_insert`. The authenticated `sessions_select` policy is untouched. Verify widget session load still works after migration by testing with an anon Supabase client.

### Pitfall 6: `interactions_anon_insert` also needs scoping
**What goes wrong:** The current code in `useWizardSession.ts` also inserts into `interaction_log` directly (line 215). `interactions_anon_insert` has `with check (true)` — same exploit surface as the session policies.
**How to avoid:** The SEC-03 migration should also replace `interactions_anon_insert` with a scoped version. The new `/api/widget/response` route handles interaction logging server-side after SEC-05 is deployed. Transition: harden the policy simultaneously with the route deploy.

---

## Code Examples

Verified patterns from official sources:

### Stripe constructEvent (official pattern)
```typescript
// Source: https://docs.stripe.com/webhooks/signature-verification
// Must use raw body string — NOT parsed JSON
let event: Stripe.Event;
try {
  event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
} catch (err) {
  return NextResponse.json(
    { error: `Webhook signature verification failed: ${err instanceof Error ? err.message : "Unknown"}` },
    { status: 400 }
  );
}
```

### Idempotency check pattern (Stripe best practice)
```typescript
// Source: https://docs.stripe.com/webhooks/best-practices#handle-duplicate-events
// Return 200 on duplicate — never 4xx/5xx
const { data: existing } = await supabase
  .from("processed_webhook_events")
  .select("id")
  .eq("id", event.id)
  .maybeSingle();

if (existing) {
  return NextResponse.json({ received: true });
}

// Insert idempotency record BEFORE processing to prevent race conditions
await supabase
  .from("processed_webhook_events")
  .insert({ id: event.id, source: "stripe" });
```

### supabase.rpc() call pattern
```typescript
// Source: https://supabase.com/docs/reference/javascript/rpc
const { data, error } = await supabase.rpc("provision_client", {
  p_org_id: orgId,
  p_payment_ref: payload.payment_ref,
  // ... other params
});
if (error) throw new Error(error.message);
```

### CORS headers for widget API route
```typescript
// apps/admin/src/app/api/widget/response/route.ts
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw fetch for Stripe API | `stripe` npm SDK | Stripe SDK v5+ stable, 2023 | SDK adds TypeScript types, error scrubbing, `constructEvent()` |
| Anonymous RLS for widget writes | Server-side API route + scoped RLS | Current best practice | Eliminates cross-org injection vector |
| Sequential async inserts | plpgsql transaction via `rpc()` | Supabase has supported `rpc()` since v1 | Atomic provisioning, no orphaned records |

**Deprecated/outdated:**
- `stripe-adapter.ts` raw `fetch()` pattern: works for API calls but cannot verify webhook signatures. Replace with SDK.
- Anonymous `with check (true)` RLS: was acceptable for early prototyping. Not acceptable in production with real org data.

---

## Open Questions

1. **Widget API base URL configuration**
   - What we know: Widget runs as IIFE on third-party sites. Relative fetch URLs won't work.
   - What's unclear: Is there already a configured `NEXT_PUBLIC_APP_URL` or similar env var the widget can reference?
   - Recommendation: Add `apiBaseUrl` to `LeadrWizardConfig` in `init()` as a required field. Document in the embed snippet.

2. **Vapi webhook signature verification**
   - What we know: STATE.md flags this as a known concern. `/api/webhooks/vapi` is listed in ARCHITECTURE.md as "unknown" for signature verification.
   - What's unclear: Vapi's webhook signature scheme. Does Vapi send a signature header? What algorithm?
   - Recommendation: Out of scope for Phase 1 requirements (not in SEC-01 through SEC-05, ORG-03). Document as a Phase 7 follow-up item.

3. **stripe SDK version to pin**
   - What we know: The project uses pnpm with a `packageManager: pnpm@10.29.3` lock. stripe SDK is at v17.x as of early 2026.
   - What's unclear: Whether v17 has any breaking changes vs the raw fetch patterns in `stripe-adapter.ts`.
   - Recommendation: Run `pnpm info stripe version` before adding. Pin to latest stable. The plpgsql function and webhook verification patterns are stable across v10+.

4. **`processed_webhook_events` insert race on concurrent Stripe retries**
   - What we know: Stripe can retry quickly enough that two instances process the same event simultaneously. The table `primary key` on `id` prevents double insert — second insert throws a unique violation.
   - What's unclear: Whether the Supabase client returns an error or throws on PK conflict.
   - Recommendation: Use `.upsert({ id: event.id, source: 'stripe' }, { onConflict: 'id', ignoreDuplicates: true })` instead of plain `.insert()`. If `ignoreDuplicates: true`, no error thrown on conflict — simply check if row was inserted with `count` returned.

---

## Sources

### Primary (HIGH confidence)
- Codebase direct inspection: `apps/admin/src/app/api/webhooks/stripe/route.ts` — confirmed signature not verified
- Codebase direct inspection: `apps/admin/src/app/api/webhooks/payment/route.ts` lines 113-116 — confirmed `body.org_id` fallback
- Codebase direct inspection: `supabase/migrations/00001_initial_schema.sql` lines 361-369 — confirmed three exploitable RLS policies
- Codebase direct inspection: `packages/shared/src/automations/payment-handler.ts` — confirmed 7 sequential inserts with no transaction
- Codebase direct inspection: `apps/widget/src/hooks/useWizardSession.ts` lines 205-224 — confirmed direct anon Supabase inserts
- Codebase direct inspection: `packages/shared/package.json` — confirmed `stripe` npm package NOT installed
- [Stripe webhook signature verification docs](https://docs.stripe.com/webhooks/signature-verification) — `constructEvent()` API, timestamp tolerance, error types
- [Stripe webhook best practices](https://docs.stripe.com/webhooks/best-practices) — idempotency, duplicate handling, return 200 on duplicate
- [Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security) — policy syntax, anonymous access patterns
- [Supabase rpc() docs](https://supabase.com/docs/reference/javascript/rpc) — calling plpgsql functions from JS client

### Secondary (MEDIUM confidence)
- `.planning/research/PITFALLS.md` — direct analysis of the same codebase, high quality first-party research
- `.planning/research/SUMMARY.md` — confirmed stack decisions, version numbers
- [Next.js App Router + Stripe: `request.text()` requirement](https://kitson-broadhurst.medium.com/next-js-app-router-stripe-webhook-signature-verification-ea9d59f3593f) — explains why raw body must be preserved

### Tertiary (LOW confidence — needs validation)
- stripe SDK version compatibility with existing `stripe-adapter.ts` patterns: assumed compatible based on general knowledge, validate by running `pnpm add stripe` and checking TypeScript errors.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — codebase directly inspected, dependencies verified in package.json
- Architecture: HIGH — all six required changes are identified with exact file paths and line numbers
- Pitfalls: HIGH — grounded in direct code inspection, not inference
- Code examples: HIGH for Stripe patterns (official docs), HIGH for RLS/plpgsql (Supabase docs), MEDIUM for CORS pattern (standard Next.js, not official doc link)

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (Stripe SDK API is stable, Supabase RLS syntax is stable)
