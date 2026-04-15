import type {
  DataFieldDefinition,
  ServiceTask,
  ServiceTaskStatus,
} from "../types";
import type { SupabaseClient } from "../supabase/client";

/**
 * A2P 10DLC registration manager via Twilio API.
 *
 * Full A2P registration flow:
 * 1. Create Customer Profile (Trust Hub) — business identity verification
 * 2. Create A2P Brand — register the brand with The Campaign Registry (TCR)
 * 3. Create Messaging Service — link a phone number for sending
 * 4. Create A2P Campaign (Usa2p) — register the messaging use case
 *
 * Timeline: Brand registration takes 1-7 business days. Campaign takes 1-3 days.
 *
 * Twilio API docs:
 * - Trust Hub: https://www.twilio.com/docs/trust-hub/trusthub-rest-api
 * - Brand Registration: https://www.twilio.com/docs/messaging/api/brand-registration-resource
 * - Usa2p Campaign: https://www.twilio.com/docs/messaging/api/usapptoperson-resource
 * - Messaging Services: https://www.twilio.com/docs/messaging/api/service-resource
 */

export interface A2PRegistrationData {
  business_name: string;
  ein: string;
  business_address: string;
  business_city: string;
  business_state: string;
  business_zip: string;
  business_phone: string;
  contact_name: string;
  contact_email: string;
  use_case_description: string;
  sample_messages: string[];
}

interface TwilioA2PConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

function getTwilioConfig(): TwilioA2PConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !phoneNumber) {
    throw new Error(
      "Missing Twilio config: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER"
    );
  }

  return { accountSid, authToken, phoneNumber };
}

function getAuthHeader(): string {
  const config = getTwilioConfig();
  return `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`;
}

/**
 * Make a request to Twilio APIs.
 * Supports Trust Hub, Messaging, and Core APIs.
 * For array parameters (like MessageSamples), pass them as repeated keys in the body.
 */
