-- 00014_website_builder_preference_and_repo.sql
--
-- Two unrelated-but-small additions batched into one migration to keep
-- deploy churn down for the agency:
--
-- 1. `organizations.default_website_builder` — per-org preference for which
--    website builder (in-repo AI vs external Goose Kit) gets fired when a
--    client finishes onboarding. Defaults to 'ai' so existing orgs keep
--    their current behavior. Enforced as an enum via a CHECK constraint so
--    we can't accidentally store a typo like 'goose-kit' or 'goose'.
--
-- 2. `client_services.goosekit_repo_name` — the GitHub repo slug Goose Kit
--    created for a given build. Needed for the /edit endpoint, which
--    requires `repo_name` to target the existing repo instead of creating
--    a new one. Without this column every edit would have to re-derive the
--    slug from the business name, which breaks if Greg later renames the
--    business (slug drifts → edit hits a nonexistent repo).
--
-- Both columns are nullable and default-safe, so no data backfill is
-- required — the next build persists the repo name going forward, and
-- existing Goose Kit jobs from PR #15 still read/write job_id the same
-- way they always have.

alter table organizations
  add column if not exists default_website_builder text not null default 'ai'
    check (default_website_builder in ('ai', 'goosekit'));

alter table client_services
  add column if not exists goosekit_repo_name text;

-- Force PostgREST to re-introspect the schema so the admin's Supabase
-- client picks up the new columns without a redeploy. Same pattern as
-- migration 00013.
notify pgrst, 'reload schema';
