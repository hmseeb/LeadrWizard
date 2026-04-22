/**
 * Shared website-build trigger logic used by BOTH:
 *
 *  1. `startWebsiteBuild` / `startGoosekitBuild` server actions on the
 *     client detail page (manual, Greg-clicked path).
 *  2. The widget response route's auto-trigger, which fires when a
 *     client finishes onboarding for a `website-build` service without
 *     any manual intervention (automatic, zero-click path).
 *
 * Both paths need the same three things:
 *  - **Input resolution**: read `session_responses` + `clients` row +
 *    optional manual overrides, merge with the documented precedence,
 *    and fail fast if any required field is still missing.
 *  - **Credential pre-flight**: load `getOrgCredentials`, decide which
 *    builder is firing (manual choice OR per-org default), and return a
 *    structured "not configured" error before burning a Goose Kit job
 *    on bad creds.
 *  - **Persistence + logging**: flip `client_services.status` to
 *    `in_progress`, persist `goosekit_job_id` / `goosekit_repo_name`
 *    for polling + future edits, and write an `interaction_log` entry
 *    so the timeline shows which builder fired and why.
 *
 * Extracting this keeps the three callers consistent — they can't
 * drift on the missing-field check, the credential fallback, the repo
 * name, or the interaction_log shape. If we change the trigger
 * behavior (e.g. add a new required field, swap the logging key), it
 * lands in exactly one place.
 *
 * NOTE on trust: both callers MUST scope-check `client_services` to
 * the acting user's org BEFORE calling into this module. This helper
 * deliberately does NOT re-check the org_id — it assumes the caller
 * has verified access. The widget auto-trigger path uses service-role
 * keys and trusts the session row resolution for its own scoping.
 */

import type { createSupabaseServiceClient } from "./supabase-server";
import {
  initiateWebsiteBuild,
  findNicheTemplate,
  initiateGoosekitBuild,
  deriveRepoName,
  GOOSEKIT_STATUS_LABELS,
  type WebsiteBuildData,
  type GoosekitBuildInput,
  type GoosekitJobStatus,
} from "@leadrwizard/shared/automations";
import {
  getOrgCredentials,
  diagnoseGoosekitCredentials,
} from "@leadrwizard/shared/tenant";
import type {
  OrgCredentials,
  WebsiteBuilderChoice,
} from "@leadrwizard/shared/types";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export interface StartWebsiteBuildOverrides {
  niche?: string;
  servicesOffered?: string;
  tagline?: string;
  primaryColor?: string;
  aboutText?: string;
}

export interface ResolvedWebsiteBuildInput {
  business_name: string;
  niche: string;
  phone: string;
  email: string;
  services_offered: string;
  tagline?: string;
  primary_color?: string;
  logo_url?: string;
  address?: string;
  about_text?: string;
  existing_website?: string;
  /** Parsed services list for the in-repo builder's array-shaped field. */
  services_offered_list: string[];
}

/**
 * Shared "resolve the website-build inputs from session_responses +
 * clients row + overrides, then check for missing required fields"
 * helper. Used by both manual server actions and the auto-trigger
 * path so they can't drift on the missing-field check.
 *
 * Throws if any of the five required fields (`business_name`, `niche`,
 * `phone`, `email`, `services_offered`) can't be resolved through the
 * fallback chain — the thrown message is formatted to help the client
 * button UI decide whether to expand its inline manual-entry form. The
 * auto-trigger path catches this and silently skips the build (the
 * onboarding just doesn't have the data yet, which is fine — Greg will
 * see the service sitting at `ready_to_deliver` and can retry manually).
 */
