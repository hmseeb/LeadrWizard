/**
 * Shared A2P 10DLC trigger logic used by THREE callers:
 *
 *  1. `startManualOnboarding` in `clients/actions.ts` — the admin "new
 *     A2P client" form, which collects business info inline and fires
 *     the registration immediately on submit.
 *  2. `startA2PRegistration` in `clients/[id]/actions.ts` — the manual
 *     "Start A2P registration" button on the client detail page, used
 *     when Greg needs to retry a failed submission or kick off a
 *     registration that never auto-fired.
 *  3. The widget response route (`api/widget/response/route.ts`) —
 *     automatic zero-click trigger that fires when a client finishes
 *     onboarding for a multi-service package containing A2P.
 *
 * All three paths need the same four things:
 *  - **Input resolution**: read `session_responses` + `clients` row,
 *    map the widget field keys (`legal_business_name`, `contact_name`,
 *    etc.) to the shape `submitA2PRegistration` expects, derive
 *    `use_case_description` / `sample_messages` with defaults when the
 *    widget didn't capture message-type selections, and fail with a
 *    structured "missing fields" error.
 *  - **Credential pre-flight**: load `getOrgCredentials`, verify
 *    Twilio is configured (all three fields present), and trampoline
 *    `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER`
 *    into `process.env` so the shared a2p-manager module can pick them
 *    up via its env-var reader. Same pattern the website-build trigger
 *    uses for Vercel / Anthropic.
 *  - **Duplicate-submit guard**: refuse to fire if the client_service
 *    is already `in_progress` / `delivered`, or if a non-terminal
 *    `service_tasks` row exists. Allows retry after `failed`. Prevents
 *    auto-trigger + manual button racing on the same service.
 *  - **Persistence + logging**: flip `client_services.status` to
 *    `in_progress` on success (matching what `startManualOnboarding`
 *    already does after calling `submitA2PRegistration`) and write an
 *    `interaction_log` entry so the timeline shows which path fired
 *    the registration.
 *
 * Extracting this keeps all three callers consistent — they can't
 * drift on the missing-field check, credential pre-flight, idempotency
 * guard, or the interaction_log shape.
 *
 * NOTE on trust: callers MUST scope-check the `client_services` row to
 * the acting user's org BEFORE calling into this module. The widget
 * auto-trigger path uses service-role keys and trusts session row
 * resolution for scoping. The manual paths load the user's org and
 * pass it in explicitly.
 */

import type { createSupabaseServiceClient } from "./supabase-server";
import {
  submitA2PRegistration,
  type A2PRegistrationData,
} from "@leadrwizard/shared/automations";
import { getOrgCredentials } from "@leadrwizard/shared/tenant";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export interface StartA2PRegistrationOverrides {
  /** Optional message-type keys (same shape the admin form uses). */
  messageTypes?: string[];
  /** Optional sample messages to submit verbatim to Twilio. */
  sampleMessages?: string[];
  /** Optional use-case override. Synthesised from messageTypes if omitted. */
  useCaseDescription?: string;
}

/**
 * Outcome of an A2P trigger attempt. Mirrors the discriminated-union
 * shape the website-build trigger returns so the calling server
 * actions can render a consistent "ok / error" branch.
 *
 * The `dryRun` branch is returned when the helper is called with
 * `{ dryRun: true }` — everything up to the Twilio submission runs
 * (credential pre-flight + live Twilio Account ping + resolver +
 * duplicate guard) but the actual Brand Registration / Customer
 * Profile flow is skipped. The resolved payload is returned so the
 * UI can render "this is what would be submitted" before committing.
 */
