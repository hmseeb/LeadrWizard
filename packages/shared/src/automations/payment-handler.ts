import type {
  Client,
  ClientPackage,
  ClientService,
  OnboardingSession,
  OutreachQueueItem,
} from "../types";
import type { SupabaseClient } from "../supabase/client";

export interface PaymentWebhookPayload {
  customer_name: string;
  customer_email: string;
  customer_phone?: string;
  business_name?: string;
  package_id: string;
  payment_ref: string;
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
 *       provision GHL sub-account → create session → queue first outreach
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

  // 4. Create onboarding session
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

  // 5. Queue initial outreach (SMS with onboarding link)
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

  // TODO: Provision GHL sub-account via ghl-adapter
  // TODO: Deploy GHL snapshot via ghl-adapter

  return {
    client: client as Client,
    client_package: clientPackage as ClientPackage,
    client_services: (clientServices || []) as ClientService[],
    session: session as OnboardingSession,
  };
}
