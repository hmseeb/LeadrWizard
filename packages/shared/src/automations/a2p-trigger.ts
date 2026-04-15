import type { DataFieldDefinition } from "../types";
import type { SupabaseClient } from "../supabase/client";
import { submitA2PRegistration } from "./a2p-manager";

/**
 * Labels used to turn the agency's selected `message_types` into the
 * human-readable `use_case_description` Twilio requires on a campaign.
 * Kept in sync with the labels in the NewClientForm and `startManualOnboarding`.
 */
const MESSAGE_TYPE_LABELS: Record<string, string> = {
  appointment_reminders: "appointment reminders",
  missed_call_textback: "missed call follow-ups",
  review_requests: "review requests",
  promotional: "promotional offers",
  service_updates: "service status updates",
  two_way_conversation: "two-way customer support",
  booking_confirmation: "booking confirmations",
  follow_up: "post-service follow-ups",
};

/**
 * Default message types used when the widget path collects A2P fields
 * directly (no agency NewClientForm pre-fill) — picks the lowest-risk
 * set that Twilio / TCR reliably accepts.
 */
export const DEFAULT_WIDGET_MESSAGE_TYPES = [
  "appointment_reminders",
  "service_updates",
  "two_way_conversation",
];

export function buildUseCaseDescription(
  businessName: string,
  messageTypes: string[]
): string {
  const labels = messageTypes
    .map((t) => MESSAGE_TYPE_LABELS[t] || t)
    .filter(Boolean);
  const joined = labels.length > 0 ? labels.join(", ") : "customer notifications";
  return `${businessName} sends ${joined} to customers who have opted in to receive text messages. Customers can opt out at any time by replying STOP. Reply HELP for support. Msg & data rates may apply.`;
}

export type MaybeTriggerA2PResult = {
  triggered: boolean;
  reason:
    | "submitted"
    | "no_a2p"
    | "already_triggered"
    | "incomplete"
    | "missing_fields"
    | "session_not_found";
  taskId?: string;
};

/**
 * Fires the A2P registration to Twilio *when* onboarding data collection is
 * complete for a session. Idempotent — safe to call on every widget response
 * and from `startManualOnboarding`.
 *
 * Gating rules:
 * 1. The session's client must have a non-opted-out `a2p-registration` service.
 * 2. That service must still be in `pending_onboarding` (not already triggered).
 * 3. Every non-opted-out service in the session must have all its required
 *    fields answered in `session_responses` — i.e. the client has finished
 *    their onboarding.
 *
 * When all three pass, the helper extracts the 9 A2P fields (plus optional
 * `message_types` / `sample_messages`) from `session_responses`, builds the
 * `A2PRegistrationData`, calls `submitA2PRegistration`, and promotes the A2P
 * `client_services.status` to `in_progress`.
 *
 * Returns a result object instead of throwing on "not ready yet" — callers
 * can log it for debugging without special-casing control flow. Twilio errors
 * from `submitA2PRegistration` *do* bubble up so the call site can decide
 * between Sentry-and-continue (widget path) and log-to-interaction-log
 * (manual agency path).
 */
