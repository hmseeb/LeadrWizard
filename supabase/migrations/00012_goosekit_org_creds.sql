-- Migration: 00012_goosekit_org_creds.sql
-- Purpose: Add Goose Kit Website Builder credentials to organizations.
--          Goose Kit (https://goose-site-builder-production.up.railway.app) is a
--          second, alternative website-build option alongside the in-repo AI
--          builder. It's a bring-your-own-tokens orchestrator: each call needs
--          three downstream tokens passed through — GitHub PAT (to push the
--          generated site source), Vercel token (to deploy it), and an
--          Anthropic token (for content generation). All three are encrypted
--          at rest with the same AES-256-GCM scheme used for the other
--          per-org credentials.

-- ============================================================
-- Goose Kit credential columns on organizations
-- Values are AES-256-GCM encrypted strings in format: v1:iv:tag:ciphertext (all base64)
-- goosekit_base_url is the only non-secret plain-text field — it's overrideable
-- per-org but defaults to the Railway URL in application code if NULL.
-- ============================================================
alter table public.organizations
  add column if not exists goosekit_github_pat_encrypted text,
  add column if not exists goosekit_vercel_token_encrypted text,
  add column if not exists goosekit_claude_token_encrypted text,
  add column if not exists goosekit_base_url text;
