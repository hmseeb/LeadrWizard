"use server";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
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

  await supabase.from("interaction_log").insert({
    client_id: clientId,
    channel: "system",
    direction: "outbound",
    content_type: "system_event",
    content: `GHL subaccount linked manually: ${trimmed}`,
    metadata: { ghl_sub_account_id: trimmed, source: "manual_link" },
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
