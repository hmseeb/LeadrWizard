"use server";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { maybeTriggerA2POnCompletion } from "@leadrwizard/shared/automations";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const A2P_SERVICE_SLUG = "a2p-registration";

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

  // GHL location
  const ghlLocationId = formData.get("ghl_location_id") as string;

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

  // Human-readable labels for logging the agency's selected message types.
  // The use-case description itself is built inside maybeTriggerA2POnCompletion
  // so the widget path and manual path produce identical Twilio payloads.
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

  // 2. Link GHL subaccount if selected
  if (ghlLocationId) {
    await supabase
      .from("clients")
      .update({
        ghl_sub_account_id: ghlLocationId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", result.client_id);
  }

  // 3. Load client services joined with service definitions so we can tell
  //    which rows are A2P and which are not.
  const { data: clientServices } = await supabase
    .from("client_services")
    .select("id, service_id, service:service_definitions(slug)")
    .eq("client_id", result.client_id);

  if (!clientServices || clientServices.length === 0) {
    throw new Error("No services found for client");
  }

  type ClientServiceRow = {
    id: string;
    service_id: string;
    service: { slug: string } | null;
  };
  const typedServices = clientServices as unknown as ClientServiceRow[];
  const a2pService = typedServices.find(
    (cs) => cs.service?.slug === A2P_SERVICE_SLUG
  );
  const nonA2pServices = typedServices.filter(
    (cs) => cs.service?.slug !== A2P_SERVICE_SLUG
  );

  if (!a2pService) {
    // The form was submitted for a package that does not actually contain A2P.
    // This is a misconfiguration; fail loudly rather than silently skipping.
    throw new Error(
      "Selected package does not contain the A2P service. Add it to the package or use the standard client flow."
    );
  }

  // 4. Pre-fill session_responses for the A2P service. For A2P-only packages
  //    this captures everything the helper needs to fire Twilio immediately.
  //    For multi-service packages it avoids re-asking the client for info the
  //    agency has already collected. We also stash the agency's custom
  //    `message_types` and `sample_messages` as JSON-encoded rows so the
  //    trigger helper can reconstruct the exact use-case description.
  const a2pResponses: Array<{
    session_id: string;
    client_service_id: string;
    field_key: string;
    field_value: string;
    answered_via: string;
  }> = [
    { field_key: "legal_business_name", field_value: legalBusinessName.trim() },
    { field_key: "ein", field_value: ein.trim() },
    { field_key: "business_address", field_value: businessAddress.trim() },
    { field_key: "business_city", field_value: businessCity.trim() },
    { field_key: "business_state", field_value: businessState.trim() },
    { field_key: "business_zip", field_value: businessZip.trim() },
    { field_key: "business_phone", field_value: businessPhone.trim() },
    { field_key: "contact_name", field_value: name.trim() },
    { field_key: "contact_email", field_value: email.trim() },
    { field_key: "message_types", field_value: JSON.stringify(messageTypes) },
    { field_key: "sample_messages", field_value: JSON.stringify(sampleMessages) },
  ].map((f) => ({
    session_id: result.session_id,
    client_service_id: a2pService.id,
    field_key: f.field_key,
    field_value: f.field_value,
    answered_via: "click",
  }));
  await supabase.from("session_responses").insert(a2pResponses);

  // 5. Try to fire A2P to Twilio. The helper is the single source of truth
  //    for "has the client finished onboarding?" — for an A2P-only package
  //    every required field is now pre-filled so this fires immediately; for
  //    a multi-service package this is a no-op and A2P will fire later from
  //    the widget response endpoint when the client answers the last field.
  //
  //    A Twilio failure here should NOT block client creation — the client,
  //    services, and session are all provisioned correctly and the agency
  //    can retry from the client detail page. We log the failure so it's
  //    visible on the client timeline.
  let a2pFireError: string | null = null;
  try {
    const triggerResult = await maybeTriggerA2POnCompletion(
      supabase,
      result.session_id
    );
    if (!triggerResult.triggered && triggerResult.reason !== "incomplete") {
      // "incomplete" is expected for multi-service packages; anything else
      // signals a configuration problem worth surfacing.
      a2pFireError = `A2P trigger skipped: ${triggerResult.reason}`;
    }
  } catch (err) {
    a2pFireError = err instanceof Error ? err.message : String(err);
  }

  if (a2pFireError) {
    await supabase.from("interaction_log").insert({
      client_id: result.client_id,
      session_id: result.session_id,
      channel: "system",
      direction: "outbound",
      content_type: "system_event",
      content: `A2P registration failed to submit to Twilio: ${a2pFireError}`,
      metadata: { source: "manual_a2p", error: a2pFireError },
    });
  }

  // 6. For multi-service packages, queue the welcome SMS so the client
  //    finishes the remaining services via the widget. A2P-only packages
  //    need no outreach — the agency already provided every required field,
  //    and the onboarding session will close automatically once A2P is
  //    VERIFIED by Twilio (see task-processor.checkForCompletedSessions).
  if (nonA2pServices.length > 0) {
    await supabase.from("outreach_queue").insert({
      client_id: result.client_id,
      session_id: result.session_id,
      channel: "sms",
      message_template: "welcome_sms",
      message_params: {
        name: name.trim(),
        business: legalBusinessName.trim(),
        link: `{{WIDGET_URL}}?session=${result.session_id}`,
      },
      scheduled_at: new Date().toISOString(),
      status: "pending",
      attempt_count: 0,
      priority: "normal",
      escalation_level: 1,
    });
  } else {
    // A2P-only package: bump completion_pct to 100 since there are no
    // widget questions to answer. Session status stays 'active' until the
    // cron flips it to 'completed' after Twilio VERIFIED.
    await supabase
      .from("onboarding_sessions")
      .update({
        completion_pct: 100,
        updated_at: new Date().toISOString(),
      })
      .eq("id", result.session_id);
  }

  // 7. Log the event. For A2P-only packages the trigger helper above has
  //    already submitted to Twilio; for multi-service packages A2P will fire
  //    from the widget response endpoint once the client finishes their
  //    onboarding, so we log that A2P is queued rather than submitted.
  await supabase.from("interaction_log").insert({
    client_id: result.client_id,
    session_id: result.session_id,
    channel: "system",
    direction: "outbound",
    content_type: "system_event",
    content:
      nonA2pServices.length === 0
        ? `A2P registration submitted by agency. Message types: ${selectedLabels.join(", ")}`
        : `A2P data collected by agency (${selectedLabels.join(", ")}). Onboarding queued for ${nonA2pServices.length} additional service(s); A2P will fire to Twilio once the client completes their widget.`,
    metadata: {
      message_types: messageTypes,
      source: "manual_a2p",
      non_a2p_services: nonA2pServices.length,
    },
  });

  revalidatePath("/clients");
  revalidatePath("/onboardings");
  revalidatePath("/dashboard");
  redirect(`/clients/${result.client_id}`);
}

/**
 * Lightweight "create client without payment" flow.
 * Provisions the client + services + session, then queues the welcome outreach
 * so the client receives the onboarding link — identical to what the payment
 * webhook does, just triggered manually from the admin UI.
 *
 * Use this for comped accounts, out-of-band payments, demos, or internal testing.
 */
export async function startClientProvision(formData: FormData) {
  const { supabase, orgId } = await getAuthedOrg();

  const name = (formData.get("customer_name") as string | null)?.trim() ?? "";
  const email = (formData.get("customer_email") as string | null)?.trim() ?? "";
  const phone = (formData.get("customer_phone") as string | null)?.trim() ?? "";
  const businessName = (formData.get("business_name") as string | null)?.trim() ?? "";
  const packageId = (formData.get("package_id") as string | null) ?? "";

  if (!name || name.length < 2) throw new Error("Client name is required");
  if (!email || !email.includes("@")) throw new Error("Valid email is required");
  if (!packageId) throw new Error("Please select a package");

  const paymentRef = `provision_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const { data: provisionResult, error: provisionError } = await supabase.rpc(
    "provision_client",
    {
      p_org_id: orgId,
      p_name: name,
      p_email: email,
      p_phone: phone || null,
      p_business_name: businessName || null,
      p_payment_ref: paymentRef,
      p_package_id: packageId,
      p_metadata: { source: "manual_provision" },
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

  // Queue the welcome SMS so the client gets the onboarding link, matching
  // what handlePaymentWebhook does after a real payment.
  await supabase.from("outreach_queue").insert({
    client_id: result.client_id,
    session_id: result.session_id,
    channel: "sms",
    message_template: "welcome_sms",
    message_params: {
      name,
      business: businessName,
      link: `{{WIDGET_URL}}?session=${result.session_id}`,
    },
    scheduled_at: new Date().toISOString(),
    status: "pending",
    attempt_count: 0,
    priority: "normal",
    escalation_level: 1,
  });

  await supabase.from("interaction_log").insert({
    client_id: result.client_id,
    session_id: result.session_id,
    channel: "system",
    direction: "outbound",
    content_type: "system_event",
    content: "Client provisioned manually by agency (no payment webhook).",
    metadata: { source: "manual_provision", package_id: packageId },
  });

  revalidatePath("/clients");
  revalidatePath("/onboardings");
  revalidatePath("/dashboard");
  redirect(`/clients/${result.client_id}`);
}
