# Pitfalls Research

**Domain:** AI-powered autonomous onboarding SaaS, multi-tenant, embedded widget, Stripe billing
**Researched:** 2026-03-13
**Confidence:** HIGH (grounded in actual codebase code + verified against official docs and community post-mortems)

---

## Critical Pitfalls

### Pitfall 1: Stripe Webhook Without Signature Verification

**What goes wrong:**
The `/api/webhooks/stripe/route.ts` handler currently parses the raw body with `JSON.parse(body)` but skips `stripe.webhooks.constructEvent()`. The `signature` variable is fetched from headers but never used. Any actor who discovers the webhook URL can POST a fabricated `checkout.session.completed` event, causing the system to create a real `org_subscriptions` record and flip `plan_slug` on an organization without a legitimate payment.

**Why it happens:**
Developers use `request.text()` correctly (required for raw body) but forget that Stripe's verification step must happen on that text before any parsing. The comment in the code says "In production, verify the webhook signature" — a classic TODO-in-production trap.

Additionally, Next.js App Router makes this subtly tricky: using `request.json()` instead of `request.text()` consumes the body stream before signature verification, causing HMAC mismatch errors even when you try to add verification later. The raw string must be passed unmodified to `stripe.webhooks.constructEvent(body, sig, secret)`.

**How to avoid:**
1. Install `stripe` npm package (not raw `fetch`). Use `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)`.
2. Require `STRIPE_WEBHOOK_SECRET` at startup — throw if missing, never silently skip.
3. The current file already reads `const body = await request.text()` which is correct. The fix is one function call insertion before the JSON parse.
4. Use `stripe-cli` for local testing: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

**Warning signs:**
- Handler responds 200 to requests without `stripe-signature` header.
- No `STRIPE_WEBHOOK_SECRET` env var in production environment.
- `processStripeWebhook` is called before any signature check.

**Phase to address:** Stripe Integration Hardening (before any self-service org signup goes live)

---

### Pitfall 2: Payment Webhook `body.org_id` Fallback Allows Account Takeover

**What goes wrong:**
`/api/webhooks/payment/route.ts` line 114: if neither an `Authorization` bearer token nor `X-API-Key` header resolves to a valid org, the handler falls back to trusting `body.org_id` directly. An attacker can POST `{"org_id": "<victim-org-uuid>", "customer_email": "attacker@evil.com", "package_id": "<known-id>"}` and trigger a full onboarding flow for the victim org, creating clients and sessions under their account.

**Why it happens:**
The fallback was added for "testing / trusted internal calls." Once it ships, it never gets removed because tests depend on it. It exposes an account enumeration + takeover vector.

**How to avoid:**
1. Delete the `body.org_id` fallback entirely. If needed for internal use, add a server-to-server secret header (`X-Internal-Secret`) checked against an env var.
2. Require `PAYMENT_WEBHOOK_SECRET` (non-optional). The current code only verifies HMAC if the env var exists; make its absence a startup error.
3. Constant-time comparison already exists in the codebase (lines 144-150) — keep it.

**Warning signs:**
- `PAYMENT_WEBHOOK_SECRET` not set in prod env.
- Requests without API key or signature returning 200.
- `resolveOrgId` returning a value from `body.org_id` in production logs.

**Phase to address:** Security Hardening Phase (address before any public billing goes live)

---

### Pitfall 3: Anonymous RLS Policies Allow Cross-Org Session Injection

**What goes wrong:**
Three RLS policies in `00001_initial_schema.sql` use `with check (true)` for anonymous inserts:
- `sessions_anon_insert`: any client in any browser can create a new `onboarding_sessions` row with any `org_id`.
- `sessions_anon_update`: any client can update any session (no `using` clause scoping).
- `responses_anon_insert`: any client can insert a `session_responses` row for any `session_id`.

An attacker who sniffs or guesses a valid `org_id` (UUIDs, but org creation events may leak them through timing) can create fake sessions under that org's account, insert arbitrary responses, and inflate metrics. Combined with widget XSS, this becomes a full data injection vector.

**Why it happens:**
The original intent was: widget loads with a `session_id`, submits responses anonymously. But the policies were written with `(true)` instead of being scoped to a valid existing session. The widget only needs to INSERT responses for a session that already exists — not create sessions from scratch client-side.

