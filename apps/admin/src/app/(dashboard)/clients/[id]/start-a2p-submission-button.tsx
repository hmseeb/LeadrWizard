"use client";

import { useState, useTransition } from "react";
import {
  Send,
  AlertCircle,
  CheckCircle2,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { submitA2PFromOnboarding } from "./actions";

interface ExistingA2PTask {
  id: string;
  status: string;
  external_ref: string | null;
  last_result: Record<string, unknown> | null;
  updated_at: string;
}

interface StartA2PSubmissionButtonProps {
  clientId: string;
  clientServiceId: string;
  /**
   * The most-recent `service_tasks` row of `task_type = 'a2p_registration'`
   * for this client_service, if any. Passed in by the server component so
   * the button can render the current submission state on first paint
   * without a client-side round trip. `null` means no submission has ever
   * been attempted.
   */
  existingTask: ExistingA2PTask | null;
}

const A2P_FIELD_LABELS: Record<string, string> = {
  legal_business_name: "Legal business name",
  ein: "EIN (Tax ID)",
  business_address: "Business address",
  business_city: "City",
  business_state: "State",
  business_zip: "ZIP code",
  business_phone: "Business phone",
  contact_name: "Primary contact name",
  contact_email: "Primary contact email",
};

/**
 * Manual "Submit A2P to Twilio" button on the A2P card of the client
 * detail page. Mirrors `StartWebsiteBuildButton` in shape:
 *
 * - First click hits `submitA2PFromOnboarding`. The server action pulls
 *   the 9 required A2P fields from `session_responses`, falls back to
 *   the `clients` row for contact info, and pushes the registration to
 *   Twilio Trust Hub.
 * - If any required fields are missing, the action throws a structured
 *   error message containing the missing field keys. We catch it and
 *   expand an inline form below the button so Greg can fill in the
 *   gaps without re-routing through the manual /clients/new A2P form.
 *   The same overrides also get persisted back to session_responses so
 *   subsequent retries don't re-prompt.
 * - When a submission is in flight (status `in_progress` /
 *   `waiting_external`), the button shows the brand SID, current step,
 *   and disables itself so a second click can't double-submit.
 * - On `failed`, the button re-enables as "Resubmit to Twilio" so Greg
 *   can fix the rejection reason and try again.
 *
 * The component is intentionally read-only outside of the submit click
 * — it does not poll for status updates. Status polling is owned by the
 * cron-driven `task-processor.ts`, which calls `checkA2PStatus` and
 * advances the task through brand → campaign → completed.
 */
export function StartA2PSubmissionButton({
  clientId,
  clientServiceId,
  existingTask,
}: StartA2PSubmissionButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // Render the existing submission state if one is on file. We treat
  // `failed` and `completed` as "ready to take a new action" — failed
  // re-enables the resubmit button, completed locks it.
  const isInFlight =
    existingTask &&
    existingTask.status !== "failed" &&
    existingTask.status !== "completed";
  const isComplete = existingTask?.status === "completed";

  function setOverride(key: string, value: string) {
    setOverrides((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await submitA2PFromOnboarding(
          clientId,
          clientServiceId,
          showForm
            ? Object.fromEntries(
                Object.entries(overrides).map(([k, v]) => [k, v.trim()])
              )
            : undefined
        );

        if (!result.ok) {
          setError(result.error);
          // Parse the missing-field error to expand the inline form.
          // The shared trigger throws with the format:
          //   "Missing required fields for A2P registration: a, b, c. ..."
          const match = result.error.match(
            /Missing required fields for A2P registration: ([^.]+)\./
          );
          if (match) {
            const keys = match[1]
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            setMissingKeys(keys);
            setShowForm(true);
          }
          return;
        }

        // Success — clear local form state. The server action calls
        // revalidatePath, which re-renders the page with the new
        // `existingTask` prop, so the button will flip to its
        // "in flight" state on the next paint.
        setShowForm(false);
        setMissingKeys([]);
        setOverrides({});
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to submit A2P");
      }
    });
  }

  // Pull a human-readable step label out of the task's last_result so
  // Greg can see exactly where Twilio is in the multi-step flow.
  const lastResult = existingTask?.last_result as
    | Record<string, unknown>
    | null
    | undefined;
  const step = (lastResult?.step as string | undefined) || existingTask?.status;
  const brandStatus = lastResult?.brand_status as string | undefined;
  const campaignStatus = lastResult?.campaign_status as string | undefined;
  const failureReason = lastResult?.failure_reason as string | undefined;

  const formCanSubmit =
    !showForm ||
    missingKeys.every((key) => (overrides[key] ?? "").trim().length > 0);

  const buttonLabel = (() => {
    if (isPending) return "Submitting…";
    if (isComplete) return "Verified";
    if (isInFlight) return "Awaiting Twilio";
    if (existingTask?.status === "failed") return "Resubmit to Twilio";
    if (showForm) return "Submit A2P with these values";
    return "Submit A2P to Twilio";
  })();

  return (
    <div className="flex w-full flex-col items-stretch gap-2">
      {/* Existing submission status card */}
      {existingTask && (
        <div className="space-y-1 rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-[11px] text-zinc-300">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-medium uppercase tracking-wider text-zinc-400">
              {isComplete ? (
                <ShieldCheck className="h-3 w-3 text-emerald-400" />
              ) : isInFlight ? (
                <Clock className="h-3 w-3 text-amber-400" />
              ) : (
                <AlertCircle className="h-3 w-3 text-rose-400" />
              )}
              Twilio submission
            </span>
            <span className="text-zinc-500">
              {new Date(existingTask.updated_at).toLocaleString()}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-zinc-400">
            <span>
              Status:{" "}
              <span className="text-zinc-200">{existingTask.status}</span>
            </span>
            {step && step !== existingTask.status && (
              <span>
                Step: <span className="text-zinc-200">{step}</span>
              </span>
            )}
            {existingTask.external_ref && (
              <span>
                Brand SID:{" "}
                <span className="font-mono text-zinc-200">
                  {existingTask.external_ref}
                </span>
              </span>
            )}
            {brandStatus && (
              <span>
                Brand: <span className="text-zinc-200">{brandStatus}</span>
              </span>
            )}
            {campaignStatus && (
              <span>
                Campaign:{" "}
                <span className="text-zinc-200">{campaignStatus}</span>
              </span>
            )}
          </div>
          {failureReason && (
            <p className="text-rose-400">Reason: {failureReason}</p>
          )}
        </div>
      )}

      {/* Inline manual-entry form for missing required fields */}
      {showForm && missingKeys.length > 0 && (
        <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="text-[10px] text-zinc-400">
            These fields weren&apos;t captured during onboarding. Fill them in
            to submit the A2P registration.
          </p>
          {missingKeys.map((key) => (
            <div key={key}>
              <label className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                {A2P_FIELD_LABELS[key] || key}
              </label>
              <input
                type="text"
                value={overrides[key] ?? ""}
                onChange={(e) => setOverride(key, e.target.value)}
                disabled={isPending}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || !!isInFlight || isComplete || !formCanSubmit}
          className="inline-flex items-center gap-1 rounded-md border border-sky-700/50 bg-sky-900/20 px-2 py-1 text-xs font-medium text-sky-300 hover:border-sky-500/50 hover:bg-sky-900/40 disabled:opacity-50"
        >
          {isComplete ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : isInFlight ? (
            <Clock className="h-3 w-3" />
          ) : (
            <Send className="h-3 w-3" />
          )}
          {buttonLabel}
        </button>
      </div>

      {error && (
        <p className="flex items-start gap-1 text-[10px] text-rose-400">
          <AlertCircle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
