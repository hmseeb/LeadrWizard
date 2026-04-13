-- Migration: 00010_ignite_subscription_model.sql
-- Purpose: Support monthly-recurring packages (IGNITE $297/mo, DOMINATE $997/mo).
--          Add client subscription lifecycle columns driven by the payment provider.
--          Add credential columns for GHL snapshot, Vercel, and Linked2Checkout.

-- ============================================================
-- service_packages: recurring billing interval
-- 'one_time' preserves existing semantics; 'monthly' / 'yearly' are new.
-- ============================================================
alter table public.service_packages
  add column if not exists price_interval text not null default 'one_time'
    check (price_interval in ('one_time', 'monthly', 'yearly'));

-- ============================================================
-- client_packages: subscription lifecycle
-- Driven by payment-provider webhooks (Linked2Checkout rebill events).
-- ============================================================
alter table public.client_packages
  add column if not exists status text not null default 'active'
    check (status in ('active', 'past_due', 'cancelled', 'suspended')),
  add column if not exists external_subscription_id text,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancelled_at timestamptz;

create index if not exists idx_client_packages_status
  on public.client_packages(status)
  where status <> 'active';

create index if not exists idx_client_packages_external_sub
  on public.client_packages(external_subscription_id)
  where external_subscription_id is not null;

-- ============================================================
-- organizations: additional credential columns
-- GHL snapshot ID is a plain identifier (not a secret).
-- Vercel and Linked2Checkout API keys are encrypted (AES-256-GCM v1:iv:tag:ciphertext).
-- Merchant IDs, team IDs, and product IDs are plain text.
-- ============================================================
alter table public.organizations
  add column if not exists ghl_snapshot_id text,
  add column if not exists vercel_token_encrypted text,
  add column if not exists vercel_team_id text,
  add column if not exists linked2checkout_api_key_encrypted text,
  add column if not exists linked2checkout_webhook_secret_encrypted text,
  add column if not exists linked2checkout_merchant_id text,
  add column if not exists linked2checkout_product_id_ignite text;