export async function resolveWebsiteBuildInput(
  supabase: ServiceClient,
  clientId: string,
  clientServiceId: string,
  overrides?: StartWebsiteBuildOverrides
): Promise<ResolvedWebsiteBuildInput> {
  // 1. Pull onboarding answers scoped to this client_service
  const { data: responses } = await supabase
    .from("session_responses")
    .select("field_key, field_value")
    .eq("client_service_id", clientServiceId);

  const answers: Record<string, string> = {};
  for (const r of responses || []) {
    const row = r as { field_key: string; field_value: string };
    answers[row.field_key] = row.field_value;
  }

  // 2. Pull the client row for fallback contact/business details. phone,
  // email, and business_name live here from provisioning time, so the
  // build should never fail for lack of them even if the widget missed
  // them.
  const { data: clientRow } = await supabase
    .from("clients")
    .select("name, business_name, email, phone")
    .eq("id", clientId)
    .single();

  const fallbackClient = (clientRow || {}) as {
    name?: string | null;
    business_name?: string | null;
    email?: string | null;
    phone?: string | null;
  };

  // 3. Resolve each field via: overrides → session_responses → clients row.
  // Overrides only take precedence for fields with no other reliable
  // source (niche, services_offered, and a few optional ones).
  const business_name =
    answers.business_name?.trim() ||
    fallbackClient.business_name?.trim() ||
    fallbackClient.name?.trim() ||
    "";
  const niche = overrides?.niche?.trim() || answers.niche?.trim() || "";
  const phone =
    answers.phone?.trim() || fallbackClient.phone?.trim() || "";
  const email =
    answers.email?.trim() || fallbackClient.email?.trim() || "";
  const services_offered =
    overrides?.servicesOffered?.trim() ||
    answers.services_offered?.trim() ||
    "";
  const tagline =
    overrides?.tagline?.trim() || answers.tagline?.trim() || "";
  const primary_color =
    overrides?.primaryColor?.trim() || answers.primary_color?.trim() || "";
  const about_text =
    overrides?.aboutText?.trim() || answers.about_text?.trim() || "";

  const missing: string[] = [];
  if (!business_name) missing.push("business_name");
  if (!niche) missing.push("niche");
  if (!phone) missing.push("phone");
  if (!email) missing.push("email");
  if (!services_offered) missing.push("services_offered");
  if (missing.length > 0) {
    throw new Error(
      `Missing required fields for website build: ${missing.join(", ")}. ` +
        `Fields not captured during onboarding can be entered manually below.`
    );
  }

  // 4. Persist any newly-supplied override values back to session_responses
  // so the next build/edit attempt finds them in the normal place. Without
  // this, Greg has to re-type niche/services_offered every time he re-fires
  // the builder — and the Goose Kit READY handler that resets the service
  // to ready_to_deliver after a successful run guarantees he'll be back on
  // the same screen the moment he wants to retry. Persisting overrides
  // makes the manual form a one-time correction, not a recurring tax.
  //
  // We need a session_id to insert into session_responses; pick the most
  // recent session for this client. If none exists (e.g. provisioned via
  // a path that skipped the widget), we silently skip persistence — the
  // build still succeeds with the in-memory overrides, and the next click
  // will re-prompt. That's strictly better than failing the build.
  const overrideEntries: Array<{ field_key: string; field_value: string }> = [];
  const writeIfOverridden = (
    fieldKey: string,
    overrideValue: string | undefined
  ) => {
    const trimmed = overrideValue?.trim();
    if (!trimmed) return;
    if (answers[fieldKey]?.trim() === trimmed) return; // already on file
    overrideEntries.push({ field_key: fieldKey, field_value: trimmed });
  };
  writeIfOverridden("niche", overrides?.niche);
  writeIfOverridden("services_offered", overrides?.servicesOffered);
  writeIfOverridden("tagline", overrides?.tagline);
  writeIfOverridden("primary_color", overrides?.primaryColor);
  writeIfOverridden("about_text", overrides?.aboutText);

  if (overrideEntries.length > 0) {
    const { data: latestSession } = await supabase
      .from("onboarding_sessions")
      .select("id")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const sessionId = (latestSession as { id: string } | null)?.id;
    if (sessionId) {
      // Best-effort upsert. If a row with the same (session_id,
      // client_service_id, field_key) somehow exists with a different
      // value, we delete-then-insert so the override wins. session_responses
      // does not have a unique constraint on that triple, so we delete by
      // those columns to avoid stacking duplicate rows on every retry.
      await supabase
        .from("session_responses")
        .delete()
        .eq("session_id", sessionId)
        .eq("client_service_id", clientServiceId)
        .in(
          "field_key",
          overrideEntries.map((e) => e.field_key)
        );

      await supabase.from("session_responses").insert(
        overrideEntries.map((e) => ({
          session_id: sessionId,
          client_service_id: clientServiceId,
          field_key: e.field_key,
          field_value: e.field_value,
          answered_via: "click" as const,
        }))
      );
    }
  }

  const services_offered_list = services_offered
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    business_name,
    niche,
    phone,
    email,
    services_offered,
    services_offered_list,
    tagline: tagline || undefined,
    primary_color: primary_color || undefined,
    logo_url: answers.logo_url || undefined,
    address: answers.address || undefined,
    about_text: about_text || undefined,
    existing_website: answers.existing_website || undefined,
  };
}

// ---------------------------------------------------------------------------
// Builder trigger helpers
// ---------------------------------------------------------------------------

/**
 * Outcome of a website-build trigger attempt. Mirrors the shape the
 * manual server actions return so the client detail page button UI can
 * render the same branches. The auto-trigger path on the widget route
 * discards most of this and just logs failures for diagnostic purposes.
 */
