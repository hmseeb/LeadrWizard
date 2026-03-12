import type { ServiceTask, ServiceTaskStatus } from "../types";
import type { SupabaseClient } from "../supabase/client";

/**
 * Data required for A2P 10DLC registration via Twilio.
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

/**
 * Submits an A2P 10DLC registration via Twilio API.
 * This creates a brand, campaign, and messaging service.
 *
 * TODO: Wire up actual Twilio API calls in Session 2.
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
      status: "pending" as ServiceTaskStatus,
      external_ref: null, // Will be Twilio brand/campaign ID
      next_check_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Check in 24h
      attempt_count: 0,
      last_result: { submitted_data: data },
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create A2P task: ${error.message}`);

  // TODO: Actual Twilio API calls:
  // 1. Create Customer Profile (Trust Hub)
  // 2. Create A2P Brand
  // 3. Create A2P Campaign
  // 4. Create Messaging Service
  // 5. Associate phone number with Messaging Service

  return task as ServiceTask;
}

/**
 * Checks the status of a pending A2P registration.
 * Called by pg_cron job on schedule.
 *
 * TODO: Wire up actual Twilio status check in Session 2.
 */
export async function checkA2PStatus(
  supabase: SupabaseClient,
  task: ServiceTask
): Promise<ServiceTaskStatus> {
  // TODO: Check Twilio API for campaign status
  // Possible outcomes: approved, pending, failed, rejected

  // For now, return current status
  return task.status;
}
