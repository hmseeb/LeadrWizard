/**
 * Goose Kit Website Builder adapter.
 *
 * Thin wrapper around the Goose Kit REST API
 * (https://goose-site-builder-production.up.railway.app), reverse-engineered
 * from the reference frontend at https://github.com/gregmellott/goosekit-web-builder
 * (see src/lib/api.ts, src/types/index.ts, src/lib/constants.ts).
 *
 * The API is **asynchronous**:
 *   1. `POST /build` or `POST /redesign` → returns a `job_id` in <1s.
 *   2. Caller then polls `GET /status/:id` every ~3s until the job reaches a
 *      terminal state (`READY` or `FAILED`).
 *   3. On `READY` the response includes a `live_url` which is the Vercel
 *      deployment that Goose Kit just pushed.
 *
 * We do NOT block inside a server action until READY — the whole build
 * typically takes 3–10 minutes which blows past every Vercel function
 * timeout. Instead, the server action in the admin fires off `startBuild`
 * and returns the `job_id` immediately. The browser then drives polling
 * via a second server action that wraps `getJobStatus`. The job_id is
 * persisted on `client_services.goosekit_job_id` so polling resumes after
 * a page refresh.
 *
 * Goose Kit is a bring-your-own-tokens orchestrator: each call carries
 * three downstream credentials Goose Kit uses on our behalf —
 *   - `github_pat`         → pushes the generated source to a GitHub repo
 *   - `vercel_token`       → deploys that repo to the agency's Vercel
 *   - `claude_setup_token` → calls Claude to generate the site content
 * All three are required. These field names are the **real** ones from
 * the reference repo's `TokenSet` interface — the previous version of this
 * file guessed wrong (`claude_token`) which would have failed validation.
 *
 * SECURITY: never log or serialize credentials. The server action that
 * constructs `GoosekitCredentials` already pulls them from
 * `getOrgCredentials()` (encrypted-at-rest). Treat them like any other
 * bearer token — never echo to stdout, never include in error messages.
 */

const DEFAULT_BASE_URL =
  "https://goose-site-builder-production.up.railway.app";

// Match the frontend's 3s poll cadence; makes our UX feel identical to the
// Goose Kit dashboard and avoids hammering the Railway box.
export const GOOSEKIT_POLL_INTERVAL_MS = 3_000;

/**
 * Job statuses reported by Goose Kit's status endpoint. Mirrors the exact
 * enum in the reference frontend's `src/types/index.ts`. Terminal states
 * are `READY` and `FAILED`; everything else means the job is still moving.
 */
export type GoosekitJobStatus =
  | "VALIDATING"
  | "SCRAPING"
  | "CREATING_REPO"
  | "LINKING_VERCEL"
  | "BUILDING_SITE"
  | "EDITING_SITE"
  | "PUSHING_CODE"
  | "DEPLOYING"
  | "VERIFYING"
  | "READY"
  | "FAILED";

export const GOOSEKIT_TERMINAL_STATUSES: GoosekitJobStatus[] = [
  "READY",
  "FAILED",
];

/**
 * Human-readable labels for each job status. Mirrors the frontend's
 * `STATUS_LABELS` map — we show these verbatim in the admin so Greg's
 * progress line matches what Goose Kit's own UI says.
 */
export const GOOSEKIT_STATUS_LABELS: Record<GoosekitJobStatus, string> = {
  VALIDATING: "Validating tokens",
  SCRAPING: "Scraping website",
  CREATING_REPO: "Creating repository",
  LINKING_VERCEL: "Linking to Vercel",
  BUILDING_SITE: "Building site with AI",
  EDITING_SITE: "Editing site with AI",
  PUSHING_CODE: "Pushing code",
  DEPLOYING: "Deploying to Vercel",
  VERIFYING: "Verifying deployment",
  READY: "Ready",
  FAILED: "Failed",
};

/**
 * Structured client data we have on hand. This is the same shape the
 * in-repo AI builder accepts — `startGoosekitBuild` fills it from the
 * `resolveWebsiteBuildInput` helper in actions.ts and we assemble it into
 * Goose Kit's free-text `prompt` field via `buildPromptFromInput`.
 */
