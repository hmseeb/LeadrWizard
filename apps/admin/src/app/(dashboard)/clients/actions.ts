"use server";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { submitA2PRegistration } from "@leadrwizard/shared/automations";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function getAuthedOrg() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const serviceClient = createSupabaseServiceClient();
  const orgData = await getUserOrg(serviceClient, user.id);
  if (!orgData || !["owner", "admin"].includes(orgData.role)) {
    throw new Error("Insufficient permissions");
  }

  return { supabase: serviceClient, orgId: orgData.org.id };
}

export async function startManualOnboarding(formData: FormData) {
  const { supabase, orgId } = await getAuthedOrg();

  // Client contact info
  const name = formData.get("customer_name") as string;
  const email = formData.get("customer_email") as string;
  const phone = formData.get("customer_phone") as string;
  const packageId = formData.get("package_id") as string;

  // A2P business info
  const legalBusinessName = formData.get("legal_business_name") as string;
  const ein = formData.get("ein") as string;
  const businessAddress = formData.get("business_address") as string;
  const businessCity = formData.get("business_city") as string;
  const businessState = formData.get("business_state") as string;
  const businessZip = formData.get("business_zip") as string;
  const businessPhone = formData.get("business_phone") as string;

  // Message types and samples
  const messageTypes = JSON.parse((formData.get("message_types") as string) || "[]") as string[];
  const sampleMessages = JSON.parse((formData.get("sample_messages") as string) || "[]") as string[];

  // Validation
  if (!name || name.trim().length < 2) throw new Error("Client name is required");
  if (!email || !email.includes("@")) throw new Error("Valid email is required");
  if (!packageId) throw new Error("Please select a package");
  if (!legalBusinessName) throw new Error("Legal business name is required");
  if (!ein) throw new Error("EIN is required");
  if (!businessAddress) throw new Error("Business address is required");
  if (!businessCity) throw new Error("City is required");
  if (!businessState) throw new Error("State is required");
  if (!businessZip) throw new Error("ZIP code is required");
  if (!businessPhone) throw new Error("Business phone is required");
  if (messageTypes.length === 0) throw new Error("Select at least one message type");

  // Build use case description from selected message types
  const messageTypeLabels: Record<string, string> = {
    appointment_reminders: "appointment reminders",
    missed_call_textback: "missed call follow-ups",
    review_requests: "review requests",
    promotional: "promotional offers",
    service_updates: "service status updates",
    two_way_conversation: "two-way customer support",
    booking_confirmation: "booking confirmations",
    follow_up: "post-service follow-ups",
  };
  const selectedLabels = messageTypes.map((t) => messageTypeLabels[t] || t);
  const useCase = `${legalBusinessName} sends ${selectedLabels.join(", ")} to customers who have opted in to receive text messages. Customers can opt out at any time by replying STOP. Reply HELP for support. Msg & data rates may apply.`;

  // 1. Provision client (creates client, session, client_services)
  const paymentRef = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const { data: provisionResult, error: provisionError } = await supabase.rpc(
    "provision_client",
    {
      p_org_id: orgId,
      p_name: name.trim(),
      p_email: email.trim(),
      p_phone: phone?.trim() || null,
      p_business_name: legalBusinessName.trim(),
      p_payment_ref: paymentRef,
      p_package_id: packageId,
      p_metadata: {
        source: "manual_a2p",
        message_types: messageTypes,
        a2p_data: {
          legal_business_name: legalBusinessName.trim(),
          ein: ein.trim(),
          business_address: businessAddress.trim(),
          business_city: businessCity.trim(),
          business_state: businessState.trim(),
          business_zip: businessZip.trim(),
          business_phone: businessPhone.trim(),
        },
      },
    }
  );

  if (provisionError) {
    throw new Error(`Failed to create client: ${provisionError.message}`);
  }

  const result = provisionResult as {
    client_id: string;
    package_id: string;
    session_id: string;
    idempotent: boolean;
  };

  // 2. Find the A2P client_service to attach the task to
  const { data: clientServices } = await supabase
    .from("client_services")
    .select("id, service_id")
    .eq("client_id", result.client_id);

  if (!clientServices || clientServices.length === 0) {
    throw new Error("No services found for client");
  }

  const clientServiceId = clientServices[0].id;

  // 3. Submit A2P registration directly to Twilio (no client outreach)
  await submitA2PRegistration(supabase, clientServiceId, {
    business_name: legalBusinessName.trim(),
    ein: ein.trim(),
    business_address: businessAddress.trim(),
    business_city: businessCity.trim(),
    business_state: businessState.trim(),
    business_zip: businessZip.trim(),
    business_phone: businessPhone.trim(),
    contact_name: name.trim(),
    contact_email: email.trim(),
    use_case_description: useCase,
    sample_messages: sampleMessages,
  });

  // 4. Mark the session as completed (no onboarding needed — we have all the data)
  await supabase
    .from("onboarding_sessions")
    .update({
      status: "completed",
      completion_pct: 100,
      updated_at: new Date().toISOString(),
    })
    .eq("id", result.session_id);

  // 5. Log the event
  await supabase.from("interaction_log").insert({
    client_id: result.client_id,
    session_id: result.session_id,
    channel: "system",
    direction: "outbound",
    content_type: "system_event",
    content: `A2P registration submitted by agency. Message types: ${selectedLabels.join(", ")}`,
    metadata: { message_types: messageTypes, source: "manual_a2p" },
  });

  revalidatePath("/clients");
  revalidatePath("/onboardings");
  revalidatePath("/dashboard");
  redirect("/clients");
}
