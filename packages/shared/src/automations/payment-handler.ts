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
 * Flow: create client → create client_package → create client_services →
 *       provision GHL sub-account → deploy snapshot → create session → queue first outreach
 */
export async function handlePaymentWebhook(
  supabase: SupabaseClient,
  orgId: string,
  payload: PaymentWebhookPayload
): Promise<OnboardingInitResult> {
  // 1. Create client record
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .insert({
      org_id: orgId,
      name: payload.customer_name,
      email: payload.customer_email,
      phone: payload.customer_phone || null,
      business_name: payload.business_name || null,
      payment_ref: payload.payment_ref,
      metadata: payload.metadata || {},
    })
    .select()
    .single();

  if (clientError) throw new Error(`Failed to create client: ${clientError.message}`);

  // 2. Create client_package
  const { data: clientPackage, error: pkgError } = await supabase
    .from("client_packages")
    .insert({
      client_id: client.id,
      package_id: payload.package_id,
    })
    .select()
    .single();

  if (pkgError) throw new Error(`Failed to create client package: ${pkgError.message}`);

  // 3. Get services in this package and create client_services
  const { data: packageServices } = await supabase
    .from("package_services")
    .select("service_id")
    .eq("package_id", payload.package_id);

  const clientServicesData = (packageServices || []).map((ps) => ({
    client_id: client.id,
    service_id: ps.service_id,
    client_package_id: clientPackage.id,
    status: "pending_onboarding" as const,
    opted_out: false,
  }));

  const { data: clientServices, error: csError } = await supabase
    .from("client_services")
    .insert(clientServicesData)
    .select();

  if (csError) throw new Error(`Failed to create client services: ${csError.message}`);

  const typedClient = client as Client;
  const typedClientServices = (clientServices || []) as ClientService[];

  // 4. Provision GHL sub-account immediately upon payment
  // Find the GHL automations service to link the task to
  const ghlService = typedClientServices.find((cs) => {
    // Try to match the GHL automation service
    const serviceData = packageServices?.find((ps) => ps.service_id === cs.service_id);
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

  // 5. Create onboarding session
  const { data: session, error: sessionError } = await supabase
    .from("onboarding_sessions")
    .insert({
      client_id: client.id,
      org_id: orgId,
      status: "active",
      completion_pct: 0,
    })
    .select()
    .single();

  if (sessionError) throw new Error(`Failed to create session: ${sessionError.message}`);

  // 6. Queue initial outreach (SMS with onboarding link)
  await supabase.from("outreach_queue").insert({
    client_id: client.id,
    session_id: session.id,
    channel: "sms",
    message_template: "welcome_sms",
    message_params: {
      name: client.name,
      business: client.business_name || "",
      link: `{{WIDGET_URL}}?session=${session.id}`,
    },
    scheduled_at: new Date().toISOString(),
    status: "pending",
    attempt_count: 0,
    priority: "normal",
    escalation_level: 1,
  });

  // 7. Log the payment event
  await supabase.from("interaction_log").insert({
    client_id: client.id,
    session_id: session.id,
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