export type TriggerResult =
  | {
      ok: true;
      builder: "ai";
      previewUrl: string | null;
      needsTemplate: boolean;
    }
  | {
      ok: true;
      builder: "goosekit";
      jobId: string;
      status: GoosekitJobStatus;
      statusLabel: string;
      repoName: string;
    }
  | { ok: false; error: string; builder: WebsiteBuilderChoice };

export interface TriggerContext {
  /**
   * Source tag written into `interaction_log.metadata.source` so we can
   * tell a manual click, an auto-trigger, and a retry apart in the
   * timeline without inspecting the rest of the row.
   */
  source:
    | "manual_start_website_build"
    | "manual_start_goosekit_build"
    | "auto_trigger_on_onboarding_submit";
}

/**
 * Fire the in-repo AI website builder for a client_service. Assumes the
 * caller has already scope-checked `client_services` and verified that
 * the service is `website-build` and not `delivered`.
 */
export async function triggerAiWebsiteBuild(
  supabase: ServiceClient,
  orgId: string,
  clientId: string,
  clientServiceId: string,
  resolved: ResolvedWebsiteBuildInput,
  creds: OrgCredentials,
  ctx: TriggerContext
): Promise<TriggerResult> {
  try {
    const buildData: WebsiteBuildData = {
      business_name: resolved.business_name,
      niche: resolved.niche,
      tagline: resolved.tagline,
      primary_color: resolved.primary_color,
      logo_url: resolved.logo_url,
      phone: resolved.phone,
      email: resolved.email,
      address: resolved.address,
      services_offered: resolved.services_offered_list,
      about_text: resolved.about_text,
    };

    const template = await findNicheTemplate(supabase, orgId, buildData.niche);

    // The shared website-builder module only reads VERCEL_TOKEN /
    // VERCEL_TEAM_ID / ANTHROPIC_API_KEY from process.env, so populate
    // them from org-stored creds before calling in. Idempotent across
    // invocations in the same Node process.
    if (!process.env.VERCEL_TOKEN) {
      if (!creds.vercel?.token) {
        throw new Error(
          "Vercel token is not configured. Add it under Settings → Integrations → Vercel, or set VERCEL_TOKEN as an env var."
        );
      }
      process.env.VERCEL_TOKEN = creds.vercel.token;
      if (creds.vercel.teamId && !process.env.VERCEL_TEAM_ID) {
        process.env.VERCEL_TEAM_ID = creds.vercel.teamId;
      }
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      if (!creds.anthropic?.apiKey) {
        throw new Error(
          "Anthropic API key is not configured. Add it under Settings → Integrations → Anthropic, or set ANTHROPIC_API_KEY as an env var."
        );
      }
      process.env.ANTHROPIC_API_KEY = creds.anthropic.apiKey;
    }

    await initiateWebsiteBuild(supabase, clientServiceId, buildData, template);

    await supabase
      .from("client_services")
      .update({
        status: "in_progress",
        updated_at: new Date().toISOString(),
      })
      .eq("id", clientServiceId);

    const { data: latestTask } = await supabase
      .from("service_tasks")
      .select("last_result")
      .eq("client_service_id", clientServiceId)
      .eq("task_type", "website_generation")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const lastResult = (latestTask as {
      last_result: Record<string, unknown>;
    } | null)?.last_result;
    const previewUrl = (lastResult?.preview_url as string | undefined) || null;
    const needsTemplate = lastResult?.step === "needs_template";

    await supabase.from("interaction_log").insert({
      client_id: clientId,
      channel: "system",
      direction: "outbound",
      content_type: "system_event",
      content: needsTemplate
        ? `Website build kicked off — no template for niche "${buildData.niche}", escalation created`
        : `Website build kicked off for ${buildData.business_name}`,
      metadata: {
        client_service_id: clientServiceId,
        preview_url: previewUrl,
        needs_template: needsTemplate,
        builder: "ai",
        source: ctx.source,
      },
    });

    return { ok: true, builder: "ai", previewUrl, needsTemplate };
  } catch (err) {
    console.error("[triggerAiWebsiteBuild] failed:", err);
    return {
      ok: false,
      builder: "ai",
      error:
        err instanceof Error ? err.message : "Unknown error starting website build",
    };
  }
}

/**
 * Fire a Goose Kit build for a client_service. Assumes the caller has
 * already scope-checked `client_services`. Persists `goosekit_job_id`,
 * `goosekit_job_status`, and `goosekit_repo_name` on the row so the
 * admin UI can resume polling after refresh and the /edit endpoint can
 * target the right repo later.
 */
