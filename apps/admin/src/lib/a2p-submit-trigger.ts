/**
 * Shared A2P submission trigger logic used by BOTH:
 *
 *  1. `submitA2PFromOnboarding` server action on the client detail page
 *     (manual, Greg-clicked path — fired from `StartA2PSubmissionButton`).
 *  2. The widget response route's auto-trigger, which fires when a client
 *     finishes onboarding for an `a2p-registration` service without any
 *     manual intervention (automatic, zero-click path).
 *
 * Both paths need the same three things:
 *  - **Input resolution**: read `session_responses` + `clients` row +
 *    optional manual overrides, merge with the documented precedence,
 *    and fail fast if any required field is still missing.
 *  - **In-flight check**: if a `service_tasks` row already exists for
 *    this client_service in a non-terminal state, refuse to double-submit.
 *  - **Persistence + logging**: call `submitA2PRegistration` (which writes
 *    the `service_tasks` row and hits Twilio Trust Hub), flip the
 *    `client_services.status`, and write an `interaction_log` entry so
 *    the timeline shows that the submission happened and via which path.
 *
 * Mirrors the layout of `website-build-trigger.ts` so the two trigger
 * paths look identical in the codebase.
 */

import type { createSupabaseServiceClient } from "./supabase-server";
import type { ServiceTask } from "@leadrwizard/shared/types";
import {
  submitA2PRegistration,
  type A2PRegistrationData,
} from "@leadrwizard/shared/automations";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export interface StartA2PSubmissionOverrides {
  legal_business_name?: string;
  ein?: string;
  business_address?: string;
  business_city?: string;
  business_state?: string;
  business_zip?: string;
  business_phone?: string;
  contact_name?: string;
  contact_email?: string;
  use_case_description?: string;
  sample_messages?: string[];
}

export interface ResolvedA2PInput extends A2PRegistrationData {}

const A2P_FIELD_KEYS = [
  "legal_business_name",
  "ein",
  "business_address",
  "business_city",
  "business_state",
  "business_zip",
  "business_phone",
  "contact_name",
  "contact_email",
] as const;

/**
 * Resolve the A2P submission inputs for a given client_service from
 * session_responses + clients row + optional overrides, then fail fast
 * if required fields are missing. Mirrors `resolveWebsiteBuildInput`.
 *
 * Persists override values back to session_responses so subsequent
 * submission attempts (after a Twilio rejection, say) don't lose Greg's
 * manual corrections.
 */
