"use server";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";
import {
  getUserOrg,
  getOrgCredentials,
  diagnoseGoosekitCredentials,
} from "@leadrwizard/shared/tenant";
import {
  getGoosekitJobStatus,
  editGoosekitSite,
  GOOSEKIT_TERMINAL_STATUSES,
  GOOSEKIT_STATUS_LABELS,
} from "@leadrwizard/shared/automations";
import type {
  GoosekitJobStatus,
} from "@leadrwizard/shared/automations";
import {
  resolveWebsiteBuildInput,
  triggerAiWebsiteBuild,
  triggerGoosekitWebsiteBuild,
  type StartWebsiteBuildOverrides as SharedStartWebsiteBuildOverrides,
} from "@/lib/website-build-trigger";
import {
  triggerA2PSubmission,
  type StartA2PSubmissionOverrides as SharedStartA2PSubmissionOverrides,
} from "@/lib/a2p-submit-trigger";
import { deriveRepoName } from "@leadrwizard/shared/automations";
import { revalidatePath } from "next/cache";

async function getAuthedOrg() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const serviceClient = createSupabaseServiceClient();
  const orgData = await getUserOrg(serviceClient, user.id);
  if (!orgData || !["owner", "admin"].includes(orgData.role)) {
    throw new Error("Insufficient permissions");
  }

  return { supabase: serviceClient, orgId: orgData.org.id };
}

/**
 * Link a GHL subaccount (location) to a client. The caller has already
 * verified the location ID via /api/ghl/locations/[locationId] — this just
 * writes the ID onto the client row.
 *
 * As a convenience we also auto-mark the `ghl-automations` client_service
 * row as delivered. On our current GHL plan we can't automatically push the
 * snapshot via API, so manually linking the sub-account Greg has already
 * set up IS the delivery action from our system's perspective. We only
 * advance pre-delivered states (pending_onboarding / ready_to_deliver /
 * in_progress) — if the row is already delivered or opted out we leave it.
 */
