"use server";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";
import { getUserOrg, getOrgCredentials } from "@leadrwizard/shared/tenant";
import {
  initiateWebsiteBuild,
  findNicheTemplate,
} from "@leadrwizard/shared/automations";
import type { WebsiteBuildData } from "@leadrwizard/shared/automations";
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
export async function startWebsiteBuild(
  clientId: string,
  clientServiceId: string
): Promise<{ previewUrl: string | null; needsTemplate: boolean }> {
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

  // --- 2. Pull onboarding answers scoped to this client_service ---
  const { data: responses } = await supabase
    .from("session_responses")
    .select("field_key, field_value")
    .eq("client_service_id", clientServiceId);

  const answers: Record<string, string> = {};
  for (const r of responses || []) {
    const row = r as { field_key: string; field_value: string };
    answers[row.field_key] = row.field_value;
  }

  const missing: string[] = [];
  for (const required of ["business_name", "niche", "phone", "email", "services_offered"]) {
    if (!answers[required]?.trim()) missing.push(required);
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required onboarding answers for website build: ${missing.join(", ")}. The client hasn't completed onboarding for this service.`
    );
  }

  // services_offered is stored as a textarea response; split on common
  // separators so the builder gets an array.
  const servicesOffered = answers.services_offered
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const buildData: WebsiteBuildData = {
    business_name: answers.business_name,
    niche: answers.niche,
    tagline: answers.tagline || undefined,
    primary_color: answers.primary_color || undefined,
    logo_url: answers.logo_url || undefined,
    phone: answers.phone,
    email: answers.email,
    address: answers.address || undefined,
    services_offered: servicesOffered,
    about_text: answers.about_text || undefined,
  };

  // --- 3. Find a niche template for this industry ---
  const template = await findNicheTemplate(supabase, orgId, buildData.niche);

  // --- 4. Resolve credentials. Use Vercel env vars if they're already set,
  // otherwise pull from org-stored creds and populate process.env so the
  // website-builder internals (which read directly from process.env) pick
  // them up. This is idempotent across invocations in the same Node process.
  const creds = await getOrgCredentials(supabase, orgId);

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

  // --- 5. Kick off the build ---
  await initiateWebsiteBuild(supabase, clientServiceId, buildData, template);

  // --- 6. Flip the client_service to in_progress. The builder only touches
  // service_tasks, not client_services, so we have to do this ourselves.
  await supabase
    .from("client_services")
    .update({
      status: "in_progress",
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientServiceId);

  // Re-read the task to grab the preview URL the builder wrote into
  // last_result on success. We return it to the caller so the UI can link
  // out to the preview.
  const { data: latestTask } = await supabase
    .from("service_tasks")
    .select("last_result")
    .eq("client_service_id", clientServiceId)
    .eq("task_type", "website_generation")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const lastResult = (latestTask as { last_result: Record<string, unknown> } | null)
    ?.last_result;
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
      source: "manual_start_website_build",
    },
  });

  revalidatePath(`/clients/${clientId}`);
  return { previewUrl, needsTemplate };
}