export interface GoosekitBuildInput {
  businessName: string;
  niche: string;
  servicesOffered: string;
  phone: string;
  email: string;
  tagline?: string;
  primaryColor?: string;
  logoUrl?: string;
  address?: string;
  aboutText?: string;
  /**
   * Client's existing website, if they already own one. When set, we route
   * to Goose Kit's `/redesign` endpoint instead of `/build` — `/redesign`
   * scrapes the URL to pull in real logo/colors/copy before generating.
   */
  existingWebsite?: string;
}

/**
 * Downstream credentials Goose Kit needs to do its job. All three are
 * required — the server action pre-flights this upstream.
 */
export interface GoosekitCredentials {
  /** API base URL. Defaults to the Railway URL if omitted. */
  baseUrl?: string;
  githubPat: string;
  vercelToken: string;
  /**
   * Goose Kit calls this `claude_setup_token` in its API body. The name
   * comes from the reference repo's `TokenSet` interface. What it actually
   * is (a plain Anthropic API key vs an OAuth setup token) is a Goose Kit
   * implementation detail — whatever Greg pastes here gets forwarded
   * verbatim in the request body.
   */
  claudeSetupToken: string;
}

/** Response from POST /build or POST /redesign — job started. */
export interface GoosekitJobCreateResult {
  jobId: string;
  status: GoosekitJobStatus;
  queuePosition?: number;
  raw: unknown;
}

/** Response from GET /status/:id — current state of a running job. */
export interface GoosekitJobStatusResult {
  jobId: string;
  status: GoosekitJobStatus;
  /** Set once status === "READY". */
  liveUrl?: string;
  /** Set once status === "FAILED". */
  error?: string;
  raw: unknown;
}

// -------------------- prompt assembly --------------------

/**
 * Assemble a natural-language prompt from the structured client data.
 * Goose Kit's `/build` endpoint takes exactly one free-text `prompt`
 * string; everything Claude reasons about has to live in here. We include
 * every non-empty field explicitly so the LLM has maximal context.
 *
 * Kept deterministic and boring on purpose — no LLM call, no fancy
 * templating, just a readable multi-line block. Easier to debug, easier
 * to test, easier to tweak when Greg wants to change the house style.
 */
export function buildPromptFromInput(input: GoosekitBuildInput): string {
  const lines: string[] = [];

  lines.push(
    `Build a modern, mobile-responsive marketing website for a small business.`
  );
  lines.push("");
  lines.push(`Business name: ${input.businessName}`);
  lines.push(`Industry / niche: ${input.niche}`);
  lines.push(`Services offered: ${input.servicesOffered}`);
  lines.push(`Contact phone: ${input.phone}`);
  lines.push(`Contact email: ${input.email}`);

  if (input.tagline) lines.push(`Tagline: ${input.tagline}`);
  if (input.address) lines.push(`Address: ${input.address}`);
  if (input.primaryColor)
    lines.push(`Primary brand color: ${input.primaryColor}`);
  if (input.logoUrl) lines.push(`Logo URL: ${input.logoUrl}`);
  if (input.aboutText) {
    lines.push("");
    lines.push(`About / company background:`);
    lines.push(input.aboutText);
  }

  if (input.existingWebsite) {
    lines.push("");
    lines.push(
      `The client already owns ${input.existingWebsite} — please keep the` +
        ` new site visually consistent with their existing brand (logo,` +
        ` color palette, tone of voice) wherever possible.`
    );
  }

  lines.push("");
  lines.push(
    `The site should include: a hero section with the tagline and a clear` +
      ` call-to-action to call the business, a services section listing` +
      ` each offering, an about section, a contact section with phone/` +
      `email/address, and a footer. Prioritize conversion — every page` +
      ` should make it obvious how to get in touch.`
  );

  return lines.join("\n");
}

/**
 * Derive a safe GitHub repo slug from the business name. Goose Kit will
 * accept whatever we pass here and use it as the repo name; keeping it
 * deterministic means re-running a build for the same client produces the
 * same repo (Goose Kit can decide whether to reuse or 409).
 *
 * Lowercases, replaces whitespace and punctuation with hyphens, strips
 * anything non [a-z0-9-], collapses repeated hyphens, and caps at 60
 * characters which is comfortably under GitHub's 100-char limit.
 */
