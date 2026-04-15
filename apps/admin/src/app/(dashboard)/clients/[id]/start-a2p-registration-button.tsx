"use client";

import { useTransition, useState } from "react";
import { MessageSquare, AlertCircle, CheckCircle2 } from "lucide-react";
import { startA2PRegistration } from "./actions";

interface StartA2PRegistrationButtonProps {
  clientId: string;
  clientServiceId: string;
  /**
   * Current `client_services.status`. Used to label the button
   * appropriately:
   *   - `pending_onboarding` / `ready_to_deliver` → "Start A2P registration"
   *   - `in_progress` → button is hidden; upstream renders a status note
   *
   * Note the button is rendered at all statuses except `delivered`, since
   * a previous submission that returned `failed` leaves the row at
   * `in_progress` but with a `service_tasks.status = 'failed'` that the
   * server-side duplicate-submit guard will allow a retry past.
   */
  currentStatus: string;
}

/**
 * Manual "Start A2P registration" button for the client detail page.
 *
 * Fires `startA2PRegistration`, which in turn delegates to the shared
 * `triggerA2PRegistration` helper. The helper handles:
 *   - credential pre-flight (Twilio configured in Settings → Integrations)
 *   - duplicate-submit guard (refuses if a task is already in flight)
 *   - resolving inputs from `session_responses` + the `clients` row
 *   - flipping `client_services.status` → `in_progress`
 *
 * Unlike the website-build button there's no polling here — the A2P
 * registration is async on Twilio's side (brand approval 1-7 days,
 * campaign 1-3 days) and the cron task-processor handles status
 * progression. This component just fires the initial submission and
 * reports back whether it was accepted.
 */
export function StartA2PRegistrationButton({
  clientId,
  clientServiceId,
  currentStatus,
}: StartA2PRegistrationButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    taskId: string;
    brandSid: string | null;
  } | null>(null);

  function doStart() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const result = await startA2PRegistration(clientId, clientServiceId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSuccess({ taskId: result.taskId, brandSid: result.brandSid });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to start A2P registration"
        );
      }
    });
  }

  const label = isPending
    ? "Submitting…"
    : currentStatus === "in_progress"
      ? "Retry A2P registration"
      : "Start A2P registration";

  return (
    <div className="flex w-full flex-col items-stretch gap-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={doStart}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md border border-sky-700/50 bg-sky-900/20 px-2 py-1 text-xs font-medium text-sky-300 hover:border-sky-500/50 hover:bg-sky-900/40 disabled:opacity-50"
        >
          <MessageSquare className="h-3 w-3" />
          {label}
        </button>
      </div>

      {success && (
        <p className="flex items-start justify-end gap-1 text-[10px] text-emerald-400">
          <CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0" />
          <span>
            Submitted to Twilio — brand {success.brandSid ?? "pending"}.
            Carrier approval typically takes 1-7 days.
          </span>
        </p>
      )}
      {error && (
        <p className="flex items-start gap-1 text-[10px] text-rose-400">
          <AlertCircle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
