"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getUserOrg, updateOrgSettings } from "@leadrwizard/shared/tenant";
import { encrypt } from "@leadrwizard/shared/crypto";
import { revalidatePath } from "next/cache";

async function getAuthedOrg() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const orgData = await getUserOrg(supabase, user.id);
  if (!orgData || !["owner", "admin"].includes(orgData.role)) {
    return { error: "Insufficient permissions" };
  }

  return { supabase, orgId: orgData.org.id };
}

export type ActionResult = {
  success: boolean;
  error?: string;
};

/**
 * Save integration credentials (Twilio, GHL, Vapi, ElevenLabs).
 * Encrypts secret values before storage. Non-secret config stored as plain text.
 */
export async function saveIntegrationCredentials(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const auth = await getAuthedOrg();
  if ("error" in auth && auth.error) return { success: false, error: auth.error };
  const { supabase, orgId } = auth as { supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; orgId: string };

  const integration = formData.get("integration") as string;

  try {
    const updates: Record<string, string | null> = {};

    switch (integration) {
      case "twilio": {
        const accountSid = (formData.get("twilio_account_sid") as string)?.trim();
        const authToken = (formData.get("twilio_auth_token") as string)?.trim();
        if (!accountSid || !authToken) {
          return { success: false, error: "Account SID and Auth Token are required" };
        }
        updates.twilio_account_sid_encrypted = encrypt(accountSid);
        updates.twilio_auth_token_encrypted = encrypt(authToken);
        break;
      }

      case "ghl": {
        const apiKey = (formData.get("ghl_api_key") as string)?.trim();
        const locationId = (formData.get("ghl_location_id") as string)?.trim();
        const companyId = (formData.get("ghl_company_id") as string)?.trim();
        if (!apiKey || !locationId) {
          return { success: false, error: "API Key and Location ID are required" };
        }
        updates.ghl_api_key_encrypted = encrypt(apiKey);
        updates.ghl_location_id = locationId;
        updates.ghl_company_id = companyId || null;
        break;
      }

      case "vapi": {
        const apiKey = (formData.get("vapi_api_key") as string)?.trim();
        const assistantId = (formData.get("vapi_assistant_id") as string)?.trim();
        if (!apiKey || !assistantId) {
          return { success: false, error: "API Key and Assistant ID are required" };
        }
        updates.vapi_api_key_encrypted = encrypt(apiKey);
        updates.vapi_assistant_id = assistantId;
        break;
      }

      case "elevenlabs": {
        const agentId = (formData.get("elevenlabs_agent_id") as string)?.trim();
        if (!agentId) {
          return { success: false, error: "Agent ID is required" };
        }
        updates.elevenlabs_agent_id = agentId;
        break;
      }

      default:
        return { success: false, error: "Unknown integration type" };
    }

    updates.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from("organizations")
      .update(updates)
      .eq("id", orgId);

    if (error) return { success: false, error: error.message };

    revalidatePath("/settings");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save credentials",
    };
  }
}

/**
 * Save escalation channel configuration.
 * Stored in the JSONB settings column (not encrypted, not a secret).
 */
export async function saveEscalationConfig(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const auth = await getAuthedOrg();
  if ("error" in auth && auth.error) return { success: false, error: auth.error };
  const { supabase, orgId } = auth as { supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; orgId: string };

  try {
    const channel = (formData.get("escalation_channel") as string)?.trim() || null;
    const webhookUrl = (formData.get("escalation_webhook_url") as string)?.trim() || null;

    if (channel && !webhookUrl) {
      return { success: false, error: "Webhook URL is required when a channel is selected" };
    }

    await updateOrgSettings(supabase, orgId, {
      escalation_channel: channel,
      escalation_webhook_url: webhookUrl,
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save escalation config",
    };
  }
}

/**
 * Provision a Twilio phone number for the org.
 * Uses the org's own Twilio credentials (must be saved first).
 */
export async function provisionTwilioNumber(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const auth = await getAuthedOrg();
  if ("error" in auth && auth.error) return { success: false, error: auth.error };
  const { supabase, orgId } = auth as { supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; orgId: string };

  try {
    // Dynamic import to avoid pulling automations into admin bundle unnecessarily
    const { getOrgCredentials } = await import("@leadrwizard/shared/tenant");
    const { provisionPhoneNumber } = await import("@leadrwizard/shared/automations");

    const creds = await getOrgCredentials(supabase, orgId);
    if (!creds.twilio) {
      return {
        success: false,
        error: "Save Twilio credentials first before provisioning a number",
      };
    }

    const areaCode = (formData.get("area_code") as string)?.trim() || undefined;

    const result = await provisionPhoneNumber(
      {
        accountSid: creds.twilio.accountSid,
        authToken: creds.twilio.authToken,
      },
      { areaCode }
    );

    // Store the provisioned number on the org
    const { error } = await supabase
      .from("organizations")
      .update({
        twilio_phone_number: result.phoneNumber,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orgId);

    if (error) return { success: false, error: error.message };

    revalidatePath("/settings");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to provision number",
    };
  }
}