export async function triggerGoosekitWebsiteBuild(
  supabase: ServiceClient,
  orgId: string,
  clientId: string,
  clientServiceId: string,
  resolved: ResolvedWebsiteBuildInput,
  creds: OrgCredentials,
  ctx: TriggerContext
): Promise<TriggerResult> {
  try {
    if (!creds.goosekit) {
      const reason = await diagnoseGoosekitCredentials(supabase, orgId);
      throw new Error(reason);
    }

    const buildInput: GoosekitBuildInput = {
      businessName: resolved.business_name,
      niche: resolved.niche,
      servicesOffered: resolved.services_offered,
      phone: resolved.phone,
      email: resolved.email,
      tagline: resolved.tagline,
      primaryColor: resolved.primary_color,
      logoUrl: resolved.logo_url,
      address: resolved.address,
      aboutText: resolved.about_text,
      existingWebsite: resolved.existing_website,
    };

    const created = await initiateGoosekitBuild(buildInput, creds.goosekit);

    // Persist the repo name alongside the job id. Both build and
    // redesign use `deriveRepoName(business_name)` as the `repo_name`
    // field, so we re-derive it here to stay in sync. The /edit call
    // later reads this column so a business rename doesn't break edits.
    const repoName = deriveRepoName(resolved.business_name);

    await supabase
      .from("client_services")
      .update({
        status: "in_progress",
        goosekit_job_id: created.jobId,
        goosekit_job_status: created.status,
        goosekit_repo_name: repoName,
        goosekit_live_url: null,
        goosekit_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", clientServiceId);

    await supabase.from("interaction_log").insert({
      client_id: clientId,
      channel: "system",
      direction: "outbound",
      content_type: "system_event",
      content: `Goose Kit website build queued for ${resolved.business_name} (${created.status})`,
      metadata: {
        client_service_id: clientServiceId,
        goosekit_job_id: created.jobId,
        goosekit_repo_name: repoName,
        goosekit_initial_status: created.status,
        goosekit_queue_position: created.queuePosition ?? null,
        has_existing_website: !!resolved.existing_website,
        builder: "goosekit",
        source: ctx.source,
      },
    });

    return {
      ok: true,
      builder: "goosekit",
      jobId: created.jobId,
      status: created.status,
      statusLabel: GOOSEKIT_STATUS_LABELS[created.status],
      repoName,
    };
  } catch (err) {
    console.error("[triggerGoosekitWebsiteBuild] failed:", err);
    return {
      ok: false,
      builder: "goosekit",
      error:
        err instanceof Error
          ? err.message
          : "Unknown error starting Goose Kit website build",
    };
  }
}

/**
 * High-level "fire whichever builder is configured for this org" helper.
 *
 * Used by the widget auto-trigger after a client completes onboarding.
 * Reads the org's `default_website_builder` preference from
 * `getOrgCredentials` and routes to the appropriate trigger.
 *
 * Returns the structured result so the caller can log failures, but
 * callers on the auto-trigger path should NOT block the HTTP response
 * on a failed build — the service sitting at `ready_to_deliver` is a
 * safe fallback state that lets Greg retry manually from the client
 * detail page.
 */
export async function triggerDefaultWebsiteBuild(
  supabase: ServiceClient,
  orgId: string,
  clientId: string,
  clientServiceId: string,
  ctx: TriggerContext,
  overrides?: StartWebsiteBuildOverrides
): Promise<TriggerResult> {
  // 1. Resolve input first. If required fields are missing we fail
  // with a structured error — the widget auto-trigger path should
  // just log it and bail; the manual path's button UI reacts to the
  // thrown message and expands an inline form.
  let resolved: ResolvedWebsiteBuildInput;
  try {
    resolved = await resolveWebsiteBuildInput(
      supabase,
      clientId,
      clientServiceId,
      overrides
    );
  } catch (err) {
    return {
      ok: false,
      // We don't know yet which builder was going to fire, so report
      // whichever the org defaults to for logging attribution.
      builder: "ai",
      error:
        err instanceof Error
          ? err.message
          : "Failed to resolve website build input",
    };
  }

  const creds = await getOrgCredentials(supabase, orgId);
  const choice: WebsiteBuilderChoice = creds.defaultWebsiteBuilder;

  if (choice === "goosekit") {
    return triggerGoosekitWebsiteBuild(
      supabase,
      orgId,
      clientId,
      clientServiceId,
      resolved,
      creds,
      ctx
    );
  }
  return triggerAiWebsiteBuild(
    supabase,
    orgId,
    clientId,
    clientServiceId,
    resolved,
    creds,
    ctx
  );
}
