import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";
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

  const serviceClient = createSupabaseServiceClient();
  const orgData = user ? await getUserOrg(serviceClient, user.id) : null;
  if (!orgData) redirect("/login");

  // Fetch org with credential columns (only non-secret fields + existence checks)
  const { data: org } = await serviceClient
    .from("organizations")
    .select(
      "twilio_phone_number, twilio_account_sid_encrypted, ghl_api_key_encrypted, ghl_location_id, ghl_company_id, ghl_snapshot_id, vapi_api_key_encrypted, vapi_assistant_id, elevenlabs_agent_id, google_client_id_encrypted, anthropic_api_key_encrypted, vercel_token_encrypted, vercel_team_id, goosekit_github_pat_encrypted, goosekit_vercel_token_encrypted, goosekit_claude_token_encrypted, goosekit_base_url, linked2checkout_api_key_encrypted, linked2checkout_webhook_secret_encrypted, linked2checkout_merchant_id, linked2checkout_product_id_ignite, default_website_builder, settings"
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
    ghl_snapshot_id: (row.ghl_snapshot_id as string) || null,
    has_vapi_creds: !!(row.vapi_api_key_encrypted),
    vapi_assistant_id: (row.vapi_assistant_id as string) || null,
    elevenlabs_agent_id: (row.elevenlabs_agent_id as string) || null,
    has_google_creds: !!(row.google_client_id_encrypted),
    has_anthropic_creds: !!(row.anthropic_api_key_encrypted),
    has_vercel_creds: !!(row.vercel_token_encrypted),
    vercel_team_id: (row.vercel_team_id as string) || null,
    has_goosekit_creds:
      !!(row.goosekit_github_pat_encrypted) &&
      !!(row.goosekit_vercel_token_encrypted) &&
      !!(row.goosekit_claude_token_encrypted),
    goosekit_base_url: (row.goosekit_base_url as string) || null,
    has_linked2checkout_creds:
      !!(row.linked2checkout_api_key_encrypted) &&
      !!(row.linked2checkout_webhook_secret_encrypted),
    linked2checkout_merchant_id:
      (row.linked2checkout_merchant_id as string) || null,
    linked2checkout_product_id_ignite:
      (row.linked2checkout_product_id_ignite as string) || null,
    // Per-org default website builder. 'ai' is the server-side default
    // from migration 00014 so a missing column here means the migration
    // hasn't run yet — fall back safely.
    default_website_builder:
      (row.default_website_builder as "ai" | "goosekit") || "ai",
  };

  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">Settings</h1>
      <p className="mt-1 text-zinc-400">
        Configure integrations and automation behavior
      </p>

      <div className="mt-6 space-y-8">
        <section>
          <h2 className="mb-4 text-lg font-semibold text-zinc-200">
            Integration Credentials
          </h2>
          <CredentialsForm config={integrationConfig} />
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-zinc-200">
            Automation & Escalation
          </h2>
          <CadenceForm settings={settings} />
        </section>
      </div>
    </div>
  );
}
