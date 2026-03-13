import type { Client, ServiceTask, ServiceTaskStatus } from "../types";
import type { SupabaseClient } from "../supabase/client";

/**
 * GoHighLevel API adapter.
 * Handles sub-account provisioning, snapshot deployment, and contact sync.
 * GHL is used as a data sink — NOT the orchestration layer.
 *
 * GHL API docs: https://highlevel.stoplight.io/docs/integrations
 * Base URL: https://services.leadconnectorhq.com
 * Auth: Bearer token (Agency API key for sub-account ops, Location API key for contact ops)
 */

export interface GHLConfig {
  apiKey: string;
  locationId: string;
  companyId?: string;
}

export interface GHLSubAccountResult {
  sub_account_id: string;
  location_id: string;
}

export interface GHLContactResult {
  contact_id: string;
}

export function getGHLConfig(
  orgConfig?: { apiKey: string; locationId: string; companyId?: string }
): GHLConfig {
  if (orgConfig) {
    return {
      apiKey: orgConfig.apiKey,
      locationId: orgConfig.locationId,
      companyId: orgConfig.companyId,
    };
  }
  // Fallback to env vars
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  const companyId = process.env.GHL_COMPANY_ID;

  if (!apiKey || !locationId) {
    throw new Error("Missing GHL config: GHL_API_KEY, GHL_LOCATION_ID");
  }

  return { apiKey, locationId, companyId };
}

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

