/**
 * Goose Kit Website Builder adapter.
 *
 * Thin wrapper around the Goose Kit REST API
 * (https://goose-site-builder-production.up.railway.app). Used as a second,
 * alternative website-build path alongside the in-repo `website-builder.ts`
 * that Greg can pick per-client.
 *
 * Goose Kit is a bring-your-own-tokens orchestrator: each `POST /build` call
 * carries three downstream credentials that Goose Kit uses on our behalf —
 *   - `githubPat`  → pushes the generated source to a GitHub repo
 *   - `vercelToken`→ deploys that repo to the agency's Vercel account
 *   - `claudeToken`→ calls Claude to generate the site content
 * All three are required. Goose Kit then returns a preview URL synchronously
 * once the build and deploy finishes.
 *
 * Only `POST /build` is wired up for now. `POST /redesign` and `POST /edit`
 * will come in a later PR once the happy path is proven.
 *
 * SECURITY: never log or serialize the credentials in `GoosekitCredentials`.
 * The server action that constructs these credentials already pulls them
 * from `getOrgCredentials()` (encrypted-at-rest). Treat them like any other
 * bearer token — never echo to stdout, never include in error messages.
 */

const DEFAULT_BASE_URL =
  "https://goose-site-builder-production.up.railway.app";

/**
 * Request-time build input. Mirrors the `WebsiteBuildData` shape used by the
 * in-repo builder so both server actions can share upstream data resolution.
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
   * Client's existing website, if they already own one. Goose Kit can scrape
   * this for logo, colors, and copy so the new build stays visually
   * consistent with the client's existing brand.
   */
  existingWebsite?: string;
}

/**
 * Downstream credentials Goose Kit needs to do its job. All three are
 * required — the server action pre-flights this and returns a clean
 * "not configured" error upstream if any are missing, so this module can
 * assume they're present.
 */
export interface GoosekitCredentials {
  /** API base URL. Defaults to the Railway URL if omitted. */
  baseUrl?: string;
  githubPat: string;
  vercelToken: string;
  claudeToken: string;
}

/**
 * Shape the wrapper returns on a successful build.
 * `raw` is kept so callers can diagnose shape drift without another round
 * trip, and so we can iterate on which top-level field actually holds the
 * preview URL without breaking the signature.
 */
export interface GoosekitBuildResult {
  previewUrl: string;
  buildId?: string;
  raw: unknown;
}

/**
 * Shape the wrapper accepts in the body. Best-guess `snake_case` that
 * matches most REST conventions; we'll tighten once we've confirmed Goose
 * Kit's exact contract. The function names are chosen so a 400 from Goose
 * Kit will clearly point at which mapping needs adjusting.
 */
interface GoosekitBuildRequestBody {
  // Project / business
  business_name: string;
  niche: string;
  services_offered: string;
  phone: string;
  email: string;
  tagline?: string;
  primary_color?: string;
  logo_url?: string;
  address?: string;
  about_text?: string;
  existing_website?: string;

  // Downstream credentials Goose Kit uses on our behalf
  github_pat: string;
  vercel_token: string;
  claude_token: string;
}

function buildRequestBody(
  input: GoosekitBuildInput,
  creds: GoosekitCredentials
): GoosekitBuildRequestBody {
  const body: GoosekitBuildRequestBody = {
    business_name: input.businessName,
    niche: input.niche,
    services_offered: input.servicesOffered,
    phone: input.phone,
    email: input.email,
    github_pat: creds.githubPat,
    vercel_token: creds.vercelToken,
    claude_token: creds.claudeToken,
  };
  if (input.tagline) body.tagline = input.tagline;
  if (input.primaryColor) body.primary_color = input.primaryColor;
  if (input.logoUrl) body.logo_url = input.logoUrl;
  if (input.address) body.address = input.address;
  if (input.aboutText) body.about_text = input.aboutText;
  if (input.existingWebsite) body.existing_website = input.existingWebsite;
  return body;
}

/**
 * Extract a preview URL from the various shapes Goose Kit might return.
 * Tries the obvious top-level keys first, then falls back to a shallow
 * walk. Returns null if nothing plausible is found — caller reports it.
 */
function extractPreviewUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const candidates = [
    "preview_url",
    "previewUrl",
    "deployment_url",
    "deploymentUrl",
    "url",
    "live_url",
    "liveUrl",
  ];
  for (const key of candidates) {
    const v = r[key];
    if (typeof v === "string" && v.startsWith("http")) return v;
  }
  // Shallow nested: { data: { url: ... } } / { result: { url: ... } }
  for (const nestedKey of ["data", "result", "deployment", "site"]) {
    const nested = r[nestedKey];
    if (nested && typeof nested === "object") {
      const found = extractPreviewUrl(nested);
      if (found) return found;
    }
  }
  return null;
}

function extractBuildId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  for (const key of ["build_id", "buildId", "id", "job_id", "jobId"]) {
    const v = r[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

/**
 * POST /build — synchronously asks Goose Kit to generate + deploy a site
 * for the provided input, using the provided downstream credentials.
 *
 * Throws on any non-2xx, on a missing preview URL in the response body,
 * and on network/timeout errors. Callers should wrap this in try/catch
 * and surface the error message to the UI via the `{ ok: false }` shape.
 */
export async function initiateGoosekitBuild(
  input: GoosekitBuildInput,
  creds: GoosekitCredentials
): Promise<GoosekitBuildResult> {
  const baseUrl = (creds.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = `${baseUrl}/build`;
  const body = buildRequestBody(input, creds);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      // 60s is aggressive but keeps us inside Vercel's function limit. If
      // builds routinely exceed this we'll move to an async polling model
      // against `GET /status/:id`.
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Goose Kit request failed: ${msg}`);
  }

  // Read the body once as text so we can include it in error messages
  // regardless of whether Goose Kit returned JSON or not.
  const rawText = await response.text();
  let parsed: unknown = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const detail = rawText.slice(0, 500) || response.statusText;
    throw new Error(
      `Goose Kit build failed (HTTP ${response.status}): ${detail}`
    );
  }

  const previewUrl = extractPreviewUrl(parsed);
  if (!previewUrl) {
    throw new Error(
      `Goose Kit build returned no preview URL. Response: ${rawText.slice(0, 500)}`
    );
  }

  return {
    previewUrl,
    buildId: extractBuildId(parsed),
    raw: parsed,
  };
}
