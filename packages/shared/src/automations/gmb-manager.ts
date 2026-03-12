import type { ServiceTask, ServiceTaskStatus } from "../types";
import type { SupabaseClient } from "../supabase/client";

/**
 * Data needed to request GMB access.
 */
export interface GMBAccessData {
  google_account_email: string;
  business_name: string;
  business_address: string;
  business_phone: string;
  business_category: string;
  business_hours: Record<string, { open: string; close: string } | null>;
}

/**
 * Requests management access to a client's GMB listing via Google Business Profile API.
 * The client will receive a Google email to approve the access request.
 *
 * TODO: Wire up actual Google Business Profile API in Session 3.
 */
export async function requestGMBAccess(
  supabase: SupabaseClient,
  clientServiceId: string,
  data: GMBAccessData
): Promise<ServiceTask> {
  const { data: task, error } = await supabase
    .from("service_tasks")
    .insert({
      client_service_id: clientServiceId,
      task_type: "gmb_access_request",
      status: "pending" as ServiceTaskStatus,
      external_ref: null, // Will be Google API request ID
      next_check_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // Check in 4h
      attempt_count: 0,
      last_result: { submitted_data: data },
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create GMB task: ${error.message}`);

  // TODO: Actual Google Business Profile API calls:
  // 1. Search for the business listing
  // 2. Request management access
  // 3. Store request ID as external_ref

  return task as ServiceTask;
}

/**
 * Checks if the client has approved the GMB access request.
 * If not approved after several checks, the bot should follow up with the client.
 *
 * TODO: Wire up actual Google Business Profile API status check in Session 3.
 */
export async function checkGMBAccessStatus(
  supabase: SupabaseClient,
  task: ServiceTask
): Promise<{ status: ServiceTaskStatus; needs_client_followup: boolean }> {
  // TODO: Check Google API for access request status
  // If pending for >24h, flag for client follow-up

  const hoursWaiting =
    (Date.now() - new Date(task.created_at).getTime()) / (1000 * 60 * 60);

  return {
    status: task.status,
    needs_client_followup: hoursWaiting > 24 && task.status === "waiting_external",
  };
}