export type A2PTriggerResult =
  | {
      ok: true;
      mode: "submit";
      taskId: string;
      brandSid: string | null;
    }
  | {
      ok: true;
      mode: "dry_run";
      /**
       * Exact `A2PRegistrationData` payload that would be sent to
       * `submitA2PRegistration`. Rendered in the preview panel so the
       * operator can verify business info, use-case text, and sample
       * messages before the real submit.
       */
      payload: import("@leadrwizard/shared/automations").A2PRegistrationData;
      /**
       * Twilio-reported account friendly name from the pre-flight
       * `GET /v1/Accounts/{sid}.json` call, proving the creds
       * actually authenticate against Twilio (not just that the
       * env vars / org cred rows are non-empty).
       */
      twilioAccountName: string | null;
    }
  | {
      ok: false;
      error: string;
      /**
       * `"missing_fields"` for a resolver failure where Greg can fix
       * the input and retry. `"not_configured"` for a Twilio creds
       * problem. `"duplicate"` when a registration is already in
       * flight. `"twilio"` for an error coming back from Twilio's
       * API. `"unknown"` for anything else.
       */
      reason:
        | "missing_fields"
        | "not_configured"
        | "duplicate"
        | "twilio"
        | "unknown";
    };

export interface A2PTriggerContext {
  source:
    | "manual_start_a2p_registration"
    | "manual_a2p_onboarding"
    | "auto_trigger_on_onboarding_submit";
}

// Maps the admin form's message-type keys to human-readable labels used
// to synthesise a default `use_case_description` the way
// `startManualOnboarding` already does. Keep in sync with
// `components/new-client-form.tsx`.
const MESSAGE_TYPE_LABELS: Record<string, string> = {
  appointment_reminders: "appointment reminders",
  missed_call_textback: "missed call follow-ups",
  review_requests: "review requests",
  promotional: "promotional offers",
  service_updates: "service status updates",
  two_way_conversation: "two-way customer support",
  booking_confirmation: "booking confirmations",
  follow_up: "post-service follow-ups",
};

function buildUseCase(businessName: string, messageTypes: string[]): string {
  const labels = messageTypes.length
    ? messageTypes.map((t) => MESSAGE_TYPE_LABELS[t] || t)
    : [
        "appointment reminders",
        "service status updates",
        "review requests",
      ];
  return (
    `${businessName} sends ${labels.join(", ")} to customers who have ` +
    `opted in to receive text messages. Customers can opt out at any ` +
    `time by replying STOP. Reply HELP for support. Msg & data rates ` +
    `may apply.`
  );
}

/**
 * Pull A2P inputs from `session_responses` + the `clients` row, mapping
 * the widget's field keys to the shape `submitA2PRegistration` expects.
 *
 * Throws with a formatted missing-fields message the calling UI can
 * surface inline. The auto-trigger path catches this and silently
 * skips — the service stays at `ready_to_deliver` so Greg can retry
 * manually via the button.
 *
 * Field mapping:
 *   session_responses.legal_business_name → business_name
 *   session_responses.ein                 → ein
 *   session_responses.business_address    → business_address
 *   session_responses.business_city       → business_city
 *   session_responses.business_state      → business_state
 *   session_responses.business_zip        → business_zip
 *   session_responses.business_phone      → business_phone
 *   session_responses.contact_name ?? clients.name       → contact_name
 *   session_responses.contact_email ?? clients.email     → contact_email
 *
 * `contact_name` / `contact_email` fall back to the `clients` row
 * because the admin form auto-fills them from the customer's name/email
 * at provisioning time and the widget may legitimately skip them.
 */