export async function linkGhlSubaccount(
  clientId: string,
  locationId: string
): Promise<void> {
  const { supabase, orgId } = await getAuthedOrg();

  const trimmed = locationId.trim();
  if (!trimmed) throw new Error("GHL location ID is required");

  // Make sure the client belongs to this org before we touch it.
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, org_id")
    .eq("id", clientId)
    .single();

  if (clientError || !client) throw new Error("Client not found");
  if (client.org_id !== orgId) throw new Error("Insufficient permissions");

  const { error: updateError } = await supabase
    .from("clients")
    .update({
      ghl_sub_account_id: trimmed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);

  if (updateError) throw new Error(`Failed to link subaccount: ${updateError.message}`);

  // Look up the ghl-automations client_service row for this client and
  // transition it to delivered if it's still in a pre-delivered state.
  // This is the "linking = delivery" convention.
  const { data: services } = await supabase
    .from("client_services")
    .select("id, status, opted_out, service:service_definitions(slug)")
    .eq("client_id", clientId)
    .eq("opted_out", false);

  let deliveredServiceId: string | null = null;
  for (const cs of services || []) {
    const row = cs as unknown as {
      id: string;
      status: string;
      service: { slug: string } | null;
    };
    if (row.service?.slug !== "ghl-automations") continue;
    if (row.status === "delivered") continue;
    deliveredServiceId = row.id;
    break;
  }

  if (deliveredServiceId) {
    await supabase
      .from("client_services")
      .update({
        status: "delivered",
        updated_at: new Date().toISOString(),
      })
      .eq("id", deliveredServiceId);
  }

  await supabase.from("interaction_log").insert({
    client_id: clientId,
    channel: "system",
    direction: "outbound",
    content_type: "system_event",
    content: deliveredServiceId
      ? `GHL subaccount linked + automations marked delivered: ${trimmed}`
      : `GHL subaccount linked manually: ${trimmed}`,
    metadata: {
      ghl_sub_account_id: trimmed,
      source: "manual_link",
      ghl_service_marked_delivered: !!deliveredServiceId,
    },
  });

  revalidatePath(`/clients/${clientId}`);
}

/**
 * Unlink a previously-linked GHL subaccount. Used when Greg needs to swap
 * a wrongly-linked location for the correct one.
 */
export async function unlinkGhlSubaccount(clientId: string): Promise<void> {
  const { supabase, orgId } = await getAuthedOrg();

  const { data: client } = await supabase
    .from("clients")
    .select("id, org_id, ghl_sub_account_id")
    .eq("id", clientId)
    .single();

  if (!client) throw new Error("Client not found");
  if (client.org_id !== orgId) throw new Error("Insufficient permissions");

  const previous = client.ghl_sub_account_id;

  await supabase
    .from("clients")
    .update({
      ghl_sub_account_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);

  await supabase.from("interaction_log").insert({
    client_id: clientId,
    channel: "system",
    direction: "outbound",
    content_type: "system_event",
    content: `GHL subaccount unlinked (was: ${previous || "none"})`,
    metadata: { previous_ghl_sub_account_id: previous, source: "manual_unlink" },
  });

  revalidatePath(`/clients/${clientId}`);
}

/**
 * Mark a client_service as delivered. Used when Greg has manually completed
 * the work (e.g. built the website, deployed the GHL snapshot) for services
 * that don't have an automated delivery path.
 */
export async function markClientServiceDelivered(
  clientId: string,
  clientServiceId: string
): Promise<void> {
  const { supabase, orgId } = await getAuthedOrg();

  // Scope check: the client_service must belong to a client in our org.
  const { data: cs } = await supabase
    .from("client_services")
    .select("id, client_id, status, client:clients(org_id), service:service_definitions(name)")
    .eq("id", clientServiceId)
    .single();

  if (!cs) throw new Error("Service not found");
  const row = cs as unknown as {
    id: string;
    client_id: string;
    status: string;
    client: { org_id: string } | null;
    service: { name: string } | null;
  };
  if (row.client?.org_id !== orgId) throw new Error("Insufficient permissions");
  if (row.client_id !== clientId) throw new Error("Client mismatch");

  const { error } = await supabase
    .from("client_services")
    .update({ status: "delivered", updated_at: new Date().toISOString() })
    .eq("id", clientServiceId);

  if (error) throw new Error(`Failed to mark delivered: ${error.message}`);

  await supabase.from("interaction_log").insert({
    client_id: clientId,
    channel: "system",
    direction: "outbound",
    content_type: "system_event",
    content: `Service marked delivered manually: ${row.service?.name || clientServiceId}`,
    metadata: { client_service_id: clientServiceId, previous_status: row.status },
  });

  revalidatePath(`/clients/${clientId}`);
}

/**
 * Manual overrides Greg can pass when submitting A2P from the client
 * detail button. Mirrors `StartWebsiteBuildOverrides`: only used when
 * the onboarding widget didn't capture a particular A2P field, so the
 * inline form can fill in the gaps without forcing Greg back through
 * the manual `/clients/new` A2P intake form.
 */
export type StartA2PSubmissionOverrides = SharedStartA2PSubmissionOverrides;

/**
 * Submit a client's A2P 10DLC registration to Twilio using the data
 * collected during onboarding (plus any manual overrides Greg supplies
 * via the inline form on the client detail page).
 *
 * Flow:
 *  1. Scope-check the client_service against the acting org and verify
 *     it is actually the `a2p-registration` service.
 *  2. Refuse if the service is already `delivered` (Twilio campaign was
 *     verified previously) or if a non-terminal `service_tasks` row
 *     already exists (the carrier still owns the previous submission).
 *  3. Resolve A2P inputs from session_responses + clients row + overrides
 *     via the shared `triggerA2PSubmission` helper. The same helper is
 *     used by the auto-trigger path in the widget response route, so
 *     manual and automatic submissions can't drift on the missing-field
 *     check.
 *  4. The trigger calls `submitA2PRegistration` which creates the
 *     `service_tasks` row, hits Twilio Trust Hub + Brand APIs, and
 *     returns once the brand has been registered (the carrier review
 *     happens asynchronously and gets polled by `task-processor.ts`).
 *  5. Bubble back the structured result so the button UI can surface
 *     the error (and expand its inline form for missing fields) without
 *     Next.js scrubbing the message in production.
 */
export async function submitA2PFromOnboarding(
  clientId: string,
  clientServiceId: string,
  overrides?: StartA2PSubmissionOverrides
): Promise<
  | { ok: true; taskId: string; brandSid: string | null }
  | { ok: false; error: string }
> {
  try {
    const { supabase, orgId } = await getAuthedOrg();

    // --- 1. Scope + state check on the client_service row ---
    const { data: cs } = await supabase
      .from("client_services")
      .select(
        "id, client_id, status, opted_out, client:clients(org_id), service:service_definitions(slug, name)"
      )
      .eq("id", clientServiceId)
      .single();

    if (!cs) throw new Error("Service not found");
    const csRow = cs as unknown as {
      id: string;
      client_id: string;
      status: string;
      opted_out: boolean;
      client: { org_id: string } | null;
      service: { slug: string; name: string } | null;
    };

    if (csRow.client?.org_id !== orgId) throw new Error("Insufficient permissions");
    if (csRow.client_id !== clientId) throw new Error("Client mismatch");
    if (csRow.opted_out) throw new Error("Client has opted out of this service");
    if (csRow.service?.slug !== "a2p-registration") {
      throw new Error(
        `submitA2PFromOnboarding called on non-A2P service: ${csRow.service?.slug}`
      );
    }
    if (csRow.status === "delivered") {
      throw new Error("A2P registration is already marked delivered");
    }

    // --- 2. Fire the shared trigger ---
    const result = await triggerA2PSubmission(
      supabase,
      clientId,
      clientServiceId,
      "manual_start_a2p_submission",
      overrides
    );

    revalidatePath(`/clients/${clientId}`);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return {
      ok: true,
      taskId: result.taskId,
      brandSid: result.brandSid,
    };
  } catch (err) {
    // Mirrors the website-build pattern: log server-side, return the
    // real error message as data so the browser sees it through Next.js'
    // production error scrubbing.
    console.error("[submitA2PFromOnboarding] failed:", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Unknown error submitting A2P registration",
    };
  }
}

/**
 * Kick off the AI website builder for a client's `website-build` service.
 *
 * Flow:
 * 1. Verify the client_service is the website-build service and in a
 *    startable state (ready_to_deliver).
 * 2. Pull the onboarding responses the client filled out via the widget
 *    and map them into WebsiteBuildData — the shape the builder expects.
 * 3. Find the matching niche template for the business's industry.
 * 4. Resolve org credentials. The shared website-builder module only reads
 *    VERCEL_TOKEN / VERCEL_TEAM_ID / ANTHROPIC_API_KEY from process.env, so
 *    we set them here from org-stored creds (Settings → Integrations) before
 *    calling into the builder. If the env vars are already set directly on
 *    Vercel we leave them alone.
 * 5. Call initiateWebsiteBuild. On success the task row ends in
 *    `waiting_external` with a preview URL we can surface back to the UI.
 * 6. Flip client_services.status to `in_progress` so the worklist reflects
 *    the in-flight state. `approveWebsite` later transitions it to
 *    `delivered` (or Greg can hit Mark Delivered as the manual fallback).
 */
/**
 * Manual overrides Greg can pass when the onboarding widget didn't
 * capture the service-specific website-build fields. `niche` and
 * `servicesOffered` have no alternative source in the schema — nothing
 * else on `clients` or `session_responses` provides them — so the
 * client detail page collects them via a small inline form when the
 * widget data is missing.
 *
 * Re-exported from the shared trigger module so consumers of this
 * actions file don't have to know the helper was extracted.
 */
export type StartWebsiteBuildOverrides = SharedStartWebsiteBuildOverrides;

export async function startWebsiteBuild(
  clientId: string,
  clientServiceId: string,
  overrides?: StartWebsiteBuildOverrides
): Promise<
  | { ok: true; previewUrl: string | null; needsTemplate: boolean }
  | { ok: false; error: string }
> {
  try {
    const { supabase, orgId } = await getAuthedOrg();

    // --- 1. Scope + state check on the client_service row ---
    const { data: cs } = await supabase
      .from("client_services")
      .select(
        "id, client_id, status, opted_out, client:clients(org_id), service:service_definitions(slug, name)"
      )
      .eq("id", clientServiceId)
      .single();

    if (!cs) throw new Error("Service not found");
    const csRow = cs as unknown as {
      id: string;
      client_id: string;
      status: string;
      opted_out: boolean;
      client: { org_id: string } | null;
      service: { slug: string; name: string } | null;
    };

    if (csRow.client?.org_id !== orgId) throw new Error("Insufficient permissions");
    if (csRow.client_id !== clientId) throw new Error("Client mismatch");
    if (csRow.opted_out) throw new Error("Client has opted out of this service");
    if (csRow.service?.slug !== "website-build") {
      throw new Error(
        `startWebsiteBuild called on non-website-build service: ${csRow.service?.slug}`
      );
    }
    if (csRow.status === "delivered") {
      throw new Error("Website is already marked delivered");
    }

    // --- 2. Resolve inputs via the shared helper ---
    const resolved = await resolveWebsiteBuildInput(
      supabase,
      clientId,
      clientServiceId,
      overrides
    );

    // --- 3. Fire the AI builder via the shared trigger helper ---
    const creds = await getOrgCredentials(supabase, orgId);
    const result = await triggerAiWebsiteBuild(
      supabase,
      orgId,
      clientId,
      clientServiceId,
      resolved,
      creds,
      { source: "manual_start_website_build" }
    );

    revalidatePath(`/clients/${clientId}`);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    // The shared trigger helper returns a discriminated union keyed on
    // `builder` — narrow it here so TS knows we're on the AI branch.
    if (result.builder !== "ai") {
      // Shouldn't ever fire, but type-safe fallback just in case.
      return { ok: false, error: "Unexpected builder result from AI trigger" };
    }
    return {
      ok: true,
      previewUrl: result.previewUrl,
      needsTemplate: result.needsTemplate,
    };
  } catch (err) {
    // Log the real error server-side so it shows up in Vercel logs, and
    // return a structured error so the specific message actually reaches
    // the browser. Next.js scrubs thrown errors from server actions in
    // production to prevent info leaks — returning the message as data
    // bypasses that and lets the UI surface the real failure reason.
    console.error("[startWebsiteBuild] failed:", err);
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Unknown error starting website build",
    };
  }
}

/**
 * Second, alternative website builder: calls Goose Kit (an external
 * Railway-hosted site generator) instead of the in-repo Claude+Vercel
 * pipeline. Mirrors `startWebsiteBuild` exactly for the first ~80% of
 * the flow (scope/state check, input resolution, missing-field errors)
 * and only diverges at the point where it calls the builder.
 *
 * Goose Kit is **asynchronous**: `POST /build` returns a `job_id` in
 * under a second, and the actual generation + GitHub push + Vercel
 * deploy happens over the next several minutes. This server action only
 * kicks the job off and stores the `job_id` on `client_services`. The
 * browser is then responsible for polling `getGoosekitBuildStatus` on a
 * ~3s interval until the job reaches a terminal state. The job_id
 * surviving on the row means polling resumes after a page refresh.
 *
 * When the client has an `existing_website`, `initiateGoosekitBuild`
 * auto-routes to Goose Kit's `/redesign` endpoint instead of `/build` —
 * `/redesign` scrapes the URL and reuses the client's real brand
 * (logo, colors, copy) rather than generating everything from scratch.
 *
 * Greg picks which builder to fire per client from the client detail
 * page; this action is wired to the "Start Goose Kit build" button.
 * See `goosekit-builder.ts` for the full API contract and
 * `getGoosekitBuildStatus` below for the polling counterpart.
 */
export async function startGoosekitBuild(
  clientId: string,
  clientServiceId: string,
  overrides?: StartWebsiteBuildOverrides
): Promise<
  | {
      ok: true;
      jobId: string;
      status: GoosekitJobStatus;
      statusLabel: string;
    }
  | { ok: false; error: string }
> {
  try {
    const { supabase, orgId } = await getAuthedOrg();

    // --- 1. Scope + state check on the client_service row ---
    const { data: cs } = await supabase
      .from("client_services")
      .select(
        "id, client_id, status, opted_out, client:clients(org_id), service:service_definitions(slug, name)"
      )
      .eq("id", clientServiceId)
      .single();

    if (!cs) throw new Error("Service not found");
    const csRow = cs as unknown as {
      id: string;
      client_id: string;
      status: string;
      opted_out: boolean;
      client: { org_id: string } | null;
      service: { slug: string; name: string } | null;
    };

    if (csRow.client?.org_id !== orgId) throw new Error("Insufficient permissions");
    if (csRow.client_id !== clientId) throw new Error("Client mismatch");
    if (csRow.opted_out) throw new Error("Client has opted out of this service");
    if (csRow.service?.slug !== "website-build") {
      throw new Error(
        `startGoosekitBuild called on non-website-build service: ${csRow.service?.slug}`
      );
    }
    if (csRow.status === "delivered") {
      throw new Error("Website is already marked delivered");
    }

    // --- 2. Resolve inputs via the shared helper ---
    const resolved = await resolveWebsiteBuildInput(
      supabase,
      clientId,
      clientServiceId,
      overrides
    );

    // --- 3. Fire the Goose Kit builder via the shared trigger helper ---
    const creds = await getOrgCredentials(supabase, orgId);
    const result = await triggerGoosekitWebsiteBuild(
      supabase,
      orgId,
      clientId,
      clientServiceId,
      resolved,
      creds,
      { source: "manual_start_goosekit_build" }
    );

    revalidatePath(`/clients/${clientId}`);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    if (result.builder !== "goosekit") {
      return {
        ok: false,
        error: "Unexpected builder result from Goose Kit trigger",
      };
    }
    return {
      ok: true,
      jobId: result.jobId,
      status: result.status,
      statusLabel: result.statusLabel,
    };
  } catch (err) {
    console.error("[startGoosekitBuild] failed:", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Unknown error starting Goose Kit website build",
    };
  }
}

/**
 * Submit an edit instruction for a previously-built Goose Kit website.
 *
 * Preconditions:
 *  - The client_service must be `website-build` and have a live Goose
 *    Kit build (either `goosekit_repo_name` persisted, or we derive it
 *    from the business name as a fallback for sites built before the
 *    repo_name column existed).
 *  - No in-flight Goose Kit job (we check `goosekit_job_status` and
 *    bail if one is running — edits would compete with an active build).
 *  - Goose Kit credentials must be configured.
 *
 * Successful edits create a new Goose Kit job in `EDITING_SITE` state
 * that the existing `getGoosekitBuildStatus` poller picks up — no new
 * polling path needed, the browser just reuses the same status panel.
 */
export async function editClientWebsite(
  clientId: string,
  clientServiceId: string,
  instructions: string
): Promise<
  | {
      ok: true;
      jobId: string;
      status: GoosekitJobStatus;
      statusLabel: string;
    }
  | { ok: false; error: string }
> {
  try {
    const { supabase, orgId } = await getAuthedOrg();

    const trimmed = (instructions || "").trim();
    if (!trimmed) {
      return { ok: false, error: "Please describe what you want changed." };
    }
    if (trimmed.length < 10) {
      return {
        ok: false,
        error:
          "Edit instructions are too short. Describe the change in a full sentence so Goose Kit can act on it.",
      };
    }

    // Scope + preconditions check.
    const { data: cs } = await supabase
      .from("client_services")
      .select(
        "id, client_id, goosekit_repo_name, goosekit_job_status, goosekit_live_url, client:clients(org_id, business_name, name), service:service_definitions(slug, name)"
      )
      .eq("id", clientServiceId)
      .single();

    if (!cs) throw new Error("Service not found");
    const csRow = cs as unknown as {
      id: string;
      client_id: string;
      goosekit_repo_name: string | null;
      goosekit_job_status: GoosekitJobStatus | null;
      goosekit_live_url: string | null;
      client: { org_id: string; business_name: string | null; name: string } | null;
      service: { slug: string; name: string } | null;
    };

    if (csRow.client?.org_id !== orgId) throw new Error("Insufficient permissions");
    if (csRow.client_id !== clientId) throw new Error("Client mismatch");
    if (csRow.service?.slug !== "website-build") {
      throw new Error(
        `editClientWebsite called on non-website-build service: ${csRow.service?.slug}`
      );
    }

    if (
      csRow.goosekit_job_status &&
      !GOOSEKIT_TERMINAL_STATUSES.includes(csRow.goosekit_job_status)
    ) {
      throw new Error(
        `A Goose Kit job is already running on this site (${GOOSEKIT_STATUS_LABELS[csRow.goosekit_job_status]}). Wait for it to finish before submitting an edit.`
      );
    }

    if (!csRow.goosekit_live_url && !csRow.goosekit_repo_name) {
      throw new Error(
        "This site has not been built with Goose Kit yet. Start a Goose Kit build first before submitting edits."
      );
    }

    // Resolve the repo name. Prefer the persisted column; fall back to
    // re-deriving from the business name for sites built before the
    // goosekit_repo_name column was added (must match the slug Goose
    // Kit would have generated on the original build).
    const repoName =
      csRow.goosekit_repo_name ||
      deriveRepoName(
        csRow.client?.business_name?.trim() || csRow.client?.name || "business"
      );

    const creds = await getOrgCredentials(supabase, orgId);
    if (!creds.goosekit) {
      const reason = await diagnoseGoosekitCredentials(supabase, orgId);
      throw new Error(reason);
    }

    const created = await editGoosekitSite(repoName, trimmed, creds.goosekit);

    // Persist the new job on the row so the existing status panel picks
    // it up. Back-fill goosekit_repo_name if it was missing (legacy row).
    await supabase
      .from("client_services")
      .update({
        goosekit_job_id: created.jobId,
        goosekit_job_status: created.status,
        goosekit_repo_name: repoName,
        goosekit_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", clientServiceId);

    await supabase.from("interaction_log").insert({
      client_id: clientId,
      channel: "system",
      direction: "outbound",
      content_type: "system_event",
      content: `Goose Kit edit submitted: ${trimmed.slice(0, 140)}${trimmed.length > 140 ? "…" : ""}`,
      metadata: {
        client_service_id: clientServiceId,
        goosekit_job_id: created.jobId,
        goosekit_repo_name: repoName,
        goosekit_initial_status: created.status,
        goosekit_queue_position: created.queuePosition ?? null,
        edit_instructions: trimmed,
        builder: "goosekit",
        source: "manual_edit_goosekit_site",
      },
    });

    revalidatePath(`/clients/${clientId}`);
    return {
      ok: true,
      jobId: created.jobId,
      status: created.status,
      statusLabel: GOOSEKIT_STATUS_LABELS[created.status],
    };
  } catch (err) {
    console.error("[editClientWebsite] failed:", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Unknown error submitting Goose Kit edit",
    };
  }
}

/**
 * Poll the status of a Goose Kit job previously started via
 * `startGoosekitBuild`. The browser calls this every 3 seconds (matching
 * the reference frontend's cadence) until the job reaches a terminal
 * state (READY or FAILED). Each call:
 *
 *   1. Loads `goosekit_job_id` from the `client_services` row.
 *   2. Calls Goose Kit's GET /status/:id with that job_id.
 *   3. Writes the updated status/live_url/error back to the row so the
 *      next page load picks up where we left off.
 *   4. On terminal states:
 *      - READY  → flip `client_services.status = "ready_to_deliver"` and
 *                 log the live URL to `interaction_log`.
 *      - FAILED → keep `in_progress`, open an escalation so Greg can
 *                 investigate, and store the error on the row.
 *
 * Returns a small payload the browser uses to update the UI without
 * having to re-fetch the whole client detail page.
 */
export async function getGoosekitBuildStatus(
  clientId: string,
  clientServiceId: string
): Promise<
  | {
      ok: true;
      jobId: string | null;
      status: GoosekitJobStatus | null;
      statusLabel: string | null;
      liveUrl: string | null;
      error: string | null;
      isTerminal: boolean;
    }
  | { ok: false; error: string }
> {
  try {
    const { supabase, orgId } = await getAuthedOrg();

    // Load the current row. Everything we need is already stored locally
    // except the live status from Goose Kit itself.
    const { data: cs } = await supabase
      .from("client_services")
      .select(
        "id, client_id, status, goosekit_job_id, goosekit_job_status, goosekit_live_url, goosekit_error, client:clients(org_id, name), service:service_definitions(name)"
      )
      .eq("id", clientServiceId)
      .single();

    if (!cs) throw new Error("Service not found");
    const csRow = cs as unknown as {
      id: string;
      client_id: string;
      status: string;
      goosekit_job_id: string | null;
      goosekit_job_status: GoosekitJobStatus | null;
      goosekit_live_url: string | null;
      goosekit_error: string | null;
      client: { org_id: string; name: string } | null;
      service: { name: string } | null;
    };

    if (csRow.client?.org_id !== orgId) throw new Error("Insufficient permissions");
    if (csRow.client_id !== clientId) throw new Error("Client mismatch");

    // No job running — return whatever's on the row so the UI can render
    // its current state without loop-polling a null.
    if (!csRow.goosekit_job_id) {
      return {
        ok: true,
        jobId: null,
        status: null,
        statusLabel: null,
        liveUrl: csRow.goosekit_live_url,
        error: csRow.goosekit_error,
        isTerminal: true,
      };
    }

    // Already terminal — don't hit Goose Kit again. Idempotent refresh.
    if (
      csRow.goosekit_job_status &&
      GOOSEKIT_TERMINAL_STATUSES.includes(csRow.goosekit_job_status)
    ) {
      return {
        ok: true,
        jobId: csRow.goosekit_job_id,
        status: csRow.goosekit_job_status,
        statusLabel: GOOSEKIT_STATUS_LABELS[csRow.goosekit_job_status],
        liveUrl: csRow.goosekit_live_url,
        error: csRow.goosekit_error,
        isTerminal: true,
      };
    }

    const creds = await getOrgCredentials(supabase, orgId);
    if (!creds.goosekit) {
      throw new Error(
        "Goose Kit credentials missing — cannot check job status. Restore the tokens in Settings → Integrations."
      );
    }

    const status = await getGoosekitJobStatus(
      csRow.goosekit_job_id,
      creds.goosekit
    );

    const isTerminal = GOOSEKIT_TERMINAL_STATUSES.includes(status.status);

    // Persist the polled state back to the row regardless of terminal.
    // On non-terminal states this just updates the status column; on
    // terminal states we also flip `client_services.status` and write
    // the final live_url or error.
    if (isTerminal && status.status === "READY") {
      const liveUrl = status.liveUrl ?? null;
      await supabase
        .from("client_services")
        .update({
          status: "ready_to_deliver",
          goosekit_job_status: status.status,
          goosekit_live_url: liveUrl,
          goosekit_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", clientServiceId);

      await supabase.from("interaction_log").insert({
        client_id: clientId,
        channel: "system",
        direction: "inbound",
        content_type: "system_event",
        content: `Goose Kit build READY — live URL: ${liveUrl ?? "(no URL in response)"}`,
        metadata: {
          client_service_id: clientServiceId,
          goosekit_job_id: csRow.goosekit_job_id,
          goosekit_live_url: liveUrl,
          builder: "goosekit",
          source: "goosekit_status_poll",
        },
      });

      revalidatePath(`/clients/${clientId}`);
    } else if (isTerminal && status.status === "FAILED") {
      const errorMsg = status.error || "Goose Kit reported the job failed";
      await supabase
        .from("client_services")
        .update({
          goosekit_job_status: status.status,
          goosekit_error: errorMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", clientServiceId);

      // Open an escalation so Greg has a worklist item to follow up on.
      // This is the async equivalent of the "no template found" path in
      // the in-repo AI builder — something external failed and we need
      // a human to decide what happens next.
      await supabase.from("escalations").insert({
        client_id: clientId,
        reason: `Goose Kit build failed: ${errorMsg.slice(0, 200)}`,
        status: "open",
        metadata: {
          client_service_id: clientServiceId,
          goosekit_job_id: csRow.goosekit_job_id,
          goosekit_error: errorMsg,
          builder: "goosekit",
        },
      });

      await supabase.from("interaction_log").insert({
        client_id: clientId,
        channel: "system",
        direction: "inbound",
        content_type: "system_event",
        content: `Goose Kit build FAILED: ${errorMsg.slice(0, 200)}`,
        metadata: {
          client_service_id: clientServiceId,
          goosekit_job_id: csRow.goosekit_job_id,
          builder: "goosekit",
          source: "goosekit_status_poll",
        },
      });

      revalidatePath(`/clients/${clientId}`);
    } else {
      // Non-terminal: just update the status column.
      await supabase
        .from("client_services")
        .update({
          goosekit_job_status: status.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", clientServiceId);
    }

    return {
      ok: true,
      jobId: csRow.goosekit_job_id,
      status: status.status,
      statusLabel: GOOSEKIT_STATUS_LABELS[status.status],
      liveUrl: status.liveUrl ?? csRow.goosekit_live_url,
      error: status.error ?? null,
      isTerminal,
    };
  } catch (err) {
    console.error("[getGoosekitBuildStatus] failed:", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Unknown error checking Goose Kit job status",
    };
  }
}

/**
 * Hard-deletes a client from the database. All related rows in
 * `client_services`, `client_packages`, `onboarding_sessions`,
 * `interaction_log`, `outreach_queue`, `escalations`, and `service_tasks`
 * cascade automatically via the foreign keys set in the initial schema.
 *
 * This action is gated behind a "type the client's email to confirm" UX
 * on the client detail page Danger Zone, so the server still requires the
 * caller to pass the email — if it doesn't match the row on file, we
 * refuse the delete. That guards against:
 *  - Stale / replayed clicks (different client row in the meantime)
 *  - Accidental API invocations without the confirmation UI in between
 *
 * We do NOT touch external systems here: the GHL subaccount, Twilio
 * number, and any Vercel deployments created by the website builder are
 * all left alone. Greg can clean those up manually if needed. Rationale:
 * those resources often belong to the client (not the agency), and
 * blowing them away on a hasty click would be much worse than leaving
 * orphaned rows inside the agency's DB.
 *
 * Returns `{ ok: true }` on success or `{ ok: false, error }` on failure,
 * same pattern as the other server actions in this file so the calling
 * component can surface the error inline instead of crashing.
 */
export async function deleteClient(
  clientId: string,
  confirmationEmail: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase, orgId } = await getAuthedOrg();

    // --- 1. Load the client row and verify scope ---
    const { data: client, error: loadError } = await supabase
      .from("clients")
      .select("id, org_id, name, email, business_name")
      .eq("id", clientId)
      .single();

    if (loadError || !client) {
      throw new Error("Client not found");
    }

    const row = client as {
      id: string;
      org_id: string;
      name: string;
      email: string | null;
      business_name: string | null;
    };

    if (row.org_id !== orgId) {
      throw new Error("Insufficient permissions");
    }

    // --- 2. Email confirmation must match exactly (case-insensitive) ---
    const expected = (row.email || "").trim().toLowerCase();
    const provided = (confirmationEmail || "").trim().toLowerCase();

    if (!expected) {
      throw new Error(
        "This client has no email on file — cannot confirm delete. Contact support to force-remove."
      );
    }
    if (provided !== expected) {
      throw new Error(
        "Confirmation email does not match. Type the client's exact email address to confirm deletion."
      );
    }

    // --- 3. Delete the client row. FK cascades handle everything else. ---
    const { error: deleteError } = await supabase
      .from("clients")
      .delete()
      .eq("id", clientId);

    if (deleteError) {
      throw new Error(`Failed to delete client: ${deleteError.message}`);
    }

    // --- 4. Invalidate caches for the lists that this client appeared on ---
    revalidatePath("/clients");
    revalidatePath("/onboardings");
    revalidatePath("/dashboard");

    return { ok: true };
  } catch (err) {
    console.error("[deleteClient] failed:", err);
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Unknown error deleting client",
    };
  }
}