**How to avoid:**
1. Sessions should only be created by the server-side API after payment is validated. Remove `sessions_anon_insert` and `sessions_anon_update` entirely.
2. For `responses_anon_insert`: change `with check (true)` to `with check (exists (select 1 from public.onboarding_sessions where id = session_id and status = 'active'))`. This means responses can only be added to sessions that legitimately exist.
3. Move session creation to an authenticated server-side route that the widget calls with a signed token (JWT with the session ID embedded).
4. Add `interactions_anon_insert` the same scoping treatment.

**Warning signs:**
- `onboarding_sessions` rows with no corresponding `client_packages` record.
- Sessions with `org_id` values that have no active clients.
- Spike in `session_responses` without matching `interaction_log` entries.

**Phase to address:** RLS Hardening Phase (before widget e2e goes live)

---

### Pitfall 4: Non-Atomic Payment Handler Creates Orphaned Records on Partial Failure

**What goes wrong:**
`payment-handler.ts` runs 7 sequential async operations (create client → create client_package → create client_services → GHL provision → create session → queue outreach → log interaction). Each step calls Supabase independently. If step 5 (session creation) fails after steps 1-4 succeed, you have:
- A real `clients` record.
- A real `client_packages` record.
- Real `client_services` records.
- No `onboarding_sessions` — so no outreach is ever sent.
- Client paid, nothing happens. They never get contacted.

The codebase documents this as "Payment Handler Initialization Sequence Not Atomic."

**Why it happens:**
Supabase JS client does not natively support multi-statement transactions via `supabase-js`. Developers assume sequential awaits are safe because they're in the same function. They're not — each is a separate HTTP call to PostgREST.

**How to avoid:**
1. Use a Supabase database function (`plpgsql`) wrapped in `BEGIN/COMMIT` for the atomic part (client + client_package + client_services + session creation). Call it via `supabase.rpc('provision_client', {...})`.
2. Store `payment_ref` on the client record and check for it on entry: `SELECT id FROM clients WHERE payment_ref = $1 AND org_id = $2`. If found, the webhook is a duplicate — return the existing record.
3. For GHL provisioning (external API call), keep it outside the transaction but make it idempotent: check `ghl_sub_account_id` before provisioning.
4. For outreach queue: insert as part of the DB transaction so it's atomic with session creation.

**Warning signs:**
- `clients` records without corresponding `onboarding_sessions`.
- No outreach in `outreach_queue` for a client who exists in `clients`.
- Stripe showing successful payment but no session in admin dashboard.

**Phase to address:** Payment + Billing Phase (implement before self-service org signup)

---

### Pitfall 5: Stripe Duplicate Event Causes Duplicate Client + Subscription

**What goes wrong:**
Stripe retries webhooks for up to 3 days if your endpoint returns non-2xx or times out. `checkout.session.completed` can arrive 2-5 times for the same session. `processStripeWebhook` does not check if an `org_subscriptions` row already exists for `stripe_subscription_id`. Result: duplicate subscription records, and if the `/api/webhooks/payment` is also triggered, duplicate `clients` records.

**Why it happens:**
No idempotency check anywhere in either webhook handler. The `payment_ref` column exists on `clients` but is never used as a deduplication key before inserting.

**How to avoid:**
1. In `processStripeWebhook` for `checkout.session.completed`: do an upsert on `stripe_subscription_id`, not a plain insert.
2. In `handlePaymentWebhook`: before creating the client, do `SELECT id FROM clients WHERE payment_ref = $ref AND org_id = $org_id`. If found, return early with the existing record.
3. Add a `UNIQUE` constraint on `clients(payment_ref, org_id)` at the database level — this is the last line of defense.
4. Log and return 200 (not 500) for duplicate event processing. Stripe retries 5xx, not 2xx. Returning an error on duplicates causes infinite retries.

**Warning signs:**
- Duplicate rows in `clients` with the same `payment_ref`.
- Multiple `org_subscriptions` rows with the same `stripe_subscription_id`.
- Admin showing a client twice with identical contact info.

**Phase to address:** Stripe Integration Hardening Phase

---

## Moderate Pitfalls

### Pitfall 6: Supabase Realtime + RLS = Silent Dead Subscriptions

**What goes wrong:**
The roadmap calls for real-time dashboard updates via Supabase Realtime. Supabase Realtime respects RLS — before broadcasting a change, it impersonates the subscribed user and evaluates their SELECT policies. If the RLS policy for `clients` or `onboarding_sessions` uses a subquery join (like the current `org_id in (select org_id from org_members where user_id = auth.uid())`), every realtime event triggers that subquery for every subscribed user. At 100 admin users subscribed to a table with frequent writes, this causes authorization timeouts and silently dropped events — the dashboard just stops updating.