export async function resolveA2PInput(
  supabase: ServiceClient,
  clientId: string,
  clientServiceId: string,
  overrides?: StartA2PSubmissionOverrides
): Promise<ResolvedA2PInput> {
  // 1. Pull onboarding answers scoped to this client_service
  const { data: responses } = await supabase
    .from("session_responses")
    .select("field_key, field_value")
    .eq("client_service_id", clientServiceId);

  const answers: Record<string, string> = {};
  for (const r of responses || []) {
    const row = r as { field_key: string; field_value: string };
    answers[row.field_key] = row.field_value;
  }

  // 2. Pull the client row for fallback contact details. business_name,
  // email, and phone live here from provisioning time so the submission
  // should never block on lack of contact info even if the widget missed
  // some fields.
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

  // 3. Resolve via overrides → session_responses → clients row.
  const legal_business_name =
    overrides?.legal_business_name?.trim() ||
    answers.legal_business_name?.trim() ||
    fallbackClient.business_name?.trim() ||
    "";
  const ein = overrides?.ein?.trim() || answers.ein?.trim() || "";
  const business_address =
    overrides?.business_address?.trim() ||
    answers.business_address?.trim() ||
    "";
  const business_city =
    overrides?.business_city?.trim() || answers.business_city?.trim() || "";
  const business_state =
    overrides?.business_state?.trim() || answers.business_state?.trim() || "";
  const business_zip =
    overrides?.business_zip?.trim() || answers.business_zip?.trim() || "";
  const business_phone =
    overrides?.business_phone?.trim() ||
    answers.business_phone?.trim() ||
    fallbackClient.phone?.trim() ||
    "";
  const contact_name =
    overrides?.contact_name?.trim() ||
    answers.contact_name?.trim() ||
    fallbackClient.name?.trim() ||
    "";
  const contact_email =
    overrides?.contact_email?.trim() ||
    answers.contact_email?.trim() ||
    fallbackClient.email?.trim() ||
    "";

  const missing: string[] = [];
  if (!legal_business_name) missing.push("legal_business_name");
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
      `Missing required fields for A2P registration: ${missing.join(", ")}. ` +
        `Fields not captured during onboarding can be entered manually below.`
    );
  }

  // 4. Persist overrides back to session_responses so a later retry finds
  // them in the normal place (mirrors the website-build trigger). Only
  // writes the A2P field keys that are explicitly tracked in seed.sql.
  const overrideEntries: Array<{ field_key: string; field_value: string }> = [];
  const writeIfOverridden = (
    fieldKey: string,
    overrideValue: string | undefined
  ) => {
    const trimmed = overrideValue?.trim();
    if (!trimmed) return;
    if (answers[fieldKey]?.trim() === trimmed) return;
    overrideEntries.push({ field_key: fieldKey, field_value: trimmed });
  };
  for (const key of A2P_FIELD_KEYS) {
    writeIfOverridden(
      key,
      (overrides as Record<string, string | undefined> | undefined)?.[key]
    );
  }

  if (overrideEntries.length > 0) {
    const { data: latestSession } = await supabase
      .from("onboarding_sessions")
      .select("id")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sessionId = (latestSession as { id: string } | null)?.id;
    if (sessionId) {
      await supabase
        .from("session_responses")
        .delete()
        .eq("session_id", sessionId)
        .eq("client_service_id", clientServiceId)
        .in(
          "field_key",
          overrideEntries.map((e) => e.field_key)
        );
      await supabase.from("session_responses").insert(
        overrideEntries.map((e) => ({
          session_id: sessionId,
          client_service_id: clientServiceId,
          field_key: e.field_key,
          field_value: e.field_value,
          answered_via: "click" as const,
        }))
      );
    }
  }

  // 5. Build the use case description if not provided. The Twilio
  // submission needs *something* in this field; default to a generic
  // transactional description that matches what the manual A2P form
  // generates. Greg can refine this from the button UI's overrides.
  const use_case_description =
    overrides?.use_case_description?.trim() ||
    `${legal_business_name} sends transactional notifications, appointment reminders, and customer service follow-ups to customers who have opted in to receive text messages. Customers can opt out at any time by replying STOP. Reply HELP for support. Msg & data rates may apply.`;

  const sample_messages =
    overrides?.sample_messages && overrides.sample_messages.length > 0
      ? overrides.sample_messages
      : [];

  return {
    business_name: legal_business_name,
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

export type A2PTriggerSource =
  | "manual_start_a2p_submission"
  | "auto_trigger_on_onboarding_submit";

export type A2PTriggerResult =
  | { ok: true; taskId: string; brandSid: string | null }
  | { ok: false; error: string };

/**
 * Fire the A2P registration submission for a given client_service.
 * Assumes the caller has already scope-checked `client_services` to the
 * acting org — this helper deliberately does not re-check.
 *
 * Refuses to double-submit if a non-terminal `service_tasks` row already
 * exists for this client_service. The button UI keys off this so a
 * second click while a brand is awaiting carrier approval does not
 * create a duplicate Twilio submission.
 */
export async function triggerA2PSubmission(
  supabase: ServiceClient,
  clientId: string,
  clientServiceId: string,
  source: A2PTriggerSource,
  overrides?: StartA2PSubmissionOverrides
): Promise<A2PTriggerResult> {
  try {
    // 1. Refuse if there's already a live submission. Terminal statuses
    // (completed, failed) are treated as "free to retry" so Greg can fix
    // a rejected brand and resubmit without manual cleanup.
    const { data: existingTask } = await supabase
      .from("service_tasks")
      .select("id, status, external_ref")
      .eq("client_service_id", clientServiceId)
      .eq("task_type", "a2p_registration")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const existing = existingTask as
      | { id: string; status: string; external_ref: string | null }
      | null;
    if (
      existing &&
      existing.status !== "failed" &&
      existing.status !== "completed"
    ) {
      return {
        ok: false,
        error: `A2P registration is already in flight (status: ${existing.status}, brand SID: ${existing.external_ref ?? "pending"}). Wait for the carrier to respond before resubmitting.`,
      };
    }

    // 2. Resolve inputs
    const resolved = await resolveA2PInput(
      supabase,
      clientId,
      clientServiceId,
      overrides
    );

    // 3. Submit to Twilio. submitA2PRegistration creates the service_tasks
    // row, calls the Trust Hub + Brand APIs, and updates the row with the
    // resulting brandSid + step. Throws on Twilio errors after marking
    // the task as failed.
    const task: ServiceTask = await submitA2PRegistration(
      supabase,
      clientServiceId,
      resolved
    );

    // 4. Flip the client_services row to in_progress so the badge stops
    // saying "ready_to_deliver" — the carrier now owns the next step.
    await supabase
      .from("client_services")
      .update({
        status: "in_progress",
        updated_at: new Date().toISOString(),
      })
      .eq("id", clientServiceId);

    // 5. Log to interaction_log so the timeline shows the submission.
    await supabase.from("interaction_log").insert({
      client_id: clientId,
      channel: "system",
      direction: "outbound",
      content_type: "system_event",
      content: `A2P registration submitted to Twilio (brand SID: ${task.external_ref ?? "pending"})`,
      metadata: {
        client_service_id: clientServiceId,
        task_id: task.id,
        brand_sid: task.external_ref,
        source,
      },
    });

    return {
      ok: true,
      taskId: task.id,
      brandSid: task.external_ref ?? null,
    };
  } catch (err) {
    console.error("[triggerA2PSubmission] failed:", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Unknown error submitting A2P registration",
    };
  }
}
