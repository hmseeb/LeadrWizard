import type { Client, ServiceTask, ServiceTaskStatus } from "../types";
import type { SupabaseClient } from "../supabase/client";

/**
 * GoHighLevel API adapter.
 * Handles sub-account provisioning, snapshot deployment, and contact sync.
 * GHL is used as a data sink — NOT the orchestration layer.
 *
 * TODO: Wire up actual GHL API calls in Session 3.
 */

export interface GHLSubAccountResult {
  sub_account_id: string;
  location_id: string;
}

/**
 * Provisions a new GHL sub-account for a client.
 */
export async function provisionSubAccount(
  supabase: SupabaseClient,
  client: Client,
  clientServiceId: string
): Promise<ServiceTask> {
  const { data: task, error } = await supabase
    .from("service_tasks")
    .insert({
      client_service_id: clientServiceId,
      task_type: "ghl_sub_account_provision",
      status: "pending" as ServiceTaskStatus,
      external_ref: null,
      attempt_count: 0,
      last_result: {
        client_name: client.name,
        business_name: client.business_name,
        email: client.email,
        phone: client.phone,
      },
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create GHL task: ${error.message}`);

  // TODO: Actual GHL API calls:
  // 1. POST /locations to create sub-account
  // 2. Store sub_account_id on client record
  // 3. Deploy snapshot to the new sub-account
  // 4. Configure sub-account with client's business info

  return task as ServiceTask;
}

/**
 * Deploys the standard GHL snapshot to a client's sub-account.
 * Snapshot includes: chatbot, missed call text back, text follow up, review management.
 */
export async function deploySnapshot(
  supabase: SupabaseClient,
  clientServiceId: string,
  subAccountId: string,
  snapshotId: string
): Promise<ServiceTask> {
  const { data: task, error } = await supabase
    .from("service_tasks")
    .insert({
      client_service_id: clientServiceId,
      task_type: "ghl_snapshot_deploy",
      status: "pending" as ServiceTaskStatus,
      external_ref: subAccountId,
      attempt_count: 0,
      last_result: { snapshot_id: snapshotId },
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create snapshot task: ${error.message}`);

  // TODO: Actual GHL API calls:
  // 1. POST snapshot deployment to sub-account
  // 2. Customize snapshot fields with client data (business name, phone, etc.)

  return task as ServiceTask;
}

/**
 * Syncs client data to their GHL contact record.
 * Called after each onboarding response to keep GHL up to date.
 */
export async function syncContactToGHL(
  client: Client,
  fieldKey: string,
  fieldValue: string
): Promise<void> {
  if (!client.ghl_contact_id) return;

  // TODO: Actual GHL API calls:
  // PUT /contacts/{contactId} with custom field update
}
