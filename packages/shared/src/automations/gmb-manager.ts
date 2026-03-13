import type { ServiceTask, ServiceTaskStatus } from "../types";
import type { SupabaseClient } from "../supabase/client";

/**
 * Google Business Profile (GMB) optimization manager.
 *
 * Flow:
 * 1. Use client's Google account email to find/verify their business listing
 * 2. Request management access to the listing
 * 3. Client receives Google email → must approve access
 * 4. Bot follows up if not approved within 24h (via SMS/voice)
 * 5. Once access is granted, optimize the listing (hours, categories, description, photos)
 *
 * Google Business Profile API: https://developers.google.com/my-business/reference/rest
 * Auth: OAuth2 with service account or user consent
 */

export interface GMBAccessData {
  google_account_email: string;
  business_name: string;
  business_address: string;
  business_phone: string;
  business_category: string;
  business_hours: Record<string, { open: string; close: string } | null>;
}

export interface GMBOptimizationData {
  description?: string;
  website_url?: string;
  additional_categories?: string[];
  attributes?: Record<string, string>;
  photos?: string[];
}

interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
}

function getGoogleConfig(): GoogleAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret) {
    throw new Error("Missing Google config: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET");
  }

  return { clientId, clientSecret, refreshToken };
}

/**
 * Get an access token using the refresh token.
 */
async function getAccessToken(): Promise<string> {
  const config = getGoogleConfig();

  if (!config.refreshToken) {
    throw new Error("Google refresh token not configured. Complete OAuth flow first.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Google OAuth token refresh failed: ${response.status}`);
  }

  const result = (await response.json()) as { access_token: string };
  return result.access_token;
}

/**
 * Make an authenticated request to the Google Business Profile API.
 */
async function gmbRequest(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
  } = {}
): Promise<Record<string, unknown>> {
  const accessToken = await getAccessToken();

  const response = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1${path}`,
    {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Business Profile API error (${response.status}): ${errorBody}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

/**
 * Search for a business listing by name and address.
 */
async function searchBusinessListing(
  businessName: string,
  address: string
): Promise<{ locationName: string; placeId: string } | null> {
  const accessToken = await getAccessToken();

  // Use the Google My Business Account Management API to list accounts
  const accountsResponse = await fetch(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!accountsResponse.ok) return null;

  const accounts = (await accountsResponse.json()) as {
    accounts?: Array<{ name: string }>;
  };

  if (!accounts.accounts?.length) return null;

  // Search for the location under each account
  for (const account of accounts.accounts) {
    const locationsResponse = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?filter=title%3D%22${encodeURIComponent(businessName)}%22&readMask=name,title,storefrontAddress`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!locationsResponse.ok) continue;

    const locations = (await locationsResponse.json()) as {
      locations?: Array<{
        name: string;
        title: string;
        metadata?: { placeId?: string };
      }>;
    };

    if (locations.locations?.length) {
      const location = locations.locations[0];
      return {
        locationName: location.name,
        placeId: location.metadata?.placeId || "",
      };
    }
  }

  return null;
}

/**
 * Requests management access to a client's Google Business Profile listing.
 * The client will receive a Google email to approve the access request.
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
      status: "in_progress" as ServiceTaskStatus,
      external_ref: null,
      next_check_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      attempt_count: 1,
      last_result: { submitted_data: data, step: "search_listing" },
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create GMB task: ${error.message}`);

  const taskId = (task as ServiceTask).id;

  try {
    // Step 1: Search for the business listing
    const listing = await searchBusinessListing(
      data.business_name,
      data.business_address
    );

    if (!listing) {
      // No listing found — may need to create one or client needs to verify their listing exists
      await supabase
        .from("service_tasks")
        .update({
          status: "waiting_external" as ServiceTaskStatus,
          next_check_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          last_result: {
            submitted_data: data,
            step: "listing_not_found",
            message: "Business listing not found. Client may need to create/claim their listing on Google first.",
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId);

      return {
        ...(task as ServiceTask),
        status: "waiting_external",
      };
    }

    // Step 2: Request admin access via the Account Management API
    const accessToken = await getAccessToken();
    const accessResponse = await fetch(
      `https://mybusinessaccountmanagement.googleapis.com/v1/${listing.locationName}/admins`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          admin: data.google_account_email,
          role: "MANAGER",
        }),
      }
    );

    if (!accessResponse.ok) {
      const errorBody = await accessResponse.text();

      // If we can't directly add ourselves, try requesting access
      // through the access request flow
      const requestResponse = await fetch(
        `https://mybusinessaccountmanagement.googleapis.com/v1/${listing.locationName}:requestAccess`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            role: "MANAGER",
          }),
        }
      );

      if (!requestResponse.ok) {
        throw new Error(
          `Failed to request GMB access: ${errorBody}`
        );
      }
    }

    // Update task — waiting for client to approve
    await supabase
      .from("service_tasks")
      .update({
        status: "waiting_external" as ServiceTaskStatus,
        external_ref: listing.locationName,
        next_check_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        last_result: {
          submitted_data: data,
          step: "access_requested",
          location_name: listing.locationName,
          place_id: listing.placeId,
          message: "Access request sent. Waiting for client to approve via Google email.",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    return {
      ...(task as ServiceTask),
      status: "waiting_external",
      external_ref: listing.locationName,
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
 * Checks if the client has approved the GMB access request.
 * If approved, begins optimization. If not approved after several checks,
 * flags for client follow-up via SMS/voice.
 */