**How to avoid:**
1. For Realtime subscriptions, filter at the subscription level: `.channel('org-clients').on('postgres_changes', { filter: `org_id=eq.${orgId}` }, ...)`. Filtered subscriptions only broadcast matching rows, avoiding per-user RLS evaluation overhead.
2. Alternatively, use Broadcast instead of Postgres Changes for high-frequency updates: server-side code emits to a broadcast channel, client subscribes to channel only.
3. Add an index on `org_members(user_id, org_id)` if not already present to speed up the RLS subquery that runs on every realtime check.

**Warning signs:**
- Dashboard stops updating after being open for a few minutes.
- Supabase Realtime logs showing "authorization timeout" events.
- RLS policies evaluated hundreds of times per second under normal load.

**Phase to address:** Dashboard + Observability Phase

---

### Pitfall 7: Widget Embedded on Untrusted Domains with No Origin Validation

**What goes wrong:**
`apps/widget/src/main.tsx` has no domain allowlist. Anyone can embed `<script src="your-cdn/widget.js">` and call `window.LeadrWizard.init({sessionId: 'xxx', containerId: 'x'})`. Combined with the anonymous RLS insert policies, a malicious site could create sessions and submit responses. Even with shadow DOM isolation (which prevents CSS leakage), JavaScript on the host page can call the widget's public API.

**How to avoid:**
1. Add an `allowedOrigins` array to the `init()` config. On load, check `window.location.origin` against the list: if not in list, render nothing and log a warning.
2. Use `Referrer-Policy: strict-origin-when-cross-origin` on the widget CDN response.
3. Store allowed origins per session in the database. On response submission API call, validate `Origin` header server-side.
4. Shadow DOM does NOT protect against the host page calling your exported JavaScript API — it only isolates styles.

**Warning signs:**
- Widget `init()` being called from domains not in your customer list.
- Sessions created from IP addresses that don't match client geography.
- Response submissions from `Origin` headers you don't recognize.

**Phase to address:** Widget E2E Phase (before widget goes live)

---

### Pitfall 8: Admin CRUD N+1 Queries from Eager Fetching Patterns

**What goes wrong:**
Admin CRUD pages (service definitions, packages, templates) typically fetch a list, then for each item fetch related records in a loop. Example: fetch 20 service definitions, then for each one fetch its required fields, package associations, and org context. This is 1 + 20*3 = 61 queries for a single page load.

In Next.js 15 with server components, this pattern is easy to fall into because each component can independently call `supabase.from(...)`. Without intentional query consolidation, components independently hit the database.

**How to avoid:**
1. Use Supabase's foreign key expansion: `supabase.from('service_definitions').select('*, package_services(package_id, packages(name))')`. One query, joined data.
2. For list views, always fetch with explicit `select()` column lists — never `select('*')` for tables with JSONB blobs (like `required_data_fields`), as this pulls large payloads unnecessarily.
3. Paginate admin list views from day one. Even with a small customer base, service definitions and templates can grow to hundreds.

**Warning signs:**
- Admin dashboard slow to load (>1s for list pages).
- Supabase "Advisor" tab showing sequential scans on `service_definitions` or `packages`.
- More than 5 queries in a single page's server render.

**Phase to address:** Admin CRUD Phase

---

### Pitfall 9: Race Condition in Admin CRUD Without Optimistic Update Rollback

**What goes wrong:**
If admin deletes a service definition while it's being edited in another tab (or by another admin user), the edit form submits an update to a now-deleted row. Supabase returns 0 rows updated (no error). The UI shows success but no change persisted. For package-service associations, this can leave `package_services` rows pointing to deleted `service_definitions`.

**How to avoid:**
1. Use `RETURNING id` on all update operations and check that exactly 1 row was returned. If 0, show a conflict error.
2. Add `updated_at` optimistic locking: include `WHERE updated_at = $previous_updated_at` in update queries. If the row was updated by someone else, the query returns 0 rows — surface a "conflict, reload" message.
3. Add `ON DELETE CASCADE` or `ON DELETE RESTRICT` on `package_services.service_id` FK to prevent orphaned package-service links.

**Warning signs:**
- Admin UI shows "success" but data unchanged after refresh.
- `package_services` rows with `service_id` values that no longer exist.
- Multiple admin users editing the same entity concurrently.

**Phase to address:** Admin CRUD Phase

---

