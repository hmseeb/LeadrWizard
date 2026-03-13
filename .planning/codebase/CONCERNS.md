# Codebase Concerns

**Analysis Date:** 2026-03-13

## Tech Debt

**Incomplete Stripe Integration:**
- Issue: Stripe webhook handler at `apps/admin/src/app/api/webhooks/stripe/route.ts` does not verify webhook signatures. It parses events directly without validation against `STRIPE_WEBHOOK_SECRET`.
- Files: `apps/admin/src/app/api/webhooks/stripe/route.ts` (line 14-22), `packages/shared/src/billing/stripe-adapter.ts`
- Impact: Unauthenticated actors can forge Stripe webhook events and trigger fake payments, creating ghost clients and initiating onboarding for non-existent purchases. High security risk.
- Fix approach: Implement `stripe.webhooks.constructEvent(body, sig, webhookSecret)` for signature verification before processing. See `apps/admin/src/app/api/webhooks/payment/route.ts` (lines 124-151) for the correct pattern already in use.

**Missing Database Indexes for Scaling:**
- Issue: `outreach_queue` table has a partial index on `(scheduled_at)` but the query at `packages/shared/src/comms/outreach-processor.ts:19-25` also filters on `status='pending'` which is not indexed. Heavy cron loads will cause sequential scans.
- Files: `supabase/migrations/00001_initial_schema.sql:279`, `packages/shared/src/comms/outreach-processor.ts:19-25`
- Impact: Outreach processing slows down linearly as queue grows. At 10k+ pending items, cron job can timeout.
- Fix approach: Add composite index: `CREATE INDEX idx_outreach_queue_pending_scheduled ON outreach_queue(scheduled_at) WHERE status='pending'`. Repeat for `service_tasks` table which has similar pattern at line 25-27 of `task-processor.ts`.

**Unvalidated Environment Variables at Runtime:**
- Issue: Multiple modules call `process.env.XYZ` without initialization guards. If required env vars are missing, errors only surface when that code path runs, not at startup.
- Files: `packages/shared/src/comms/twilio-sms.ts:37-48`, `packages/shared/src/automations/gmb-manager.ts:42-50`, `packages/shared/src/automations/ghl-adapter.ts:30-35`, `packages/shared/src/automations/website-builder.ts:36-42`
- Impact: Silent failures in cron jobs. A misconfigured deployment may work for weeks until someone tries to send an SMS or trigger a service task.
- Fix approach: Create a shared `validateEnv()` function that runs at app startup (in `apps/admin/src/app/layout.tsx` and during widget boot) and checks all critical vars. Throw early if missing.

**Weak Error Handling in Async Task Processing:**
- Issue: `packages/shared/src/automations/task-processor.ts:56-62` and `outreach-processor.ts:46-62` retry failed tasks with simple exponential backoff (5 min, then next check_at). No circuit breaker, no max backoff cap, no dead letter queue.
- Files: `packages/shared/src/automations/task-processor.ts:56-93`, `packages/shared/src/comms/outreach-processor.ts:46-62`
- Impact: If an external API goes down (Twilio, Vapi, Vercel), the system will hammer it with retries forever, wasting resources and hitting rate limits. Tasks marked "failed" after 3 attempts are lost.
- Fix approach: Add exponential backoff with jitter (5s, 30s, 5m, 30m max). Create `dead_letter_queue` table for tasks that fail 5+ times. Implement per-service rate limit tracking.

## Known Issues

**GMB OAuth Token Expiration Not Handled:**
- Symptoms: `checkGMBAccessStatus()` fails silently if refresh token is revoked or expired. Returns `null` status with no escalation.
- Files: `packages/shared/src/automations/gmb-manager.ts:56-80`, `packages/shared/src/automations/gmb-manager.ts:131-137` (returns null), `packages/shared/src/automations/gmb-manager.ts:167`
- Trigger: Refresh token revoked → cron calls `checkGMBAccessStatus()` → `getAccessToken()` throws or returns 401 → caught at line 337-356 (silently) → task stuck in `in_progress` forever
- Workaround: Manual escalation after 48h. Monitor logs for "Google OAuth token refresh failed".
- Fix: Catch 401/403 errors specifically and create escalation with instructions to re-authenticate.

**Website Revision Loop Infinite:**
- Symptoms: Client approves website but approval message never recorded, client stays in `preview_sent` state forever despite limit being 48h.
- Files: `packages/shared/src/automations/task-processor.ts:95-110`, `packages/shared/src/automations/website-builder.ts` (no approval handler)
- Trigger: No webhook or response handler for website approval. Preview sent, client clicks "Approve" in widget, but nothing happens.
- Workaround: Agency manually marks task as `delivered`.
- Fix: Add website approval handler to capture form submission and update task status. Implement max 3 revision rounds as documented.