async function twilioRequest(
  path: string,
  options: {
    method?: string;
    body?: Record<string, string | string[]>;
    api?: "trusthub" | "messaging" | "core";
  } = {}
): Promise<Record<string, unknown>> {
  const config = getTwilioConfig();
  const api = options.api || "trusthub";

  let baseUrl: string;
  switch (api) {
    case "messaging":
      baseUrl = "https://messaging.twilio.com/v1";
      break;
    case "core":
      baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}`;
      break;
    default:
      baseUrl = "https://trusthub.twilio.com/v1";
  }

  const headers: Record<string, string> = {
    Authorization: getAuthHeader(),
  };

  let requestBody: string | undefined;

  if (options.body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    // URLSearchParams handles repeated keys for array values
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.body)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          params.append(key, item);
        }
      } else {
        params.append(key, value);
      }
    }
    requestBody = params.toString();
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    ...(requestBody ? { body: requestBody } : {}),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Twilio API error (${response.status}): ${errorBody}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

/**
 * Look up the PhoneNumberSid (PN...) for an E.164 phone number.
 * Twilio Messaging Service requires the SID, not the number.
 */
async function lookupPhoneNumberSid(phoneNumber: string): Promise<string> {
  const result = await twilioRequest(
    `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`,
    { api: "core" }
  );

  const numbers = result.incoming_phone_numbers as Array<{ sid: string }> | undefined;
  if (!numbers || numbers.length === 0) {
    throw new Error(`Phone number ${phoneNumber} not found in Twilio account`);
  }

  return numbers[0].sid;
}

/**
 * Submits an A2P 10DLC registration via Twilio API.
 * Multi-step: Customer Profile → Brand Registration → (async approval) → Messaging Service → Campaign
 */
export async function submitA2PRegistration(
  supabase: SupabaseClient,
  clientServiceId: string,
  data: A2PRegistrationData
): Promise<ServiceTask> {
  // Create a service task to track the registration
  const { data: task, error } = await supabase
    .from("service_tasks")
    .insert({
      client_service_id: clientServiceId,
      task_type: "a2p_registration",
      status: "in_progress" as ServiceTaskStatus,
      external_ref: null,
      next_check_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      attempt_count: 1,
      last_result: { submitted_data: data, step: "customer_profile" },
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create A2P task: ${error.message}`);

  const taskId = (task as ServiceTask).id;

  try {
    // Step 1: Create Customer Profile (Trust Hub)
    const customerProfile = await twilioRequest("/CustomerProfiles", {
      method: "POST",
      body: {
        FriendlyName: `${data.business_name} A2P Profile`,
        Email: data.contact_email,
        PolicySid: "RN806dd6cd175f314e1f96a9727ee271f4", // A2P Starter Trust Bundle policy (global)
        StatusCallback: `${process.env.NEXT_PUBLIC_APP_URL || ""}/api/webhooks/twilio-a2p`,
      },
    });

    const customerProfileSid = customerProfile.sid as string;

    // Add business info as EndUser to the profile
    const endUser = await twilioRequest("/EndUsers", {
      method: "POST",
      body: {
        FriendlyName: data.business_name,
        Type: "customer_profile_business_information",
        Attributes: JSON.stringify({
          business_name: data.business_name,
          business_identity: "direct_customer",
          business_type: "Sole Proprietorship",
          business_registration_identifier: data.ein,
          business_registration_number: data.ein,
          business_regions_of_operation: "US",
          social_media_profile_urls: "",
          website_url: "",
          business_industry: "PROFESSIONAL",
        }),
      },
    });

    // Assign EndUser to Customer Profile
    await twilioRequest(`/CustomerProfiles/${customerProfileSid}/EntityAssignments`, {
      method: "POST",
      body: {
        ObjectSid: endUser.sid as string,
      },
    });

    // Add authorized representative
    const authorizedRep = await twilioRequest("/EndUsers", {
      method: "POST",
      body: {
        FriendlyName: data.contact_name,
        Type: "authorized_representative_1",
        Attributes: JSON.stringify({
          first_name: data.contact_name.split(" ")[0],
          last_name: data.contact_name.split(" ").slice(1).join(" ") || data.contact_name,
          email: data.contact_email,
          phone_number: data.business_phone,
          business_title: "Owner",
          job_position: "Owner",
        }),
      },
    });

    await twilioRequest(`/CustomerProfiles/${customerProfileSid}/EntityAssignments`, {
      method: "POST",
      body: {
        ObjectSid: authorizedRep.sid as string,
      },
    });

    // Submit customer profile for evaluation
    await twilioRequest(`/CustomerProfiles/${customerProfileSid}/Evaluations`, {
      method: "POST",
      body: {
        PolicySid: "RN806dd6cd175f314e1f96a9727ee271f4",
      },
    });

    // Step 2: Create A2P Brand Registration
    const brandRegistration = await twilioRequest(
      "/a2p/BrandRegistrations",
      {
        method: "POST",
        body: {
          CustomerProfileBundleSid: customerProfileSid,
          A2PProfileBundleSid: customerProfileSid,
        },
        api: "messaging",
      }
    );

    const brandSid = brandRegistration.sid as string;

    // Update task with brand registration info — now wait for async approval
    await supabase
      .from("service_tasks")
      .update({
        status: "waiting_external" as ServiceTaskStatus,
        external_ref: brandSid,
        next_check_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        last_result: {
          submitted_data: data,
          step: "brand_registration",
          customer_profile_sid: customerProfileSid,
          brand_sid: brandSid,
          brand_status: brandRegistration.status,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    return {
      ...(task as ServiceTask),
      status: "waiting_external",
      external_ref: brandSid,
    };
  } catch (err) {
    await supabase
      .from("service_tasks")
      .update({
        status: "failed" as ServiceTaskStatus,
        last_result: {
          submitted_data: data,
          error: err instanceof Error ? err.message : String(err),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    throw err;
  }
}

/**
 * Checks the status of a pending A2P registration.
 * Handles the multi-step flow: brand approval → messaging service + campaign → campaign approval
 */
export async function checkA2PStatus(
  supabase: SupabaseClient,
  task: ServiceTask
): Promise<ServiceTaskStatus> {
  const lastResult = task.last_result as Record<string, unknown> | null;
  if (!lastResult) return task.status;

  const step = lastResult.step as string;
  const config = getTwilioConfig();

  try {
    if (step === "brand_registration") {
      // Check brand registration status
      const brandSid = task.external_ref;
      if (!brandSid) return task.status;

      const brand = await twilioRequest(`/a2p/BrandRegistrations/${brandSid}`, {
        api: "messaging",
      });

      const brandStatus = brand.status as string;

      if (brandStatus === "APPROVED") {
        const data = lastResult.submitted_data as A2PRegistrationData;

        // Step 3: Create Messaging Service
        const msgServiceResult = await twilioRequest("/Services", {
          method: "POST",
          body: {
            FriendlyName: `${data.business_name} SMS`,
            InboundRequestUrl: `${process.env.NEXT_PUBLIC_APP_URL || ""}/api/webhooks/twilio`,
            UseInboundWebhookOnNumber: "true",
          },
          api: "messaging",
        });

        const messagingServiceSid = (msgServiceResult as Record<string, string>).sid;

        // Look up the PhoneNumberSid from the E.164 number
        const phoneNumberSid = await lookupPhoneNumberSid(config.phoneNumber);

        // Add phone number to messaging service
        await twilioRequest(`/Services/${messagingServiceSid}/PhoneNumbers`, {
          method: "POST",
          body: {
            PhoneNumberSid: phoneNumberSid,
          },
          api: "messaging",
        });

        // Step 4: Create A2P Campaign (Usa2p) — under the Messaging Service
        const sampleMessages = data.sample_messages.length >= 2
          ? data.sample_messages.slice(0, 5)
          : [
              `Hi! Welcome to ${data.business_name}. We'll send you updates about your service. Reply STOP to opt out, HELP for help. Msg & data rates may apply.`,
              `Reminder from ${data.business_name}: you have an upcoming appointment. Reply C to confirm. Reply STOP to unsubscribe.`,
            ];

        const campaign = await twilioRequest(
          `/Services/${messagingServiceSid}/Compliance/Usa2p`,
          {
            method: "POST",
            body: {
              BrandRegistrationSid: brandSid,
              Description: data.use_case_description,
              MessageFlow: `Customers of ${data.business_name} opt in to receive messages when they provide their phone number during service signup or appointment booking. They can opt out at any time by replying STOP.`,
              UsAppToPersonUsecase: "MIXED",
              HasEmbeddedLinks: "true",
              HasEmbeddedPhone: "false",
              MessageSamples: sampleMessages,
              OptInMessage: `You have opted in to receive messages from ${data.business_name}. Msg & data rates may apply. Msg frequency varies. Reply HELP for help, STOP to cancel.`,
              OptOutMessage: `You have been unsubscribed from ${data.business_name} messages. No more messages will be sent. Reply START to re-subscribe.`,
              HelpMessage: `For help with ${data.business_name} messaging, contact us at ${data.contact_email} or call ${data.business_phone}. Reply STOP to opt out.`,
              OptInKeywords: ["START", "YES", "SUBSCRIBE"],
              OptOutKeywords: ["STOP", "CANCEL", "UNSUBSCRIBE", "END", "QUIT"],
              HelpKeywords: ["HELP", "INFO", "SUPPORT"],
            },
            api: "messaging",
          }
        );

        await supabase
          .from("service_tasks")
          .update({
            status: "waiting_external" as ServiceTaskStatus,
            next_check_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            last_result: {
              ...lastResult,
              step: "campaign_registration",
              brand_status: "APPROVED",
              campaign_sid: campaign.sid,
              campaign_status: campaign.status,
              messaging_service_sid: messagingServiceSid,
              phone_number_sid: phoneNumberSid,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", task.id);

        return "waiting_external";
      } else if (brandStatus === "FAILED") {
        await supabase
          .from("service_tasks")
          .update({
            status: "failed" as ServiceTaskStatus,
            last_result: {
              ...lastResult,
              brand_status: brandStatus,
              failure_reason: brand.failure_reason || "Brand registration rejected",
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", task.id);
        return "failed";
      }

      // Still pending — schedule next check
      await supabase
        .from("service_tasks")
        .update({
          next_check_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
          last_result: { ...lastResult, brand_status: brandStatus },
          attempt_count: task.attempt_count + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id);

      return "waiting_external";
    }

    if (step === "campaign_registration") {
      // Check campaign status via Messaging Service endpoint
      const campaignSid = lastResult.campaign_sid as string;
      const messagingServiceSid = lastResult.messaging_service_sid as string;
      if (!campaignSid || !messagingServiceSid) return task.status;

      const campaign = await twilioRequest(
        `/Services/${messagingServiceSid}/Compliance/Usa2p/${campaignSid}`,
        { api: "messaging" }
      );

      const campaignStatus = campaign.status as string;

      if (campaignStatus === "VERIFIED") {
        // A2P registration complete
        await supabase
          .from("service_tasks")
          .update({
            status: "completed" as ServiceTaskStatus,
            last_result: {
              ...lastResult,
              step: "completed",
              campaign_status: "VERIFIED",
              completed_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", task.id);

        // Update the client_service status
        await supabase
          .from("client_services")
          .update({
            status: "delivered",
            updated_at: new Date().toISOString(),
          })
          .eq("id", task.client_service_id);

        // Push verified phone number to GHL subaccount
        await pushPhoneToGHL(supabase, task);

        return "completed";
      } else if (campaignStatus === "FAILED") {
        await supabase
          .from("service_tasks")
          .update({
            status: "failed" as ServiceTaskStatus,
            last_result: {
              ...lastResult,
              campaign_status: campaignStatus,
              failure_reason: campaign.failure_reason || "Campaign rejected",
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", task.id);
        return "failed";
      }

      // Still pending
      await supabase
        .from("service_tasks")
        .update({
          next_check_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
          last_result: { ...lastResult, campaign_status: campaignStatus },
          attempt_count: task.attempt_count + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id);

      return "waiting_external";
    }
  } catch (err) {
    // Log error but don't fail the task — retry on next check
    await supabase
      .from("service_tasks")
      .update({
        next_check_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        last_result: {
          ...lastResult,
          last_check_error: err instanceof Error ? err.message : String(err),
        },
        attempt_count: task.attempt_count + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);
  }

  return task.status;
}

/**
 * After A2P campaign is verified, push the Twilio phone number
 * to the client's GHL subaccount so they can send SMS from GHL.
 *
 * GHL API: POST /locations/{locationId}/phone-numbers
 * Docs: https://highlevel.stoplight.io/docs/integrations
 */
async function pushPhoneToGHL(
  supabase: SupabaseClient,
  task: ServiceTask
): Promise<void> {
  const lastResult = task.last_result as Record<string, unknown> | null;
  if (!lastResult) return;

  const config = getTwilioConfig();
  const messagingServiceSid = lastResult.messaging_service_sid as string;

  // Resolve client from service task → client_service → client
  const { data: clientService } = await supabase
    .from("client_services")
    .select("client_id")
    .eq("id", task.client_service_id)
    .single();

  if (!clientService) return;

  const { data: client } = await supabase
    .from("clients")
    .select("id, ghl_sub_account_id, org_id")
    .eq("id", (clientService as Record<string, string>).client_id)
    .single();

  if (!client) return;
  const typedClient = client as { id: string; ghl_sub_account_id: string | null; org_id: string };

  if (!typedClient.ghl_sub_account_id) return; // No GHL subaccount — skip

  const ghlApiKey = process.env.GHL_API_KEY;
  if (!ghlApiKey) return; // GHL not configured — skip silently

  try {
    // Add the Twilio phone number to the GHL subaccount
    const response = await fetch(
      `https://services.leadconnectorhq.com/phone-numbers/`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ghlApiKey}`,
          "Content-Type": "application/json",
          Version: "2021-07-28",
        },
        body: JSON.stringify({
          locationId: typedClient.ghl_sub_account_id,
          name: `A2P Verified - ${config.phoneNumber}`,
          number: config.phoneNumber,
          twilioAccountSid: config.accountSid,
          twilioAuthToken: config.authToken,
          messagingServiceSid: messagingServiceSid || undefined,
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      // Log but don't fail — A2P is still complete even if GHL push fails
      await supabase.from("interaction_log").insert({
        client_id: typedClient.id,
        channel: "system",
        direction: "outbound",
        content_type: "system_event",
        content: `Failed to push A2P phone number to GHL: ${errorBody}`,
        metadata: { task_id: task.id, ghl_location: typedClient.ghl_sub_account_id },
      });
      return;
    }

    // Log success
    await supabase.from("interaction_log").insert({
      client_id: typedClient.id,
      channel: "system",
      direction: "outbound",
      content_type: "system_event",
      content: `A2P verified phone number ${config.phoneNumber} added to GHL subaccount`,
      metadata: {
        task_id: task.id,
        ghl_location: typedClient.ghl_sub_account_id,
        messaging_service_sid: messagingServiceSid,
      },
    });
  } catch {
    // Silent fail — don't break A2P completion over GHL issues
  }
}

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
const DEFAULT_WIDGET_MESSAGE_TYPES = [
  "appointment_reminders",
  "service_updates",
  "two_way_conversation",
];

function buildUseCaseDescription(
  businessName: string,
  messageTypes: string[]
): string {
  const labels = messageTypes
    .map((t) => MESSAGE_TYPE_LABELS[t] || t)
    .filter(Boolean);
  const joined = labels.length > 0 ? labels.join(", ") : "customer notifications";
  return `${businessName} sends ${joined} to customers who have opted in to receive text messages. Customers can opt out at any time by replying STOP. Reply HELP for support. Msg & data rates may apply.`;
}

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
): Promise<{
  triggered: boolean;
  reason: "submitted" | "no_a2p" | "already_triggered" | "incomplete" | "missing_fields" | "session_not_found";
  taskId?: string;
}> {
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