### Pitfall 10: Structured Logging Added Too Late Obscures Production Incidents

**What goes wrong:**
The codebase currently uses `console.error()` and `console.log()` throughout. These produce unstructured strings in Vercel's log stream — no correlation IDs, no request tracing, no session context. When a Stripe webhook fails silently, the only log is `"Stripe webhook error: ..."` with no `event_id`, `org_id`, or `payment_ref` to correlate across the pipeline.

Adding structured logging as a late-stage "nice to have" after the system is in production means you'll need to retrofit correlation IDs into every function call chain retroactively. This is more work and more risk than doing it upfront.

**How to avoid:**
1. Adopt a lightweight logger before any other hardening work. Use `pino` (already common in Next.js ecosystems). Add it to the shared package so all modules use the same logger.
2. Generate a `correlation_id` at each webhook entry point and thread it through every function call. Pass as a parameter or use AsyncLocalStorage.
3. Log structure minimum: `{ correlation_id, org_id, event_type, duration_ms, status, error? }`.
4. For Supabase operations, log the table name, operation, and row count returned — enough to detect silent failures (0 rows updated where 1 was expected).

**Warning signs:**
- Production incident that takes >30 minutes to diagnose because you can't trace a payment through the system.
- Logs showing errors without any context (no org, no client, no payment_ref).
- No way to search Vercel logs by org_id.

**Phase to address:** Observability Phase (should be first, before other hardening)

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip Stripe signature verification with TODO comment | Ship faster, test locally without CLI | Any actor can forge payments, create ghost clients | Never — one-line fix with `stripe.webhooks.constructEvent()` |
| Anonymous RLS `with check (true)` for widget | Widget works without auth complexity | Cross-org session injection, fake response submission | Never in production — scope to existing sessions |
| Sequential async operations without transaction | Simpler code | Orphaned records on partial failure, no rollback | Only for non-critical, fully idempotent ops |
| `body.org_id` fallback for auth | Easy local testing | Account takeover vector in production | Never — use a test API key instead |
| `console.error()` for all logging | Zero setup | Undiagnosable production incidents | Only in early local dev, not after first deploy |
| No idempotency key on webhook handlers | One less check | Duplicate clients, subscriptions on Stripe retry | Never — Stripe retries are guaranteed, not rare |
| Shared GHL credentials across all orgs | Simple configuration | Single credential compromise exposes all orgs | Only in v1 with very few trusted orgs, with a migration plan |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Stripe webhooks | `request.json()` before signature verification | Always `request.text()` first, then `stripe.webhooks.constructEvent(rawBody, sig, secret)` |
| Stripe webhooks | Returning 5xx on duplicate event | Return 200 with `{received: true}` — 5xx causes infinite retries |
| Stripe webhooks | Trusting `event.data.object` directly for state | Fetch the object from Stripe API (`stripe.subscriptions.retrieve(id)`) to get authoritative state |
| Supabase Realtime | Subscribing without a filter | Add `filter: "org_id=eq.${orgId}"` to avoid broadcasting all org data to all admin users |
| Supabase Realtime | RLS on high-frequency tables | Realtime evaluates RLS per subscriber per event — use broadcast for >10 events/sec |
| Twilio webhooks | Not validating on local dev | Use ngrok + Twilio webhook config, or stub the validator in test env |
| Widget (IIFE) | Assuming Shadow DOM prevents JS attacks | Shadow DOM is CSS isolation only. JS on host page can call your exported `window.LeadrWizard` API |
| GHL sub-account | Creating sub-account synchronously in payment handler | GHL API is slow and flaky. Move to async `service_task` with retry, same as A2P/GMB |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `outreach_queue` partial index missing `status='pending'` | Cron job progressively slows as queue grows | Add composite index: `CREATE INDEX ON outreach_queue(scheduled_at) WHERE status='pending'` | ~5k+ pending items |
| Agent context building: 6 separate Supabase queries per message | 500-2000ms response time per inbound SMS/voice | Cache context for 5s per `session_id` using in-memory map, or combine into single join query | Every message from day 1 |
| Dashboard queries computing KPIs in real-time | Dashboard load time degrades with client count | Use `analytics_snapshots` table (already exists), pre-compute hourly | ~500+ active onboarding sessions |
| Realtime subscription with per-row RLS evaluation | Dashboard stops updating, silently | Use filtered subscriptions + `org_id` index on `org_members` | ~20+ concurrent admin sessions |
| No database connection pooling | Cron overlap exhausts Supabase's ~20 connection limit | Use PgBouncer (available via Supabase Pooler endpoint) for cron endpoints | 2 cron jobs + 5 concurrent admin users |
| `supabase.from('x').select('*')` on JSONB-heavy tables | Large payload on every admin list view | Explicit column selection, paginate all list views | `required_data_fields` JSONB grows over time |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Stripe webhook without signature check (current state) | Fake payments create real org subscriptions | `stripe.webhooks.constructEvent()`, require `STRIPE_WEBHOOK_SECRET` |
| `body.org_id` fallback in payment webhook | Account takeover — create clients under any org | Delete the fallback, require API key or HMAC auth |
| Anonymous RLS `with check (true)` on sessions + responses | Cross-org data injection via widget | Scope to existing active session, move session creation server-side |
| GHL shared API key across all orgs | One compromise = all orgs' clients exposed | Per-org credentials stored encrypted in `organizations.settings` JSONB |
| Widget IIFE with no `allowedOrigins` check | Widget embedded on malicious sites | Add `allowedOrigins` to `init()`, validate `Origin` on API routes |
| Service role key used in cron endpoints | If leaked (e.g., via env var exposure), bypasses all RLS | Confirm cron endpoints use server client with anon key + service role only for admin-scoped operations; never log or return service role key |
| `STRIPE_API_KEY` in raw `fetch` calls | No library-level secret scrubbing, harder to audit | Use `stripe-node` SDK which scrubs secrets from error messages automatically |
| No rate limiting on public webhook endpoints | DoS via webhook spam, API quota exhaustion | Add Vercel Edge middleware rate limit by IP on `/api/webhooks/*` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Admin CRUD form submits with no loading state | Double-submits on slow connections, duplicate service definitions | Disable submit button on first click, re-enable on error response |
| Admin delete with no confirmation or undo | Accidental deletion of service definitions used in active packages | Show confirmation dialog with dependency count ("3 active packages use this service") |
| Widget form losing state on page reload | Client loses progress, frustration, abandonment | Persist form state to `session_responses` on every field blur, not just on "Next" button |
| Realtime dashboard update overwriting active admin form | Admin is mid-edit of a client; realtime update resets the form | Only update list views via realtime, not forms that are actively open |
| No feedback on widget voice mode failure | ElevenLabs beta drops connection silently, client sees blank | Always show fallback form if voice connection fails after 5s; log failure |

