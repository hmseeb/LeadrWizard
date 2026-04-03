"use client";

import { useActionState } from "react";
import {
  saveIntegrationCredentials,
  provisionTwilioNumber,
  type ActionResult,
} from "./actions";
import { Phone, Key, Bot, Mic, Globe, Brain } from "lucide-react";

interface IntegrationConfig {
  twilio_phone_number: string | null;
  has_twilio_creds: boolean;
  has_ghl_creds: boolean;
  ghl_location_id: string | null;
  ghl_company_id: string | null;
  has_vapi_creds: boolean;
  vapi_assistant_id: string | null;
  elevenlabs_agent_id: string | null;
  has_google_creds: boolean;
  has_anthropic_creds: boolean;
}

const initialState: ActionResult = { success: false };

function IntegrationCard({
  name,
  description,
  icon: Icon,
  isConfigured,
  children,
}: {
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  isConfigured: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border bg-surface p-6 ${isConfigured ? "border-emerald-500/20" : "border-zinc-800"}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-2">
            <Icon className="h-5 w-5 text-zinc-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-zinc-50">{name}</h3>
            <p className="text-sm text-zinc-400">{description}</p>
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            isConfigured
              ? "border border-emerald-500/20 bg-emerald-600/10 text-emerald-400"
              : "border border-zinc-700 bg-zinc-800 text-zinc-500"
          }`}
        >
          {isConfigured ? "Configured" : "Not configured"}
        </span>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function CredentialInput({
  name,
  label,
  type = "password",
  placeholder,
  defaultValue,
  required,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-300 mb-1.5">{label}</label>
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
      />
    </div>
  );
}

function SaveButton({
  state,
  pending,
}: {
  state: ActionResult;
  pending: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50 transition-all shadow-sm"
      >
        {pending ? "Saving..." : "Save"}
      </button>
      {state.success && (
        <span className="text-sm text-emerald-400">Saved successfully</span>
      )}
      {state.error && (
        <span className="text-sm text-rose-400">{state.error}</span>
      )}
    </div>
  );
}

export function CredentialsForm({ config }: { config: IntegrationConfig }) {
  const [twilioState, twilioAction, twilioPending] = useActionState(
    saveIntegrationCredentials,
    initialState
  );
  const [ghlState, ghlAction, ghlPending] = useActionState(
    saveIntegrationCredentials,
    initialState
  );
  const [vapiState, vapiAction, vapiPending] = useActionState(
    saveIntegrationCredentials,
    initialState
  );
  const [elevenState, elevenAction, elevenPending] = useActionState(
    saveIntegrationCredentials,
    initialState
  );
  const [googleState, googleAction, googlePending] = useActionState(
    saveIntegrationCredentials,
    initialState
  );
  const [anthropicState, anthropicAction, anthropicPending] = useActionState(
    saveIntegrationCredentials,
    initialState
  );
  const [provisionState, provisionAction, provisionPending] = useActionState(
    provisionTwilioNumber,
    initialState
  );

  return (
    <div className="space-y-6">
      {/* Twilio */}
      <IntegrationCard
        name="Twilio"
        description="SMS messaging, voice calls, and A2P registration"
        icon={Phone}
        isConfigured={config.has_twilio_creds}
      >
        <form action={twilioAction} className="space-y-3">
          <input type="hidden" name="integration" value="twilio" />
          <CredentialInput
            name="twilio_account_sid"
            label="Account SID"
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            required
          />
          <CredentialInput
            name="twilio_auth_token"
            label="Auth Token"
            placeholder="Enter auth token"
            required
          />
          {config.twilio_phone_number && (
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Phone Number
              </label>
              <p className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-200">
                {config.twilio_phone_number}
              </p>
            </div>
          )}
          <SaveButton state={twilioState} pending={twilioPending} />
        </form>

        {config.has_twilio_creds && !config.twilio_phone_number && (
          <form action={provisionAction} className="mt-4 border-t border-zinc-800 pt-4">
            <p className="text-sm text-zinc-400">
              No phone number provisioned yet. Purchase a number from your
              Twilio account.
            </p>
            <div className="mt-2 flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  Area Code (optional)
                </label>
                <input
                  type="text"
                  name="area_code"
                  placeholder="e.g. 415"
                  maxLength={3}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={provisionPending}
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-all shadow-sm"
              >
                {provisionPending ? "Provisioning..." : "Provision Number"}
              </button>
            </div>
            {provisionState.success && (
              <p className="mt-2 text-sm text-emerald-400">
                Phone number provisioned successfully!
              </p>
            )}
            {provisionState.error && (
              <p className="mt-2 text-sm text-rose-400">
                {provisionState.error}
              </p>
            )}
          </form>
        )}
      </IntegrationCard>

      {/* GoHighLevel */}
      <IntegrationCard
        name="GoHighLevel"
        description="CRM, email, sub-account provisioning, snapshot deployment"
        icon={Key}
        isConfigured={config.has_ghl_creds}
      >
        <form action={ghlAction} className="space-y-3">
          <input type="hidden" name="integration" value="ghl" />
          <CredentialInput
            name="ghl_api_key"
            label="Agency API Key"
            placeholder="Enter GHL Agency API key"
            required
          />
          <p className="text-xs text-zinc-500 -mt-1">
            Found in Agency Settings → API Keys. Required for managing subaccounts and pushing phone numbers.
          </p>
          <CredentialInput
            name="ghl_location_id"
            label="Default Location ID"
            type="text"
            placeholder="Enter default location ID"
            defaultValue={config.ghl_location_id || ""}
          />
          <CredentialInput
            name="ghl_company_id"
            label="Company ID"
            type="text"
            placeholder="Enter agency company ID"
            defaultValue={config.ghl_company_id || ""}
            required
          />
          <p className="text-xs text-zinc-500 -mt-1">
            Found in Agency Settings → Company. Required for listing subaccounts.
          </p>
          <SaveButton state={ghlState} pending={ghlPending} />
        </form>
      </IntegrationCard>

      {/* Vapi */}
      <IntegrationCard
        name="Vapi"
        description="Outbound AI voice calls"
        icon={Bot}
        isConfigured={config.has_vapi_creds}
      >
        <form action={vapiAction} className="space-y-3">
          <input type="hidden" name="integration" value="vapi" />
          <CredentialInput
            name="vapi_api_key"
            label="API Key"
            placeholder="Enter Vapi API key"
            required
          />
          <CredentialInput
            name="vapi_assistant_id"
            label="Assistant ID"
            type="text"
            placeholder="Enter assistant ID"
            defaultValue={config.vapi_assistant_id || ""}
            required
          />
          <SaveButton state={vapiState} pending={vapiPending} />
        </form>
      </IntegrationCard>

      {/* ElevenLabs */}
      <IntegrationCard
        name="ElevenLabs"
        description="In-browser voice onboarding widget"
        icon={Mic}
        isConfigured={!!config.elevenlabs_agent_id}
      >
        <form action={elevenAction} className="space-y-3">
          <input type="hidden" name="integration" value="elevenlabs" />
          <CredentialInput
            name="elevenlabs_agent_id"
            label="Agent ID"
            type="text"
            placeholder="Enter ElevenLabs agent ID"
            defaultValue={config.elevenlabs_agent_id || ""}
            required
          />
          <SaveButton state={elevenState} pending={elevenPending} />
        </form>
      </IntegrationCard>

      {/* Google Business Profile */}
      <IntegrationCard
        name="Google Business Profile"
        description="GMB access requests and management"
        icon={Globe}
        isConfigured={config.has_google_creds}
      >
        <form action={googleAction} className="space-y-3">
          <input type="hidden" name="integration" value="google" />
          <CredentialInput
            name="google_client_id"
            label="Client ID"
            placeholder="Enter Google OAuth client ID"
            required
          />
          <CredentialInput
            name="google_client_secret"
            label="Client Secret"
            placeholder="Enter Google OAuth client secret"
            required
          />
          <CredentialInput
            name="google_refresh_token"
            label="Refresh Token"
            placeholder="Enter Google OAuth refresh token"
            required
          />
          <SaveButton state={googleState} pending={googlePending} />
        </form>
      </IntegrationCard>

      {/* Anthropic (AI) */}
      <IntegrationCard
        name="Anthropic (Claude AI)"
        description="AI-powered website generation and content"
        icon={Brain}
        isConfigured={config.has_anthropic_creds}
      >
        <form action={anthropicAction} className="space-y-3">
          <input type="hidden" name="integration" value="anthropic" />
          <CredentialInput
            name="anthropic_api_key"
            label="API Key"
            placeholder="Enter Anthropic API key"
            required
          />
          <SaveButton state={anthropicState} pending={anthropicPending} />
        </form>
      </IntegrationCard>
    </div>
  );
}