export async function maybeTriggerA2POnCompletion(
  supabase: SupabaseClient,
  sessionId: string
): Promise<MaybeTriggerA2PResult> {
  // 1. Load session → client.
  const { data: session } = await supabase
    .from("onboarding_sessions")
    .select("id, client_id, org_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    return { triggered: false, reason: "session_not_found" };
  }

  const typedSession = session as { id: string; client_id: string; org_id: string };

  // 2. Load client (needed for contact_name/email fallback).
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, email")
    .eq("id", typedSession.client_id)
    .maybeSingle();

  if (!client) {
    return { triggered: false, reason: "session_not_found" };
  }

  const typedClient = client as { id: string; name: string; email: string };

  // 3. Load all non-opted-out client_services with their service definitions.
  const { data: clientServicesRaw } = await supabase
    .from("client_services")
    .select(
      "id, service_id, status, opted_out, service:service_definitions(slug, required_data_fields)"
    )
    .eq("client_id", typedSession.client_id)
    .eq("opted_out", false);

  type ClientServiceRow = {
    id: string;
    service_id: string;
    status: string;
    opted_out: boolean;
    service: { slug: string; required_data_fields: DataFieldDefinition[] } | null;
  };
  const clientServices = (clientServicesRaw || []) as unknown as ClientServiceRow[];

  // 4. Find the A2P service.
  const a2pService = clientServices.find(
    (cs) => cs.service?.slug === "a2p-registration"
  );
  if (!a2pService) {
    return { triggered: false, reason: "no_a2p" };
  }

  // 5. Idempotency guard — only fire from pending_onboarding.
  if (a2pService.status !== "pending_onboarding") {
    return { triggered: false, reason: "already_triggered" };
  }

  // 6. Load all session_responses for the session.
  const { data: responsesRaw } = await supabase
    .from("session_responses")
    .select("field_key, field_value, client_service_id")
    .eq("session_id", sessionId);

  type ResponseRow = {
    field_key: string;
    field_value: string;
    client_service_id: string | null;
  };
  const responses = (responsesRaw || []) as ResponseRow[];

  // 7. Check completeness — every non-opted-out service must have all its
  //    required fields answered. This is the "client finished onboarding"
  //    gate.
  for (const cs of clientServices) {
    const requiredFields = (cs.service?.required_data_fields || []).filter(
      (f) => f.required
    );
    if (requiredFields.length === 0) continue;

    const answeredKeys = new Set(
      responses
        .filter((r) => r.client_service_id === cs.id)
        .map((r) => r.field_key)
    );

    const allAnswered = requiredFields.every((f) => answeredKeys.has(f.key));
    if (!allAnswered) {
      return { triggered: false, reason: "incomplete" };
    }
  }

  // 8. Extract A2P fields from session_responses.
  const a2pResponses = responses.filter(
    (r) => r.client_service_id === a2pService.id
  );
  const byKey: Record<string, string> = {};
  for (const r of a2pResponses) {
    byKey[r.field_key] = r.field_value;
  }

  const legalBusinessName = byKey.legal_business_name;
  const ein = byKey.ein;
  const businessAddress = byKey.business_address;
  const businessCity = byKey.business_city;
  const businessState = byKey.business_state;
  const businessZip = byKey.business_zip;
  const businessPhone = byKey.business_phone;
  const contactName = byKey.contact_name || typedClient.name;
  const contactEmail = byKey.contact_email || typedClient.email;

  if (
    !legalBusinessName ||
    !ein ||
    !businessAddress ||
    !businessCity ||
    !businessState ||
    !businessZip ||
    !businessPhone
  ) {
    // Required-field check above should have caught this, but guard anyway
    // so we never send a half-populated payload to Twilio.
    return { triggered: false, reason: "missing_fields" };
  }

  // 9. Pull optional message_types / sample_messages that the agency form
  //    stores as JSON-encoded session_responses. Fall back to widget defaults.
  let messageTypes: string[] = [];
  try {
    messageTypes = byKey.message_types
      ? (JSON.parse(byKey.message_types) as string[])
      : [];
  } catch {
    messageTypes = [];
  }
  if (messageTypes.length === 0) {
    messageTypes = DEFAULT_WIDGET_MESSAGE_TYPES;
  }

  let sampleMessages: string[] = [];
  try {
    sampleMessages = byKey.sample_messages
      ? (JSON.parse(byKey.sample_messages) as string[])
      : [];
  } catch {
    sampleMessages = [];
  }

  const useCaseDescription = buildUseCaseDescription(
    legalBusinessName,
    messageTypes
  );

  // 10. Fire the Twilio registration.
  const task = await submitA2PRegistration(supabase, a2pService.id, {
    business_name: legalBusinessName,
    ein,
    business_address: businessAddress,
    business_city: businessCity,
    business_state: businessState,
    business_zip: businessZip,
    business_phone: businessPhone,
    contact_name: contactName,
    contact_email: contactEmail,
    use_case_description: useCaseDescription,
    sample_messages: sampleMessages,
  });

  // 11. Promote the A2P client_service from pending_onboarding → in_progress.
  //     (checkA2PStatus will eventually flip it to 'delivered' on VERIFIED.)
  await supabase
    .from("client_services")
    .update({
      status: "in_progress",
      updated_at: new Date().toISOString(),
    })
    .eq("id", a2pService.id);

  // 12. Log the trigger moment.
  await supabase.from("interaction_log").insert({
    client_id: typedClient.id,
    session_id: typedSession.id,
    channel: "system",
    direction: "outbound",
    content_type: "system_event",
    content: "A2P registration submitted to Twilio after onboarding completion.",
    metadata: {
      task_id: task.id,
      message_types: messageTypes,
      sample_messages_count: sampleMessages.length,
    },
  });

  return { triggered: true, reason: "submitted", taskId: task.id };
}