async function ghlRequest(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    apiKey?: string;
    config?: GHLConfig;
  } = {}
): Promise<Record<string, unknown>> {
  const config = options.config || getGHLConfig();
  const response = await fetch(`${GHL_API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${options.apiKey || config.apiKey}`,
      "Content-Type": "application/json",
      Version: GHL_API_VERSION,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GHL API error (${response.status}): ${errorBody}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

/**
 * Provisions a new GHL sub-account (location) for a client.
 * Creates the location under the agency account, then creates a contact.
 */
export async function provisionSubAccount(
  supabase: SupabaseClient,
  client: Client,
  clientServiceId: string,
  orgConfig?: { apiKey: string; locationId: string; companyId?: string }
): Promise<ServiceTask> {
  // Create task to track
  const { data: task, error } = await supabase
    .from("service_tasks")
    .insert({
      client_service_id: clientServiceId,
      task_type: "ghl_sub_account_provision",
      status: "in_progress" as ServiceTaskStatus,
      external_ref: null,
      attempt_count: 1,
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

  const config = getGHLConfig(orgConfig);

  try {
    // 1. Create sub-account (location) under the agency
    const locationResult = await ghlRequest("/locations/", {
      config,
      method: "POST",
      body: {
        companyId: config.companyId || config.locationId,
        name: client.business_name || client.name,
        email: client.email,
        phone: client.phone,
        address: "",
        city: "",
        state: "",
        postalCode: "",
        country: "US",
        settings: {
          allowDuplicateContact: false,
          allowDuplicateOpportunity: false,
          allowFacebookNameMerge: false,
        },
      },
    });

    const subAccountId = locationResult.id as string;
    const locationId = locationResult.id as string;

    // 2. Update client record with GHL sub-account ID
    await supabase
      .from("clients")
      .update({
        ghl_sub_account_id: subAccountId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", client.id);

    // 3. Create a contact in the new sub-account
    const contactResult = await ghlRequest("/contacts/", {
      config,
      method: "POST",
      body: {
        locationId: subAccountId,
        firstName: client.name.split(" ")[0],
        lastName: client.name.split(" ").slice(1).join(" ") || "",
        email: client.email,
        phone: client.phone,
        companyName: client.business_name || "",
        tags: ["leadrwizard-client", "onboarding"],
      },
    });

    const contactId = (contactResult.contact as Record<string, string>)?.id || contactResult.id as string;

    // 4. Update client with GHL contact ID
    await supabase
      .from("clients")
      .update({
        ghl_contact_id: contactId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", client.id);

    // 5. Mark task completed
    await supabase
      .from("service_tasks")
      .update({
        status: "completed" as ServiceTaskStatus,
        external_ref: subAccountId,
        last_result: {
          sub_account_id: subAccountId,
          location_id: locationId,
          contact_id: contactId,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", (task as ServiceTask).id);

    return { ...(task as ServiceTask), status: "completed", external_ref: subAccountId };
  } catch (err) {
    // Mark task as failed
    await supabase
      .from("service_tasks")
      .update({
        status: "failed" as ServiceTaskStatus,
        last_result: {
          error: err instanceof Error ? err.message : String(err),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", (task as ServiceTask).id);

    throw err;
  }
}

/**
 * Deploys the standard GHL snapshot to a client's sub-account.
 * Snapshot includes: chatbot, missed call text back, text follow up, review management.
 */
export async function deploySnapshot(
  supabase: SupabaseClient,
  clientServiceId: string,
  subAccountId: string,
  snapshotId: string,
  orgConfig?: { apiKey: string; locationId: string; companyId?: string }
): Promise<ServiceTask> {
  const { data: task, error } = await supabase
    .from("service_tasks")
    .insert({
      client_service_id: clientServiceId,
      task_type: "ghl_snapshot_deploy",
      status: "in_progress" as ServiceTaskStatus,
      external_ref: subAccountId,
      attempt_count: 1,
      last_result: { snapshot_id: snapshotId },
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create snapshot task: ${error.message}`);

  const config = getGHLConfig(orgConfig);

  try {
    // Deploy snapshot to the sub-account
    // GHL snapshots are deployed via the Snapshots API
    await ghlRequest(`/snapshots/share/link`, {
      config,
      method: "POST",
      body: {
        snapshot_id: snapshotId,
        location_id: subAccountId,
        type: "permanent",
      },
    });

    // Mark task completed
    await supabase
      .from("service_tasks")
      .update({
        status: "completed" as ServiceTaskStatus,
        last_result: {
          snapshot_id: snapshotId,
          deployed_to: subAccountId,
          deployed_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", (task as ServiceTask).id);

    return { ...(task as ServiceTask), status: "completed" };
  } catch (err) {
    await supabase
      .from("service_tasks")
      .update({
        status: "failed" as ServiceTaskStatus,
        last_result: {
          error: err instanceof Error ? err.message : String(err),
          snapshot_id: snapshotId,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", (task as ServiceTask).id);

    throw err;
  }
}

/**
 * Syncs client data to their GHL contact record.
 * Called after each onboarding response to keep GHL up to date.
 */
export async function syncContactToGHL(
  client: Client,
  fieldKey: string,
  fieldValue: string,
  orgConfig?: { apiKey: string; locationId: string; companyId?: string }
): Promise<void> {
  if (!client.ghl_contact_id) return;

  // Map onboarding field keys to GHL contact fields
  const fieldMapping: Record<string, string> = {
    business_name: "companyName",
    business_phone: "phone",
    business_email: "email",
    business_address: "address1",
    business_city: "city",
    business_state: "state",
    business_zip: "postalCode",
    website: "website",
    tagline: "customField.tagline",
    niche: "customField.niche",
    ein: "customField.ein",
    google_account_email: "customField.google_account_email",
  };

  const ghlField = fieldMapping[fieldKey];

  const config = getGHLConfig(orgConfig);

  if (ghlField) {
    if (ghlField.startsWith("customField.")) {
      // Update custom field
      const customFieldKey = ghlField.replace("customField.", "");
      await ghlRequest(`/contacts/${client.ghl_contact_id}`, {
        config,
        method: "PUT",
        body: {
          customFields: [{ key: customFieldKey, value: fieldValue }],
        },
      });
    } else {
      // Update standard field
      await ghlRequest(`/contacts/${client.ghl_contact_id}`, {
        config,
        method: "PUT",
        body: { [ghlField]: fieldValue },
      });
    }
  }
}

/**
 * Customizes a deployed GHL snapshot with client-specific data.
 * Updates the chatbot name, phone numbers, business info, etc.
 */
export async function customizeSnapshot(
  supabase: SupabaseClient,
  client: Client,
  responses: Array<{ field_key: string; field_value: string }>,
  orgConfig?: { apiKey: string; locationId: string; companyId?: string }
): Promise<void> {
  if (!client.ghl_sub_account_id || !client.ghl_contact_id) return;

  // Bulk sync all collected responses to the GHL contact
  const customFields: Array<{ key: string; value: string }> = [];
  const standardFields: Record<string, string> = {};

  for (const response of responses) {
    const fieldMapping: Record<string, string> = {
      business_name: "companyName",
      business_phone: "phone",
      business_address: "address1",
      business_city: "city",
      business_state: "state",
      business_zip: "postalCode",
    };

    const ghlField = fieldMapping[response.field_key];
    if (ghlField) {
      standardFields[ghlField] = response.field_value;
    } else {
      customFields.push({
        key: response.field_key,
        value: response.field_value,
      });
    }
  }

  const config = getGHLConfig(orgConfig);

  // Update contact with all collected data
  await ghlRequest(`/contacts/${client.ghl_contact_id}`, {
    config,
    method: "PUT",
    body: {
      ...standardFields,
      ...(customFields.length > 0 ? { customFields } : {}),
    },
  });
}