export function deriveRepoName(businessName: string): string {
  const slug = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "goosekit-site";
}

// -------------------- HTTP helpers --------------------

function normalizeBaseUrl(creds: GoosekitCredentials): string {
  return (creds.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

async function goosekitFetch(
  url: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; rawText: string; parsed: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      // 15s is plenty for Goose Kit's own synchronous steps — job creation
      // and status reads both return in well under a second. The long tail
      // (3–10 minutes of actual generation + deploy) is handled by caller
      // polling, not by holding this request open.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Goose Kit request failed: ${msg}`);
  }

  const rawText = await response.text();
  let parsed: unknown = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    rawText,
    parsed,
  };
}

function assertJobStatus(value: unknown): GoosekitJobStatus {
  if (
    typeof value === "string" &&
    (GOOSEKIT_STATUS_LABELS as Record<string, string>)[value] !== undefined
  ) {
    return value as GoosekitJobStatus;
  }
  throw new Error(`Goose Kit returned an unknown job status: ${String(value)}`);
}

// -------------------- public API --------------------

/**
 * Liveness probe against Goose Kit. Useful for a "can we even reach the
 * backend?" diagnostic in Settings, and as a sanity check before starting
 * a build (though we don't currently call it in the happy path — Goose Kit
 * will tell us quickly enough if it's down).
 */
export async function goosekitHealthCheck(
  creds: GoosekitCredentials
): Promise<boolean> {
  const baseUrl = normalizeBaseUrl(creds);
  try {
    const { ok } = await goosekitFetch(`${baseUrl}/health`, { method: "GET" });
    return ok;
  } catch {
    return false;
  }
}

/**
 * Kick off a new website build job. Returns the job_id immediately —
 * the caller is responsible for polling `getGoosekitJobStatus` until
 * terminal.
 *
 * Auto-routes between two Goose Kit endpoints based on whether the client
 * has an existing website:
 *   - `POST /build`    → generate from scratch
 *   - `POST /redesign` → scrape `existingWebsite` first, then rebuild
 *
 * `/redesign` is the right call when we have an existing URL because it's
 * the specific endpoint that tells Goose Kit to pull in the client's real
 * brand (logo/colors/copy) instead of generating everything from the
 * prompt alone.
 */
export async function initiateGoosekitBuild(
  input: GoosekitBuildInput,
  creds: GoosekitCredentials
): Promise<GoosekitJobCreateResult> {
  const baseUrl = normalizeBaseUrl(creds);
  const prompt = buildPromptFromInput(input);
  const repoName = deriveRepoName(input.businessName);

  const tokens = {
    github_pat: creds.githubPat,
    vercel_token: creds.vercelToken,
    claude_setup_token: creds.claudeSetupToken,
  };

  // Pick the endpoint + body shape up front. Goose Kit's `/redesign`
  // requires `website_url` and `repo_name`; `/build` only requires `prompt`.
  const hasExisting = !!(input.existingWebsite && input.existingWebsite.trim());
  const url = hasExisting ? `${baseUrl}/redesign` : `${baseUrl}/build`;
  const body: Record<string, unknown> = hasExisting
    ? {
        ...tokens,
        repo_name: repoName,
        website_url: input.existingWebsite!.trim(),
        prompt,
      }
    : {
        ...tokens,
        prompt,
        repo_name: repoName,
      };

  const { ok, status, rawText, parsed } = await goosekitFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!ok) {
    // Scrub credentials from the error surface. The request body we echoed
    // into the error has the tokens in it — do NOT include it here.
    const detail = rawText.slice(0, 500) || `HTTP ${status}`;
    throw new Error(`Goose Kit ${hasExisting ? "redesign" : "build"} request failed (HTTP ${status}): ${detail}`);
  }

  const r = (parsed ?? {}) as Record<string, unknown>;
  const jobId = typeof r.id === "string" ? r.id : null;
  if (!jobId) {
    throw new Error(
      `Goose Kit did not return a job id. Response: ${rawText.slice(0, 500)}`
    );
  }

  return {
    jobId,
    status: assertJobStatus(r.status),
    queuePosition:
      typeof r.queue_position === "number" ? r.queue_position : undefined,
    raw: parsed,
  };
}

