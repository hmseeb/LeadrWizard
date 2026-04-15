import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrgCredentials } from "@leadrwizard/shared/tenant";

/**
 * Shape returned to API routes that need to talk to the GHL Agency API.
 * `source` is mostly for logging/debugging so we can tell which path won.
 */
export interface ResolvedGhlCredentials {
  apiKey: string;
  companyId: string | null;
  source: "org" | "org-fallback" | "env";
}

/**
 * Resolve the GHL Agency API key for an org, tolerating a stale / unreadable
 * encrypted blob in the database.
 *
 * The admin `Link GHL sub-account` flow used to hard-fail with a raw
 * "Unsupported state or unable to authenticate data" crypto error whenever
 * the stored `ghl_api_key_encrypted` couldn't be decrypted with the current
 * `ENCRYPTION_KEY`. That turns a key rotation (or any corrupted blob) into a
 * broken integration that the user can't self-heal without re-saving in
 * Settings.
 *
 * The rest of the codebase already treats `process.env.GHL_API_KEY` as an
 * acceptable fallback (see `packages/shared/src/automations/ghl-adapter.ts`,
 * `packages/shared/src/comms/ghl-email.ts`, and
 * `packages/shared/src/automations/a2p-manager.ts`). This helper applies the
 * same pattern to the admin routes:
 *
 *   1. Try the org's decrypted credentials via `getOrgCredentials`.
 *   2. If that fails because `ghl_location_id` wasn't set, try a manual
 *      decrypt of `ghl_api_key_encrypted` directly.
 *   3. If either of the DB paths returns nothing OR throws, silently fall
 *      back to `process.env.GHL_API_KEY` + `process.env.GHL_COMPANY_ID`.
 *   4. Only throw when neither the DB nor the env vars provide a usable key.
 *
 * The caller never sees a crypto error as long as the platform env var is
 * configured, which it already is for single-tenant deployments.
 */
export async function resolveGhlCredentials(
  supabase: SupabaseClient,
  orgId: string
): Promise<ResolvedGhlCredentials> {
  // --- 1. Happy path: org credentials fully configured and decryptable. ---
  try {
    const creds = await getOrgCredentials(supabase, orgId);
    if (creds.ghl?.apiKey) {
      return {
        apiKey: creds.ghl.apiKey,
        companyId: creds.ghl.companyId ?? null,
        source: "org",
      };
    }
  } catch (err) {
    // `getOrgCredentials` swallows per-field decrypt failures internally,
    // so hitting this catch usually means a Supabase/network error rather
    // than a crypto error. Fall through to the env var path anyway.
    console.warn(
      "[resolveGhlCredentials] getOrgCredentials threw; falling through:",
      err instanceof Error ? err.message : err
    );
  }

  // --- 2. Org fallback: row exists but `ghl_location_id` was null, so
  // `getOrgCredentials` skipped populating `creds.ghl`. Try a direct decrypt
  // of `ghl_api_key_encrypted` so a configured-but-unlinked org can still
  // verify a location ID.
  let dbCompanyId: string | null = null;
  try {
    const { data: org } = await supabase
      .from("organizations")
      .select("ghl_api_key_encrypted, ghl_company_id")
      .eq("id", orgId)
      .single();

    const row = org as Record<string, string | null> | null;
    dbCompanyId = row?.ghl_company_id ?? null;

    if (row?.ghl_api_key_encrypted) {
      try {
        const { decrypt } = await import("@leadrwizard/shared/crypto");
        const apiKey = decrypt(row.ghl_api_key_encrypted);
        return {
          apiKey,
          companyId: dbCompanyId,
          source: "org-fallback",
        };
      } catch (decryptErr) {
        // Stale or unreadable blob — likely an ENCRYPTION_KEY rotation.
        // Log once for observability and fall through to the env var path
        // instead of bubbling the crypto error up to the user.
        console.warn(
          `[resolveGhlCredentials] failed to decrypt ghl_api_key_encrypted for org ${orgId}; falling back to env var:`,
          decryptErr instanceof Error ? decryptErr.message : decryptErr
        );
      }
    }
  } catch (dbErr) {
    console.warn(
      "[resolveGhlCredentials] organizations read failed; falling through:",
      dbErr instanceof Error ? dbErr.message : dbErr
    );
  }

  // --- 3. Platform env var fallback. This matches ghl-adapter.ts so the
  // admin UI stays functional whenever the backend automations would have
  // worked. Prefer any company ID we already pulled from the DB over the
  // env var so an org-specific value still wins. ---
  const envApiKey = process.env.GHL_API_KEY;
  if (envApiKey) {
    return {
      apiKey: envApiKey,
      companyId: dbCompanyId ?? process.env.GHL_COMPANY_ID ?? null,
      source: "env",
    };
  }

  // --- 4. Nothing usable anywhere. Surface a clear, actionable message. ---
  throw new Error(
    "GHL API key is not configured. Add it under Settings → Integrations → GHL, or set the GHL_API_KEY environment variable."
  );
}
