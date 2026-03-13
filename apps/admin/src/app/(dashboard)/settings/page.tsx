import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { redirect } from "next/navigation";
import { CredentialsForm } from "./credentials-form";
import { CadenceForm } from "./cadence-form";
import type { OrgSettings } from "@leadrwizard/shared/types";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const orgData = await getUserOrg(supabase, user.id);
  if (!orgData) redirect("/login");

  // Fetch org with credential columns (only non-secret fields + existence checks)
  const { data: org } = await supabase
    .from("organizations")
    .select(
      "twilio_phone_number, twilio_account_sid_encrypted, ghl_api_key_encrypted, ghl_location_id, ghl_company_id, vapi_api_key_encrypted, vapi_assistant_id, elevenlabs_agent_id, settings"
    )
    .eq("id", orgData.org.id)
    .single();

  const row = (org || {}) as Record<string, unknown>;
  const settings = (row.settings || {
    outreach_cadence: { steps: [] },
    escalation_webhook_url: null,
    escalation_channel: null,
  }) as OrgSettings;

  // Build config for the form -- never send encrypted values to the client
  const integrationConfig = {
    twilio_phone_number: (row.twilio_phone_number as string) || null,
    has_twilio_creds: !!(row.twilio_account_sid_encrypted),
    has_ghl_creds: !!(row.ghl_api_key_encrypted),
    ghl_location_id: (row.ghl_location_id as string) || null,
    ghl_company_id: (row.ghl_company_id as string) || null,
    has_vapi_creds: !!(row.vapi_api_key_encrypted),
    vapi_assistant_id: (row.vapi_assistant_id as string) || null,
    elevenlabs_agent_id: (row.elevenlabs_agent_id as string) || null,
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-gray-500">
        Configure integrations and automation behavior
      </p>

      <div className="mt-6 space-y-8">
        <section>
          <h2 className="mb-4 text-lg font-semibold text-gray-800">
            Integration Credentials
          </h2>
          <CredentialsForm config={integrationConfig} />
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-gray-800">
            Automation & Escalation
          </h2>
          <CadenceForm settings={settings} />
        </section>
      </div>
    </div>
  );
}