/**
 * Ask Goose Kit to edit an already-built site. Matches the reference
 * frontend's `editSite()` in `src/lib/api.ts` — POST /edit with the
 * three tokens, the existing `repo_name`, a free-text `prompt` describing
 * the desired change, and an optional `images` array for reference
 * material.
 *
 * Like `/build` and `/redesign`, this is an **async** endpoint: it
 * returns a `job_id` in <1s and the actual Claude edit + git push +
 * Vercel redeploy happens over the next several minutes. The caller
 * polls `getGoosekitJobStatus` the same way until terminal — the job
 * walks the same state machine (VALIDATING → EDITING_SITE → PUSHING_CODE
 * → DEPLOYING → VERIFYING → READY | FAILED) and returns the same live
 * URL when done.
 *
 * The `instructions` parameter is the only required payload beyond
 * tokens + repo_name. It's a natural-language description of what Greg
 * wants changed — e.g. "Make the hero headline more urgent and change
 * the primary color to emerald green" — and gets handed verbatim to
 * Claude, so it's fine (and encouraged) to be specific and
 * prescriptive.
 *
 * NOTE: `repo_name` must match whatever was persisted on the original
 * build's `client_services.goosekit_repo_name`. If you re-derive from
 * the business name and the business has been renamed since the build,
 * the slug drifts and the /edit call lands on a nonexistent repo.
 */
export async function editGoosekitSite(
  repoName: string,
  instructions: string,
  creds: GoosekitCredentials,
  images?: string[]
): Promise<GoosekitJobCreateResult> {
  const baseUrl = normalizeBaseUrl(creds);

  const body: Record<string, unknown> = {
    github_pat: creds.githubPat,
    vercel_token: creds.vercelToken,
    claude_setup_token: creds.claudeSetupToken,
    repo_name: repoName,
    prompt: instructions,
  };
  if (images && images.length > 0) {
    body.images = images;
  }

  const { ok, status, rawText, parsed } = await goosekitFetch(
    `${baseUrl}/edit`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!ok) {
    const detail = rawText.slice(0, 500) || `HTTP ${status}`;
    throw new Error(`Goose Kit edit request failed (HTTP ${status}): ${detail}`);
  }

  const r = (parsed ?? {}) as Record<string, unknown>;
  const jobId = typeof r.id === "string" ? r.id : null;
  if (!jobId) {
    throw new Error(
      `Goose Kit did not return a job id for /edit. Response: ${rawText.slice(0, 500)}`
    );
  }

  return {
    jobId,
    status: assertJobStatus(r.status),
    queuePosition:
      typeof r.queue_position === "number" ? r.queue_position : undefined,
    raw: parsed,
  };
}

/**
 * Poll the current status of a running job. Call this on a ~3s interval
 * from the caller until `GOOSEKIT_TERMINAL_STATUSES.includes(status)`.
 *
 * On success with status === "READY", `liveUrl` is the deployed preview.
 * On status === "FAILED", `error` is a human-readable reason from Goose
 * Kit — surface it to the UI and open an escalation so Greg can debug.
 */
export async function getGoosekitJobStatus(
  jobId: string,
  creds: GoosekitCredentials
): Promise<GoosekitJobStatusResult> {
  const baseUrl = normalizeBaseUrl(creds);
  // Goose Kit's /status/:id does not require tokens in the query, but the
  // reference frontend talks through a Next rewrite which hides auth. We
  // pass a header bag with the tokens just in case the backend ever
  // enforces — harmless if ignored.
  const { ok, status, rawText, parsed } = await goosekitFetch(
    `${baseUrl}/status/${encodeURIComponent(jobId)}`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    }
  );

  if (!ok) {
    throw new Error(
      `Goose Kit status poll failed (HTTP ${status}): ${rawText.slice(0, 500)}`
    );
  }

  const r = (parsed ?? {}) as Record<string, unknown>;
  return {
    jobId: typeof r.id === "string" ? r.id : jobId,
    status: assertJobStatus(r.status),
    liveUrl: typeof r.live_url === "string" ? r.live_url : undefined,
    error: typeof r.error === "string" ? r.error : undefined,
    raw: parsed,
  };
}