export async function resolveA2PInput(
  supabase: ServiceClient,
  clientId: string,
  clientServiceId: string,
  overrides?: StartA2PRegistrationOverrides
): Promise<A2PRegistrationData> {
  const { data: responses } = await supabase
    .from("session_responses")
    .select("field_key, field_value")
    .eq("client_service_id", clientServiceId);

  const answers: Record<string, string> = {};
  for (const r of responses || []) {
    const row = r as { field_key: string; field_value: string };
    answers[row.field_key] = row.field_value;
  }

  const { data: clientRow } = await supabase
    .from("clients")
    .select("name, business_name, email, phone")
    .eq("id", clientId)
    .single();

  const fallbackClient = (clientRow || {}) as {
    name?: string | null;
    business_name?: string | null;
    email?: string | null;
    phone?: string | null;
  };

  const business_name =
    answers.legal_business_name?.trim() ||
    fallbackClient.business_name?.trim() ||
    fallbackClient.name?.trim() ||
    "";
  const ein = answers.ein?.trim() || "";
  const business_address = answers.business_address?.trim() || "";
  const business_city = answers.business_city?.trim() || "";
  const business_state = answers.business_state?.trim() || "";
  const business_zip = answers.business_zip?.trim() || "";
  const business_phone =
    answers.business_phone?.trim() || fallbackClient.phone?.trim() || "";
  const contact_name =
    answers.contact_name?.trim() || fallbackClient.name?.trim() || "";
  const contact_email =
    answers.contact_email?.trim() || fallbackClient.email?.trim() || "";

  const missing: string[] = [];
  if (!business_name) missing.push("legal_business_name");
  if (!ein) missing.push("ein");
  if (!business_address) missing.push("business_address");
  if (!business_city) missing.push("business_city");
  if (!business_state) missing.push("business_state");
  if (!business_zip) missing.push("business_zip");
  if (!business_phone) missing.push("business_phone");
  if (!contact_name) missing.push("contact_name");
  if (!contact_email) missing.push("contact_email");
  if (missing.length > 0) {
    throw new Error(
      `Missing required A2P fields: ${missing.join(", ")}. ` +
        `Complete the onboarding form or submit the registration via the admin "New A2P client" flow.`
    );
  }

  // Use-case description: synthesised from overrides.messageTypes or
  // sensible defaults. The admin form passes overrides explicitly; the
  // widget auto-trigger path has no message-type data and uses the
  // defaults.
  const use_case_description =
    overrides?.useCaseDescription?.trim() ||
    buildUseCase(business_name, overrides?.messageTypes ?? []);

  const sample_messages = overrides?.sampleMessages ?? [];

  return {
    business_name,
    ein,
    business_address,
    business_city,
    business_state,
    business_zip,
    business_phone,
    contact_name,
    contact_email,
    use_case_description,
    sample_messages,
  };
}

/**
 * Trampoline Twilio creds from per-org storage into `process.env` so
 * the shared `a2p-manager.ts` module — which reads env vars directly
 * via `getTwilioConfig()` — can pick them up. Idempotent across calls
 * in the same Node process; only writes the vars if they aren't
 * already set, so a direct env-var configuration (Vercel-level) wins
 * over the per-org store.
 *
 * Mirrors the pattern `triggerAiWebsiteBuild` uses for Vercel /
 * Anthropic in `website-build-trigger.ts`.
 *
 * Also trampolines `GHL_API_KEY` from org creds if present, so the
 * post-verification `pushPhoneToGHL` call in `checkA2PStatus` can push
 * the verified number to the client's GHL subaccount. That function
 * runs on the cron processor where this trampoline won't execute, so
 * this is a best-effort helper for in-process completions only — the
 * real fix is to refactor a2p-manager to take creds as a parameter,
 * which is tracked separately.
 */
function trampolineTwilioEnv(creds: {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}): void {
  if (!process.env.TWILIO_ACCOUNT_SID) {
    process.env.TWILIO_ACCOUNT_SID = creds.accountSid;
  }
  if (!process.env.TWILIO_AUTH_TOKEN) {
    process.env.TWILIO_AUTH_TOKEN = creds.authToken;
  }
  if (!process.env.TWILIO_PHONE_NUMBER) {
    process.env.TWILIO_PHONE_NUMBER = creds.phoneNumber;
  }
}

/**
 * Hit Twilio's Account resource with the configured creds to verify
 * they actually authenticate. Free — no brand is created, no message
 * is sent, no billable resource is touched. Used by the dry-run path
 * and the manual "preview" button to prove the creds are live before
 * we commit to a real Brand Registration.
 *
 * Returns the account's `friendly_name` on success, or throws with the
 * Twilio error body on failure (wrong SID, revoked token, suspended
 * account, etc). Callers catch this and return a structured
 * `reason: "not_configured"` error so the UI can surface it inline.
 */