export async function checkGMBAccessStatus(
  supabase: SupabaseClient,
  task: ServiceTask
): Promise<{ status: ServiceTaskStatus; needs_client_followup: boolean }> {
  const lastResult = task.last_result as Record<string, unknown> | null;
  if (!lastResult) return { status: task.status, needs_client_followup: false };

  const step = lastResult.step as string;
  const locationName = task.external_ref;

  const hoursWaiting =
    (Date.now() - new Date(task.created_at).getTime()) / (1000 * 60 * 60);

  // If listing wasn't found, check again periodically
  if (step === "listing_not_found") {
    return {
      status: task.status,
      needs_client_followup: hoursWaiting > 24,
    };
  }

  // If waiting for access approval
  if (step === "access_requested" && locationName) {
    try {
      // Try to read the location — if we can, access was granted
      const accessToken = await getAccessToken();
      const response = await fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}?readMask=name,title`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (response.ok) {
        // Access granted — start optimization
        const data = lastResult.submitted_data as GMBAccessData;

        await optimizeGMBListing(supabase, task, locationName, data);

        return { status: "completed", needs_client_followup: false };
      }
    } catch {
      // Access not yet granted — continue waiting
    }

    // Schedule next check
    await supabase
      .from("service_tasks")
      .update({
        next_check_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        attempt_count: task.attempt_count + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);

    // Need follow-up if waiting > 24h
    return {
      status: "waiting_external",
      needs_client_followup: hoursWaiting > 24 && task.attempt_count % 6 === 0, // Every ~24h
    };
  }

  return {
    status: task.status,
    needs_client_followup: hoursWaiting > 24 && task.status === "waiting_external",
  };
}

/**
 * Optimizes a GMB listing once we have management access.
 * Updates hours, categories, description, and other business info.
 */
async function optimizeGMBListing(
  supabase: SupabaseClient,
  task: ServiceTask,
  locationName: string,
  data: GMBAccessData
): Promise<void> {
  try {
    // Build the update payload
    const updateFields: Record<string, unknown> = {};

    // Set business hours
    if (data.business_hours && Object.keys(data.business_hours).length > 0) {
      const dayMap: Record<string, string> = {
        monday: "MONDAY",
        tuesday: "TUESDAY",
        wednesday: "WEDNESDAY",
        thursday: "THURSDAY",
        friday: "FRIDAY",
        saturday: "SATURDAY",
        sunday: "SUNDAY",
      };

      const periods: Array<Record<string, unknown>> = [];
      for (const [day, hours] of Object.entries(data.business_hours)) {
        if (hours) {
          periods.push({
            openDay: dayMap[day.toLowerCase()] || day.toUpperCase(),
            openTime: { hours: parseInt(hours.open.split(":")[0]), minutes: parseInt(hours.open.split(":")[1] || "0") },
            closeDay: dayMap[day.toLowerCase()] || day.toUpperCase(),
            closeTime: { hours: parseInt(hours.close.split(":")[0]), minutes: parseInt(hours.close.split(":")[1] || "0") },
          });
        }
      }

      if (periods.length > 0) {
        updateFields.regularHours = { periods };
      }
    }

    // Set primary category
    if (data.business_category) {
      updateFields.categories = {
        primaryCategory: {
          displayName: data.business_category,
        },
      };
    }

    // Set phone
    if (data.business_phone) {
      updateFields.phoneNumbers = {
        primaryPhone: data.business_phone,
      };
    }

    // Apply updates
    if (Object.keys(updateFields).length > 0) {
      const updateMask = Object.keys(updateFields).join(",");
      await gmbRequest(`/${locationName}?updateMask=${updateMask}`, {
        method: "PATCH",
        body: updateFields,
      });
    }

    // Mark task and service as completed
    await supabase
      .from("service_tasks")
      .update({
        status: "completed" as ServiceTaskStatus,
        last_result: {
          step: "optimized",
          location_name: locationName,
          optimizations_applied: Object.keys(updateFields),
          completed_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);

    await supabase
      .from("client_services")
      .update({
        status: "delivered",
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.client_service_id);
  } catch (err) {
    await supabase
      .from("service_tasks")
      .update({
        status: "failed" as ServiceTaskStatus,
        last_result: {
          step: "optimization_failed",
          error: err instanceof Error ? err.message : String(err),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);

    throw err;
  }
}
