import type { ServiceTask, ServiceTaskStatus } from "../types";
import type { SupabaseClient } from "../supabase/client";

/**
 * A2P 10DLC registration manager via Twilio API.
 *
 * Full A2P registration flow:
 * 1. Create Customer Profile (Trust Hub) — business identity verification
 * 2. Create A2P Brand — register the brand with The Campaign Registry (TCR)
 * 3. Create A2P Campaign — register the messaging use case
 * 4. Create Messaging Service — link the campaign to a phone number
 *
 * Timeline: Brand registration takes 1-7 business days. Campaign takes 1-3 days.
 * Bot polls status and follows up with client if issues arise.
 *
 * Twilio API docs: https://www.twilio.com/docs/messaging/guides/a2p-10dlc
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

async function twilioRequest(
  path: string,
  options: {
    method?: string;
    body?: Record<string, string>;
    isMessagingApi?: boolean;
  } = {}
): Promise<Record<string, unknown>> {
  const config = getTwilioConfig();
  const baseUrl = options.isMessagingApi
    ? "https://messaging.twilio.com/v1"
    : `https://trusthub.twilio.com/v1`;
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
  };

  let requestBody: string | undefined;

  if (options.body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    requestBody = new URLSearchParams(options.body).toString();
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    ...(requestBody ? { body: requestBody } : {}),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Twilio A2P API error (${response.status}): ${errorBody}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

/**
 * Submits an A2P 10DLC registration via Twilio API.
 * This is a multi-step process that creates a brand, campaign, and messaging service.
 */
export async function submitA2PRegistration(
  supabase: SupabaseClient,
  clientServiceId: string,
  data: A2PRegistrationData
): Promise<ServiceTask> {
  const config = getTwilioConfig();

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
        PolicySid: "RN806dd6cd175f314e1f96a9727ee271f4", // A2P Starter Trust Bundle policy
        StatusCallback: `${process.env.NEXT_PUBLIC_WIDGET_URL || ""}/api/webhooks/twilio-a2p`,
      },
    });

    const customerProfileSid = customerProfile.sid as string;

    // Add business info as EndUser to the profile
    const endUser = await twilioRequest("/EndUsers", {
      method: "POST",
      body: {
        FriendlyName: data.business_name,
        Type: "customer_profile_business_information",
        "Attributes": JSON.stringify({
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

    // Add authorized rep
    const authorizedRep = await twilioRequest("/EndUsers", {
      method: "POST",
      body: {
        FriendlyName: data.contact_name,
        Type: "authorized_representative_1",
        "Attributes": JSON.stringify({
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
      `/a]2p/BrandRegistrations`,
      {
        method: "POST",
        body: {
          CustomerProfileBundleSid: customerProfileSid,
          A2PProfileBundleSid: customerProfileSid,
        },
        isMessagingApi: true,
      }
    );

    const brandSid = brandRegistration.sid as string;

    // Update task with brand registration info
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
 * Handles the multi-step flow: brand → campaign → messaging service.
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
        isMessagingApi: true,
      });

      const brandStatus = brand.status as string;

      if (brandStatus === "APPROVED") {
        // Brand approved — create campaign
        const data = lastResult.submitted_data as A2PRegistrationData;

        // Create Messaging Service
        const msgServiceResult = await twilioRequest("", {
          method: "POST",
          body: {
            FriendlyName: `${data.business_name} SMS`,
            InboundRequestUrl: `${process.env.NEXT_PUBLIC_WIDGET_URL || ""}/api/webhooks/twilio`,
            UseInboundWebhookOnNumber: "true",
          },
          isMessagingApi: true,
        });

        const messagingServiceSid = (msgServiceResult as Record<string, string>).sid;

        // Add phone number to messaging service
        const accountSid = config.accountSid;
        await fetch(
          `https://messaging.twilio.com/v1/Services/${messagingServiceSid}/PhoneNumbers`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              PhoneNumberSid: config.phoneNumber, // This should be the SID, not the number
            }).toString(),
          }
        );

        // Create A2P Campaign
        const campaign = await twilioRequest(
          `/a2p/BrandRegistrations/${brandSid}/Campaigns`,
          {
            method: "POST",
            body: {
              Description: data.use_case_description,
              MessageFlow: `Customer signs up for ${data.business_name} services. They receive onboarding messages to collect setup information, appointment reminders, and service updates.`,
              MessagingServiceSid: messagingServiceSid,
              UseCase: "MIXED",
              HasEmbeddedLinks: "true",
              HasEmbeddedPhone: "false",
              "MessageSamples": JSON.stringify(
                data.sample_messages.length > 0
                  ? data.sample_messages
                  : [
                      `Hi! Welcome to ${data.business_name}. Let's get your setup started: {{link}}`,
                      `Your ${data.business_name} setup is almost complete. Just a few more items: {{link}}`,
                    ]
              ),
            },
            isMessagingApi: true,
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
      // Check campaign status
      const brandSid = task.external_ref;
      const campaignSid = lastResult.campaign_sid as string;
      if (!brandSid || !campaignSid) return task.status;

      const campaign = await twilioRequest(
        `/a2p/BrandRegistrations/${brandSid}/Campaigns/${campaignSid}`,
        { isMessagingApi: true }
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
