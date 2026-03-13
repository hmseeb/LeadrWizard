-- Migration: 00004_webhook_idempotency.sql
-- Purpose: Idempotency table for Stripe and payment webhook deduplication (SEC-02)

create table if not exists public.processed_webhook_events (
  id           text primary key,          -- Stripe event.id or payment webhook payment_ref
  source       text not null,             -- 'stripe' | 'payment'
  processed_at timestamptz not null default now(),
  payload      jsonb                      -- optional event summary for debugging
);

-- Only service role accesses this table — no RLS needed
-- Cleanup index to support periodic purging of old events
create index if not exists idx_processed_webhook_events_at
  on public.processed_webhook_events(processed_at);

comment on table public.processed_webhook_events is
  'Tracks processed webhook event IDs to prevent duplicate processing. Checked by stripe and payment webhook handlers.';