---

## "Looks Done But Isn't" Checklist

- [ ] **Stripe webhook**: Handler accepts requests but `stripe-signature` header is captured and immediately ignored. Looks like it "uses" the signature — verify `constructEvent()` is actually called.
- [ ] **Payment idempotency**: `payment_ref` column exists on `clients` but no UNIQUE constraint and no pre-insert lookup. Looks like deduplication is handled — verify a second identical webhook creates 0 new rows.
- [ ] **RLS hardening**: RLS is enabled with policies — looks secure. Verify that the `sessions_anon_insert` policy allows 0 cross-org inserts by testing with a fabricated `org_id` in the widget.
- [ ] **Widget shadow DOM**: Widget renders in shadow DOM — looks isolated. Verify that `window.LeadrWizard.init()` validates the calling origin before rendering.
- [ ] **GHL provisioning**: `provisionSubAccount()` is called in the payment handler — looks synchronous. Verify behavior when GHL API is slow (10s+ timeout) — does it block the payment handler response?
- [ ] **Structured logging**: Errors are logged — looks observable. Verify that each log line contains `org_id`, `client_id`, and `correlation_id` before declaring observability done.
- [ ] **Self-service org signup**: Stripe checkout → `checkout.session.completed` → org provisioned. Verify end-to-end with Stripe CLI: does a test payment actually create a usable org with admin access?
- [ ] **Multi-org isolation**: RLS policies exist — looks isolated. Verify with two test orgs that Org A's admin cannot see Org B's clients, sessions, or escalations via any Supabase query.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Stripe duplicate webhook created duplicate clients | MEDIUM | Write a migration script to deduplicate by `payment_ref` + `org_id`, keeping the oldest row. Update FK references. Add UNIQUE constraint after. |
| Anonymous RLS exploited — fake sessions inserted | MEDIUM | Delete sessions with no matching `client_packages` record. Add the scoped policy. Add an alert for anomalous session creation rate. |
| Payment handler partial failure — orphaned client | LOW | Admin dashboard: add a "no sessions" filter to find orphaned clients. Manual session creation UI for admin, or a repair script that creates the missing session + queues outreach. |
| `body.org_id` exploited — fake clients created under victim org | HIGH | Identify and delete fake client records by correlating with Stripe payment records. Notify affected org. Remove fallback auth immediately. Full audit of all client creation events. |
| Logging added too late — incident with no trace | HIGH | No recovery for lost history. Going forward: add structured logging + replay from Stripe dashboard webhook logs to reconstruct payment timeline. |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Stripe webhook signature verification missing | Stripe Integration Hardening | POST to `/api/webhooks/stripe` without valid signature → must return 401 |
| `body.org_id` auth fallback | Security Hardening | Request without API key/signature → 401 regardless of body content |
| Anonymous RLS session injection | RLS Hardening | Attempt to insert `onboarding_sessions` with fabricated `org_id` via anon Supabase client → must be rejected |
| Non-atomic payment handler | Stripe Integration Hardening | Simulate step 5 failure (session creation) → verify no orphaned client record |
| Stripe duplicate event | Stripe Integration Hardening | Send identical `checkout.session.completed` event twice → verify 1 subscription record, not 2 |
| Realtime RLS performance | Dashboard + Observability Phase | Subscribe 10 concurrent sessions → measure DB queries per event, must be <5 |
| Widget origin validation | Widget E2E Phase | Call `window.LeadrWizard.init()` from unlisted domain → widget renders nothing |
| Admin CRUD N+1 | Admin CRUD Phase | Profile page load in Supabase dashboard → must be <5 queries per list page |
| Admin CRUD race condition | Admin CRUD Phase | Two tabs edit same service definition simultaneously → second save shows conflict error |
| Logging too late | Observability Phase (first) | Every production log line must include `correlation_id` and `org_id` |
| GHL synchronous provisioning in payment handler | Stripe Integration Hardening | GHL API timeout → payment handler still returns within 5s, GHL task queued async |