**RLS Policies Allow Anonymous Session Writes (XSS/CSRF Risk):**
- Symptoms: Any client can create/update `onboarding_sessions` and `session_responses` without authentication. Combined with widget XSS, could allow tampering.
- Files: `supabase/migrations/00001_initial_schema.sql:361-365` (sessions_anon_insert/update), `supabase/migrations/00001_initial_schema.sql:368-369` (responses_anon_insert)
- Impact: Widget XSS allows attacker to create fake sessions for other clients, record false responses, escalate fake issues.
- Current mitigation: Session ID is UUID (hard to guess). Widget runs in Shadow DOM (limited XSS surface).
- Fix: Sessions should only be insertable via API with org_id validation, not anonymous. Responses should validate they're for an existing session.

## Security Considerations

**Twilio Webhook Signature Validation Implemented But Payment Webhook Uses Fallback Logic:**
- Risk: `apps/admin/src/app/api/webhooks/payment/route.ts:52-66` only validates HMAC if `PAYMENT_WEBHOOK_SECRET` is set. Falls back to API key lookup if secret is missing.
- Files: `apps/admin/src/app/api/webhooks/payment/route.ts:52-66`, `apps/admin/src/app/api/webhooks/payment/route.ts:88-119`
- Current mitigation: API key lookup adds org verification. But if both secret and key are missing, line 114 allows explicit `body.org_id`, opening account takeover.
- Recommendations:
  1. Require signature verification always (don't make it optional)
  2. Remove fallback to `body.org_id` — never trust request body for auth
  3. Require X-API-Key header and look it up against org config

**Stripe API Key Passed in Plain HTTP Requests:**
- Risk: Every Stripe API call at `packages/shared/src/billing/stripe-adapter.ts:44-66` includes `Authorization: Bearer sk_...` over HTTPS, but if TLS is compromised, key is leaked. No separation of concerns.
- Files: `packages/shared/src/billing/stripe-adapter.ts:44-66`
- Current mitigation: Only runs on server (Next.js API routes), not exposed to client.
- Recommendations:
  1. Use Stripe client library (stripe-node) instead of raw fetch
  2. Store STRIPE_SECRET_KEY only in server-side secrets, never in client bundles
  3. Log all Stripe API calls with sanitized secrets for audit

**GHL API Credentials in Environment Variables Shared Across All Orgs:**
- Risk: Single `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_COMPANY_ID` shared by all organizations. If compromised, attacker can modify all client data across all orgs.
- Files: `packages/shared/src/automations/ghl-adapter.ts:30-35`
- Current mitigation: Multi-tenant design; RLS prevents cross-org reads. But API level has no per-org controls.
- Recommendations:
  1. Store per-org GHL credentials in database (organizations table as JSONB secrets)
  2. Decrypt at runtime using org-specific key
  3. Implement GHL sub-account API instead of shared account

**Widget Can Be Embedded on Untrusted Domains:**
- Risk: `apps/widget/src/main.tsx` has no domain allowlist. Any site can embed and access session data.
- Files: `apps/widget/src/main.tsx`
- Current mitigation: Data is scoped to specific session_id (UUID). Widget uses Shadow DOM to isolate styles.
- Recommendations:
  1. Add `Referrer-Policy: strict-origin-when-cross-origin` header to widget CDN
  2. Implement optional `allowedOrigins` parameter in `LeadrWizardAPI.init()`
  3. Log embeds from unexpected domains

## Performance Bottlenecks

**Outreach Queue Not Batched — Processes 50 Items Per Cron Run:**
- Problem: `processOutreachQueue()` limits to 50 items (line 26). If 200 messages scheduled, they spread across 4 cron runs (8+ minutes delay).
- Files: `packages/shared/src/comms/outreach-processor.ts:26`
- Cause: Tries to be cautious about resource usage, but undershoots practical limits.
- Improvement path: Batch by channel (send all SMS in parallel, all calls sequentially). Move limit to 200-500 based on load testing. Use Promise.all() for parallel sends.

**GMB Access Request Check Hits Google API Every 15 Minutes:**
- Problem: `checkGMBAccessStatus()` makes OAuth request + API call for every pending GMB task, even if nothing changed.
- Files: `packages/shared/src/automations/gmb-manager.ts:56-80`, `packages/shared/src/automations/task-processor.ts:52-61`
- Cause: Google doesn't provide webhooks; polling is only option.
- Improvement path: Increase polling interval from 15m → 1h after first 24h. Add exponential backoff (check at 15m, 30m, 1h, 2h, 4h, then daily).

**Dashboard Queries Don't Use Materialized Views for Analytics:**
- Problem: `apps/admin/src/app/(dashboard)/dashboard/page.tsx` likely runs multiple individual queries to compute KPI cards (active sessions, completion %, channel breakdown).
- Files: Not visible but likely dashboard/page.tsx, `supabase/migrations/00002_pg_cron_jobs.sql` (only defines `analytics_snapshots` table)
- Cause: Real-time queries compete with outreach processing for database connections.
- Improvement path: Use existing `analytics_snapshots` table more aggressively. Pre-compute hourly aggregates. Add read replicas for analytics queries.

**Service Task Polling Inefficient for Website Generation:**
- Problem: Website generation task stored in `service_tasks` but UI approval workflow separate. Cron checks every 15m if "preview_sent" → 48h without updating.
- Files: `packages/shared/src/automations/task-processor.ts:95-110`
- Cause: No webhook or event stream for widget approval.
- Improvement path: Move website approval to Supabase real-time subscriptions. Client approves → widget sends API call → task marked delivered immediately.

## Fragile Areas

**Payment Handler Initialization Sequence Not Atomic:**
- Files: `packages/shared/src/automations/payment-handler.ts:33-140`
- Why fragile: Creates client → package → services → GHL sub-account → GHL snapshot → session → queues outreach. If step 4 fails, steps 1-3 are orphaned. If step 6 fails, no SMS sent but client exists.
- Safe modification: Wrap entire flow in transaction if possible. More likely: add explicit rollback logic or saga pattern. Document expected idempotency per step.
- Test coverage: Only `handlePaymentWebhook()` is tested; no chaos test for partial failures.

**Agent Router Context Building Queries Are Not Cached:**
- Files: `packages/shared/src/agent/agent-context.ts:buildAgentContext()` calls ~6 separate Supabase queries (client, services, responses, tasks, interactions)
- Why fragile: Called on every message (SMS reply, voice webhook, widget submit). High latency if client has many responses/interactions.
- Safe modification: Add memoization layer. Cache context for 5s per session_id. Invalidate on response insert.
- Test coverage: No performance tests; likely 500-2000ms latency already.

**Vapi Voice Webhook Processing Assumes Function Call Order:**
- Files: `packages/shared/src/comms/vapi-calls.ts:215-300` (approximate, based on similar patterns)
- Why fragile: If Vapi sends tool calls out of order (e.g., escalateToHuman before recordAnswer), state is inconsistent. No strict sequencing.
- Safe modification: Validate call order or store all calls, then execute in dependency order.
- Test coverage: No integration tests with actual Vapi responses.

## Scaling Limits

**Single Twilio Phone Number for All Organizations:**
- Current capacity: ~1000 SMS/min per number (Twilio soft limit). System can handle ~200 clients/day.
- Limit: Beyond 500 clients/org, SMS delivery delays accumulate. At 5 orgs × 500 = 2500 clients, SMS queue backs up significantly.
- Scaling path: Implement per-org phone number provisioning in `organizations` table. Update `comms/twilio-sms.ts` to use org-specific number. Requires coordination with account scaling.

**Single GHL Agency Account with Sub-accounts:**
- Current capacity: GHL limits ~200-500 active sub-accounts per agency.
- Limit: Beyond 500 clients across all orgs, GHL sub-account creation fails or slows. Contact sync becomes unreliable.
- Scaling path: Implement per-org GHL agency account. Store credentials in org table. Requires multi-GHL account orchestration.

**Database Connection Pool Exhaustion Under Load:**
- Current capacity: Supabase defaults to ~20 connections. Each cron run (outreach + tasks) can use 5-10.
- Limit: At 2-minute cron frequency + 15-minute task frequency overlapping, connection pool exhausted. Queries queue/timeout.
- Scaling path: Increase Supabase connection pool to 50-100. Implement connection pooling middleware (PgBouncer). Add queue depth monitoring.

**Single Vercel Account for All Website Deployments:**
- Current capacity: Vercel allows ~500 deployments/day on free/pro plan.
- Limit: At 50 clients/day with 3 revision rounds = 150 deployments/day acceptable, but reserved deployments reserved for other projects.
- Scaling path: Implement custom subdomain caching. Move templates to CDN. Consider static site generation (SSG) instead of per-client deploys.

## Dependencies at Risk

**Anthropic Claude Model Version Pinned to claude-sonnet-4-20250514:**
- Risk: If this model is deprecated, website generation and agent prompting break. No fallback model specified.
- Impact: Website builder stops working. Conversation quality degrades if forced to older model.
- Migration plan: Abstract model selection into config. Implement model version negotiation. Test with claude-3-sonnet-20250219 as fallback.
- Files: `packages/shared/src/automations/website-builder.ts:96`, `packages/shared/src/comms/vapi-calls.ts` (likely hardcoded)

**ElevenLabs Conversational AI Widget Beta:**
- Risk: ElevenLabs real-time API is beta. Features or pricing may change. Deprecated without migration path.
- Impact: Browser-based voice feature disappears. Clients can't use in-widget voice anymore.
- Migration plan: Already have Vapi fallback for phone calls. Implement Vapi WebSocket for browser voice too.
- Files: `apps/widget/src/components/VoiceBot.tsx`

**Supabase pg_cron Dependency:**
- Risk: pg_cron is PostgreSQL extension. If Supabase deprecates or doesn't support in newer versions, cron jobs must move to external scheduler.
- Impact: Outreach and task processing requires manual Edge Function trigger or external cron service.
- Migration plan: Add Health Check endpoint. Implement AWS Lambda / Google Cloud Run scheduler as backup.
- Files: `supabase/migrations/00002_pg_cron_jobs.sql`

## Missing Critical Features

**No Retry-After / Rate Limiting for External APIs:**
- Problem: When Twilio, Vapi, or Vercel rate limit requests, system has no backoff strategy.
- Blocks: Cannot scale to high throughput without hitting limits. No telemetry to warn operators.
- Recommended: Implement exponential backoff decorator. Add Prometheus metrics for rate limit headers. Alert when > 5% of requests are rate-limited.
- Files: `packages/shared/src/comms/`, `packages/shared/src/automations/`

**No Idempotency Keys for Critical Operations:**
- Problem: Payment webhook can be received twice. Creates duplicate client + session.
- Blocks: Retry safety not guaranteed. Operator confidence low.
- Recommended: Add `idempotency_key` parameter to payment handler. Store in database. Return cached response if duplicate.
- Files: `apps/admin/src/app/api/webhooks/payment/route.ts`, `packages/shared/src/automations/payment-handler.ts`

**No Rate Limiting on Public Webhook Endpoints:**
- Problem: Anyone can spam `/api/webhooks/payment` with fake requests.
- Blocks: DOS attack surface. No throttling.
- Recommended: Implement rate limiting by IP or API key. Add Cloudflare or middleware rate limit.
- Files: `apps/admin/src/app/api/webhooks/`

**No Structured Logging / Observability:**
- Problem: Errors logged with `console.error()`. No tracing, no metrics, no correlation IDs.
- Blocks: Hard to debug production issues. No performance visibility.
- Recommended: Integrate with Sentry (error tracking) + PostHog / Datadog (observability). Add correlation_id to all logs.
- Files: All

## Test Coverage Gaps

**No E2E Tests for Cron Jobs:**
- What's not tested: Full outreach queue → SMS send → interaction log flow. Task processor polling for A2P/GMB.
- Files: `packages/shared/src/comms/outreach-processor.ts`, `packages/shared/src/automations/task-processor.ts`
- Risk: Cron job can break silently in production for days before noticed. Currently only 6 test files.
- Priority: High
- Suggested test: Create test session → queue outreach → mock Twilio → verify SMS sent + logged.

**No Tests for Payment Webhook Edge Cases:**
- What's not tested: Duplicate webhook. Missing fields. API key mismatch. GHL provisioning failure.
- Files: `apps/admin/src/app/api/webhooks/payment/route.ts`, `packages/shared/src/automations/payment-handler.ts`
- Risk: Payment flow breaks for some customers unnoticed.
- Priority: High
- Suggested test: Parameterized tests for 10+ failure scenarios.

**No Tests for Multi-Org Isolation (RLS):**
- What's not tested: User from org_a reading org_b data. API key from org_a triggering payment for org_b.
- Files: `supabase/migrations/00001_initial_schema.sql` (RLS policies), payment webhook
- Risk: Data leak between organizations.
- Priority: Critical
- Suggested test: Integration test with two orgs, verify cross-org queries fail.

**No Load Tests:**
- What's not tested: Outreach queue processing at 500 items. Dashboard with 10k clients. Concurrent voice calls.
- Files: N/A (no load tests exist)
- Risk: System might fail at 2x current load without warning.
- Priority: Medium
- Suggested test: k6 or Artillery script simulating 100 concurrent onboarding sessions.

---

*Concerns audit: 2026-03-13*