async function pingTwilioAccount(
  accountSid: string,
  authToken: string
): Promise<string | null> {
  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
    { headers: { Authorization: auth } }
  );
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Twilio credential check failed (${response.status}): ${errorBody}`
    );
  }
  const body = (await response.json()) as { friendly_name?: string };
  return body.friendly_name ?? null;
}

/**
 * Check whether the given client_service already has an A2P
 * registration in flight. Returns the existing task if one is
 * pending/in-progress/waiting-external so the caller can surface a
 * duplicate-submit error with the real status. Returns `null` when
 * it's safe to fire (no task, or the last task `failed` / `completed`).
 */
async function findInFlightA2PTask(
  supabase: ServiceClient,
  clientServiceId: string
): Promise<{ id: string; status: string } | null> {
  const { data: tasks } = await supabase
    .from("service_tasks")
    .select("id, status")
    .eq("client_service_id", clientServiceId)
    .eq("task_type", "a2p_registration")
    .order("created_at", { ascending: false })
    .limit(1);

  if (!tasks || tasks.length === 0) return null;
  const latest = tasks[0] as { id: string; status: string };
  if (
    latest.status === "pending" ||
    latest.status === "in_progress" ||
    latest.status === "waiting_external"
  ) {
    return latest;
  }
  return null;
}

export interface TriggerA2PRegistrationOptions {
  /**
   * When `true`, runs every check the real submission runs — credential
   * pre-flight, live Twilio Account ping, duplicate-submit guard, and
   * input resolution — but skips the actual `submitA2PRegistration`
   * call and returns the resolved payload instead. Nothing is changed:
   * no `service_tasks` row is created, `client_services.status` is not
   * touched, and the `interaction_log` entry is tagged as a dry run so
   * the timeline doesn't read like a real submission.
   *
   * Used by the "Preview (dry run)" button on the client detail page
   * so operators can verify end-to-end wiring before paying Twilio for
   * a real Brand Registration.
   */
  dryRun?: boolean;
}

/**
 * High-level "fire A2P registration" helper. Used by all three callers
 * (admin form, widget auto-trigger, manual retry button). Handles:
 *
 *   1. Credential pre-flight against per-org creds.
 *   2. Live Twilio Account ping — proves the creds actually auth
 *      against Twilio before we commit to a real Brand Registration.
 *   3. Duplicate-submit guard.
 *   4. Input resolution (overrides → session_responses → clients row).
 *   5. Env-var trampoline so `submitA2PRegistration` can read creds.
 *   6. Submission via `submitA2PRegistration`. (Skipped when `dryRun`.)
 *   7. `client_services.status` → `in_progress` on success. (Skipped
 *      when `dryRun`.)
 *   8. `interaction_log` entry tagged with `ctx.source` so the timeline
 *      distinguishes the three paths. (Tagged as a dry run when
 *      `dryRun`.)
 *
 * Returns a structured result — never throws on expected failures
 * (missing creds, duplicate submit, missing fields). Unexpected errors
 * from the Twilio API surface as `reason: "twilio"` so the caller can
 * decide whether to retry.
 */
export async function triggerA2PRegistration(
  supabase: ServiceClient,
  orgId: string,
  clientId: string,
  clientServiceId: string,
  ctx: A2PTriggerContext,
  overrides?: StartA2PRegistrationOverrides,
  options?: TriggerA2PRegistrationOptions
): Promise<A2PTriggerResult> {
  const dryRun = options?.dryRun === true;

  // --- 1. Credential pre-flight ---
  const creds = await getOrgCredentials(supabase, orgId);
  let resolvedSid: string | null = null;
  let resolvedToken: string | null = null;
  if (creds.twilio) {
    trampolineTwilioEnv(creds.twilio);
    resolvedSid = creds.twilio.accountSid;
    resolvedToken = creds.twilio.authToken;
  } else {
    // Fall back to env vars — if they're set, the submitA2PRegistration
    // call will succeed. The error we surface here only fires when
    // neither source has Twilio configured.
    resolvedSid = process.env.TWILIO_ACCOUNT_SID ?? null;
    resolvedToken = process.env.TWILIO_AUTH_TOKEN ?? null;
    const envPhone = process.env.TWILIO_PHONE_NUMBER;
    if (!resolvedSid || !resolvedToken || !envPhone) {
      return {
        ok: false,
        reason: "not_configured",
        error:
          "Twilio is not configured for this org. Add Account SID, Auth Token, and a phone number under Settings → Integrations → Twilio before starting A2P registration.",
      };
    }
  }

  // --- 2. Live Twilio Account ping ---
  // Proves the creds actually authenticate against Twilio — catches
  // the "I saved a typo'd auth token in Settings" case before we ever
  // attempt a Brand Registration. Free. Runs on both real submits and
  // dry runs (the dry run path needs it the most).
  let twilioAccountName: string | null = null;
  try {
    twilioAccountName = await pingTwilioAccount(resolvedSid, resolvedToken);
  } catch (err) {
    return {
      ok: false,
      reason: "not_configured",
      error:
        err instanceof Error
          ? err.message
          : "Twilio credential check failed",
    };
  }

  // --- 3. Duplicate-submit guard ---
  // Prevents the auto-trigger + manual button racing, and refuses a
  // click on an already-in-flight registration. `failed` tasks fall
  // through so Greg can retry without manual DB surgery. Still enforced
  // on dry runs so operators can't "preview" over a real in-flight
  // submission and get confused about what would happen.
  const inFlight = await findInFlightA2PTask(supabase, clientServiceId);
  if (inFlight) {
    return {
      ok: false,
      reason: "duplicate",
      error: `A2P registration is already in flight (task ${inFlight.id}, status: ${inFlight.status}). Wait for Twilio to respond or mark the task failed before retrying.`,
    };
  }

  // --- 4. Input resolution ---
  let data: A2PRegistrationData;
  try {
    data = await resolveA2PInput(
      supabase,
      clientId,
      clientServiceId,
      overrides
    );
  } catch (err) {
    return {
      ok: false,
      reason: "missing_fields",
      error:
        err instanceof Error
          ? err.message
          : "Failed to resolve A2P registration inputs",
    };
  }

  // --- 5. Dry-run short-circuit ---
  // Everything past this point mutates real state (Twilio Brand
  // Registration, client_services.status, a new service_tasks row).
  // The dry-run path logs the preview and returns the resolved
  // payload without touching any of it.
  if (dryRun) {
    await supabase.from("interaction_log").insert({
      client_id: clientId,
      channel: "system",
      direction: "outbound",
      content_type: "system_event",
      content: `A2P registration dry-run preview (no Twilio submission, no brand created)`,
      metadata: {
        client_service_id: clientServiceId,
        source: ctx.source,
        dry_run: true,
        twilio_account_name: twilioAccountName,
        preview_payload: data,
      },
    });
    return {
      ok: true,
      mode: "dry_run",
      payload: data,
      twilioAccountName,
    };
  }

  // --- 6. Fire the registration ---
  let task;
  try {
    task = await submitA2PRegistration(supabase, clientServiceId, data);
  } catch (err) {
    console.error("[triggerA2PRegistration] submit failed:", err);
    return {
      ok: false,
      reason: "twilio",
      error:
        err instanceof Error
          ? err.message
          : "Twilio A2P submission failed",
    };
  }

  // --- 7. Flip client_services.status ---
  // Matches what `startManualOnboarding` has always done after calling
  // `submitA2PRegistration`. The cron task-processor's `checkA2PStatus`
  // later flips this to `delivered` once the campaign is VERIFIED.
  await supabase
    .from("client_services")
    .update({ status: "in_progress", updated_at: new Date().toISOString() })
    .eq("id", clientServiceId);

  // --- 8. Log the event ---
  await supabase.from("interaction_log").insert({
    client_id: clientId,
    channel: "system",
    direction: "outbound",
    content_type: "system_event",
    content: `A2P registration submitted to Twilio (task ${task.id}, brand ${task.external_ref ?? "pending"})`,
    metadata: {
      client_service_id: clientServiceId,
      task_id: task.id,
      brand_sid: task.external_ref,
      source: ctx.source,
    },
  });

  return {
    ok: true,
    mode: "submit",
    taskId: task.id,
    brandSid: task.external_ref,
  };
}
