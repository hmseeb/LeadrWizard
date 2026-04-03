import type { ServiceTask, ServiceTaskStatus } from "../types";
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
