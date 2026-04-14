-- 00013_client_services_goosekit_job.sql
--
-- Goose Kit's backend is async: POST /build returns a job_id in <1s, and the
-- actual site generation + GitHub push + Vercel deploy happens over the next
-- several minutes. Callers poll GET /status/:id every ~3s until the status
-- hits a terminal state (READY or FAILED).
--
-- This migration adds four columns to `client_services` so we can:
--   1. Remember the job_id between page loads (so a refresh resumes polling).
--   2. Render live progress in the admin UI without re-hitting Goose Kit on
--      every navigation.
--   3. Store the final live_url on success and the error message on failure
--      so Greg has everything he needs on the client detail page.
--
-- Only the `website-build` service ever uses these columns. Nothing else
-- references them, so keeping them directly on `client_services` (instead of
-- a dedicated jobs table) is fine — one row per service, at most one active
-- build at a time, and the whole thing cascades on client deletion via the
-- existing FK.

ALTER TABLE client_services
  ADD COLUMN IF NOT EXISTS goosekit_job_id text,
  ADD COLUMN IF NOT EXISTS goosekit_job_status text,
  ADD COLUMN IF NOT EXISTS goosekit_live_url text,
  ADD COLUMN IF NOT EXISTS goosekit_error text;

-- Tell PostgREST to pick up the new columns immediately (so the admin app
-- doesn't need a restart to SELECT them).
NOTIFY pgrst, 'reload schema';
