import type {
  Client,
  ClientPackage,
  ClientService,
  OnboardingSession,
} from "../types";
import type { SupabaseClient } from "../supabase/client";
import { provisionSubAccount, deploySnapshot } from "./ghl-adapter";

export interface PaymentWebhookPayload {
  customer_name: string;
  customer_email: string;
  customer_phone?: string;
  business_name?: string;
  package_id: string;
  payment_ref: string;
  org_id?: string;
  metadata?: Record<string, unknown>;
}

export interface OnboardingInitResult {
  client: Client;
  client_package: ClientPackage;
  client_services: ClientService[];
  session: OnboardingSession;
}

/**
 * Handles the full onboarding initialization triggered by a payment event.
 * Flow: provision_client RPC (atomic: client + package + services + session) →
 *       provision GHL sub-account → deploy snapshot → queue first outreach
 *
 * NOTE: supabase migration 00005 must be deployed before this runs,
 * or the rpc('provision_client') call will fail with "function not found".
 * Run `supabase db push` locally before testing.
 */
export async function handlePaymentWebhook(
  supabase: SupabaseClient,
  orgId: string,
  payload: PaymentWebhookPayload
): Promise<OnboardingInitResult> {
  // 1. Atomically create client, client_package, client_services, and session
  //    via provision_client plpgsql function (security definer, single transaction).
  const { data: provisionResult, error: provisionError } = await supabase.rpc(
    "provision_client",
    {
      p_org_id:        orgId,
      p_name:          payload.customer_name,
      p_email:         payload.customer_email,
      p_phone:         payload.customer_phone || null,
      p_business_name: payload.business_name || null,
      p_payment_ref:   payload.payment_ref,
      p_package_id:    payload.package_id,
      p_metadata:      payload.metadata || {},
    }
  );

  if (provisionError) {
    throw new Error(`Provisioning failed: ${provisionError.message}`);
  }

  // 2. Handle idempotent case — duplicate payment webhook for same payment_ref
  if ((provisionResult as { idempotent: boolean }).idempotent) {
    const clientId = (provisionResult as { client_id: string }).client_id;
    const { data: existingClient } = await supabase.from("clients").select("*").eq("id", clientId).single();
    const { data: existingSession } = await supabase.from("onboarding_sessions").select("*").eq("client_id", clientId).single();
    const { data: existingPackage } = await supabase.from("client_packages").select("*").eq("client_id", clientId).single();
    const { data: existingServices } = await supabase.from("client_services").select("*").eq("client_id", clientId);

    return {
      client: existingClient as Client,
      client_package: existingPackage as ClientPackage,
      client_services: (existingServices || []) as ClientService[],
      session: existingSession as OnboardingSession,
    };
  }

  // 3. Extract provisioned IDs from RPC result
  const result = provisionResult as {
    client_id: string;
    package_id: string;
    session_id: string;
    idempotent: boolean;
  };

  // 4. Fetch the created records (needed for GHL provisioning and return type)
  const { data: client } = await supabase.from("clients").select("*").eq("id", result.client_id).single();
  const { data: clientPackage } = await supabase.from("client_packages").select("*").eq("id", result.package_id).single();
  const { data: session } = await supabase.from("onboarding_sessions").select("*").eq("id", result.session_id).single();
  const { data: clientServices } = await supabase.from("client_services").select("*").eq("client_id", result.client_id);

  const typedClient = client as Client;
  const typedClientServices = (clientServices || []) as ClientService[];

  // 5. Provision GHL sub-account immediately upon payment
  // External API calls remain outside the transaction — correct by design.
  // Find the GHL automations service to link the task to
  const ghlService = typedClientServices.find((cs) => {
    // Try to match the GHL automation service
    const serviceData = typedClientServices.find((s) => s.service_id === cs.service_id);
    return serviceData !== undefined; // We'll use the first service as fallback
  });

  if (ghlService) {
    try {
      await provisionSubAccount(supabase, typedClient, ghlService.id);

      // If provisioning succeeded, deploy snapshot
      // Refresh client to get ghl_sub_account_id
      const { data: updatedClient } = await supabase
        .from("clients")
        .select()
        .eq("id", typedClient.id)
        .single();

      if (updatedClient && (updatedClient as Client).ghl_sub_account_id) {
        const snapshotId = process.env.GHL_SNAPSHOT_ID || "";
        if (snapshotId) {
          await deploySnapshot(
            supabase,
            ghlService.id,
            (updatedClient as Client).ghl_sub_account_id!,
            snapshotId
          );
        }
      }
    } catch (err) {
      // Log but don't fail — onboarding should continue even if GHL provisioning fails
      console.error("GHL provisioning failed (will retry):", err instanceof Error ? err.message : err);
    }
  }

  // 6. Queue initial outreach (SMS with onboarding link)
  await supabase.from("outreach_queue").insert({
    client_id: client!.id,
    session_id: session!.id,
    channel: "sms",
    message_template: "welcome_sms",
    message_params: {
      name: client!.name,
      business: client!.business_name || "",
      link: `{{WIDGET_URL}}?session=${session!.id}`,
    },
    scheduled_at: new Date().toISOString(),
    status: "pending",
    attempt_count: 0,
    priority: "normal",
    escalation_level: 1,
  });

  // 7. Log the payment event
  await supabase.from("interaction_log").insert({
    client_id: client!.id,
    session_id: session!.id,
    channel: "system",
    direction: "inbound",
    content_type: "system_event",
    content: `Payment received: ${payload.payment_ref}`,
    metadata: {
      payment_ref: payload.payment_ref,
      package_id: payload.package_id,
      services_count: typedClientServices.length,
    },
  });

  return {
    client: typedClient,
    client_package: clientPackage as ClientPackage,
    client_services: typedClientServices,
    session: session as OnboardingSession,
  };
}