---

## Sources

- Codebase direct inspection: `apps/admin/src/app/api/webhooks/stripe/route.ts`, `apps/admin/src/app/api/webhooks/payment/route.ts`, `packages/shared/src/automations/payment-handler.ts`, `supabase/migrations/00001_initial_schema.sql` lines 360-381
- `.planning/codebase/CONCERNS.md` — documented known issues (HIGH confidence, first-party analysis)
- [Stripe webhook best practices — Stigg post-mortem](https://www.stigg.io/blog-posts/best-practices-i-wish-we-knew-when-integrating-stripe-webhooks) (MEDIUM confidence, practitioner post-mortem)
- [Stripe official webhook docs](https://docs.stripe.com/webhooks) — idempotency, retry behavior, signature verification (HIGH confidence, official)
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests) (HIGH confidence, official)
- [Next.js App Router + Stripe signature verification](https://kitson-broadhurst.medium.com/next-js-app-router-stripe-webhook-signature-verification-ea9d59f3593f) — `request.text()` vs `request.json()` pitfall (MEDIUM confidence, verified against Stripe docs)
- [Supabase RLS best practices — MakerKit](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices) — anonymous access, null comparison failures (MEDIUM confidence, community)
- [Supabase official RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security) (HIGH confidence, official)
- [Supabase Realtime limits and RLS](https://supabase.com/docs/guides/realtime/limits) — per-subscriber RLS evaluation cost (HIGH confidence, official)
- [Realtime RLS silent drop bug](https://medium.com/@kidane10g/supabase-realtime-stops-working-when-rls-is-enabled-heres-the-fix-154f0b43c69a) (MEDIUM confidence, community)
- [PostMessage origin validation security](https://medium.com/@instatunnel/postmessage-vulnerabilities-when-cross-window-communication-goes-wrong-4c82a5e8da63) (MEDIUM confidence, community)
- [PostgreSQL zero-downtime migration patterns](https://medium.com/@QuarkAndCode/database-schema-design-zero-downtime-migrations-postgres-8a02a5b52033) (MEDIUM confidence)
- [Concurrent optimistic updates in React Query — TkDodo](https://tkdodo.eu/blog/concurrent-optimistic-updates-in-react-query) (HIGH confidence, authoritative source for TanStack Query)
- [Structured logging OpenTelemetry correlation IDs](https://oneuptime.com/blog/post/2026-02-06-otel-request-scoped-correlation-ids/view) (MEDIUM confidence)

---
*Pitfalls research for: AI-powered autonomous onboarding SaaS (LeadrWizard)*
*Researched: 2026-03-13*
