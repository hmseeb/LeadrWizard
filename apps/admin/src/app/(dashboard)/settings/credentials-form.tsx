"use client";

import { useActionState } from "react";
import {
  saveIntegrationCredentials,
  provisionTwilioNumber,
  type ActionResult,
} from "./actions";
import { Phone, Key, Bot, Mic } from "lucide-react";

interface IntegrationConfig {
  twilio_phone_number: string | null;
  has_twilio_creds: boolean;
  has_ghl_creds: boolean;
  ghl_location_id: string | null;
  ghl_company_id: string | null;
  has_vapi_creds: boolean;
  vapi_assistant_id: string | null;
  elevenlabs_agent_id: string | null;
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
    <div className="rounded-lg border bg-white p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-gray-100 p-2">
            <Icon className="h-5 w-5 text-gray-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">{name}</h3>
            <p className="text-sm text-gray-500">{description}</p>
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            isConfigured
              ? "bg-green-100 text-green-700"
              : "bg-gray-100 text-gray-500"
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
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save"}
      </button>
      {state.success && (
        <span className="text-sm text-green-600">Saved successfully</span>
      )}
      {state.error && (
        <span className="text-sm text-red-600">{state.error}</span>
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
              <label className="block text-sm font-medium text-gray-700">
                Phone Number
              </label>
              <p className="mt-1 rounded-lg border bg-gray-50 px-3 py-2 text-sm text-gray-700">
                {config.twilio_phone_number}
              </p>
            </div>
          )}
          <SaveButton state={twilioState} pending={twilioPending} />
        </form>

        {config.has_twilio_creds && !config.twilio_phone_number && (
          <form action={provisionAction} className="mt-4 border-t pt-4">
            <p className="text-sm text-gray-600">
              No phone number provisioned yet. Purchase a number from your
              Twilio account.
            </p>
            <div className="mt-2 flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700">
                  Area Code (optional)
                </label>
                <input
                  type="text"
                  name="area_code"
                  placeholder="e.g. 415"
                  maxLength={3}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <button
                type="submit"
                disabled={provisionPending}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {provisionPending ? "Provisioning..." : "Provision Number"}
              </button>
            </div>
            {provisionState.success && (
              <p className="mt-2 text-sm text-green-600">
                Phone number provisioned successfully!
              </p>
            )}
            {provisionState.error && (
              <p className="mt-2 text-sm text-red-600">
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
            label="API Key"
            placeholder="Enter GHL API key"
            required
          />
          <CredentialInput
            name="ghl_location_id"
            label="Location ID"
            type="text"
            placeholder="Enter location ID"
            defaultValue={config.ghl_location_id || ""}
            required
          />
          <CredentialInput
            name="ghl_company_id"
            label="Company ID (optional)"
            type="text"
            placeholder="Enter company ID"
            defaultValue={config.ghl_company_id || ""}
          />
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
    </div>
  );
}
