"use client";

import { useTransition, useState } from "react";
import {
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  Eye,
} from "lucide-react";
import { startA2PRegistration, dryRunA2PRegistration } from "./actions";

interface StartA2PRegistrationButtonProps {
  clientId: string;
  clientServiceId: string;
  /**
   * Current `client_services.status`. Used to label the button
   * appropriately:
   *   - `pending_onboarding` / `ready_to_deliver` → "Start A2P registration"
   *   - `in_progress` → "Retry A2P registration" (a prior failed submission)
   */
  currentStatus: string;
}

type DryRunPayload = {
  business_name: string;
  ein: string;
  business_address: string;
  business_city: string;
  business_state: string;
  business_zip: string;
  business_phone: string;
  contact_name: string;
  contact_email: string;
  use_case_description: string;
  sample_messages: string[];
};

/**
 * Manual "Start A2P registration" button for the client detail page,
 * with a sibling "Preview (dry run)" button for test-before-live
 * verification.
 *
 * The preview button runs the full pipeline — credential pre-flight,
 * live Twilio Account ping, duplicate-submit guard, input resolver —
 * and surfaces the exact `A2PRegistrationData` payload that would be
 * submitted. Nothing is mutated on Twilio's side. Free. Use this to
 * validate end-to-end wiring without paying for a real Brand
 * Registration or waiting days for carrier approval.
 *
 * Once the preview looks correct, click "Submit to Twilio" to fire
 * the real submission.
 *
 * Unlike the website-build button there's no polling here — A2P is
 * async on Twilio's side (brand approval 1-7 days, campaign 1-3 days)
 * and the cron task-processor handles status progression.
 */
export function StartA2PRegistrationButton({
  clientId,
  clientServiceId,
  currentStatus,
}: StartA2PRegistrationButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"idle" | "preview" | "submit">("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    twilioAccountName: string | null;
    payload: DryRunPayload;
  } | null>(null);
  const [success, setSuccess] = useState<{
    taskId: string;
    brandSid: string | null;
  } | null>(null);

  function doDryRun() {
    setError(null);
    setSuccess(null);
    setMode("preview");
    startTransition(async () => {
      try {
        const result = await dryRunA2PRegistration(clientId, clientServiceId);
        if (!result.ok) {
          setError(result.error);
          setPreview(null);
          return;
        }
        setPreview({
          twilioAccountName: result.twilioAccountName,
          payload: result.payload,
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to run A2P dry run"
        );
      }
    });
  }

  function doSubmit() {
    setError(null);
    setSuccess(null);
    setMode("submit");
    startTransition(async () => {
      try {
        const result = await startA2PRegistration(clientId, clientServiceId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSuccess({ taskId: result.taskId, brandSid: result.brandSid });
        // Clear the preview once a real submission has been made —
        // the preview panel is stale once the task is real.
        setPreview(null);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to start A2P registration"
        );
      }
    });
  }

  const submitLabel =
    isPending && mode === "submit"
      ? "Submitting…"
      : currentStatus === "in_progress"
        ? "Retry & submit to Twilio"
        : "Submit to Twilio";

  const previewLabel =
    isPending && mode === "preview" ? "Checking…" : "Preview (dry run)";

  return (
    <div className="flex w-full flex-col items-stretch gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={doDryRun}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800 disabled:opacity-50"
          title="Validates Twilio creds and resolves the A2P payload without submitting anything to Twilio."
        >
          <Eye className="h-3 w-3" />
          {previewLabel}
        </button>
        <button
          type="button"
          onClick={doSubmit}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md border border-sky-700/50 bg-sky-900/20 px-2 py-1 text-xs font-medium text-sky-300 hover:border-sky-500/50 hover:bg-sky-900/40 disabled:opacity-50"
        >
          <MessageSquare className="h-3 w-3" />
          {submitLabel}
        </button>
      </div>

      {preview && !success && (
        <div className="space-y-2 rounded-md border border-zinc-700 bg-zinc-900/60 p-3">
          <p className="flex items-start gap-1 text-[10px] text-emerald-400">
            <CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0" />
            <span>
              Twilio creds verified
              {preview.twilioAccountName
                ? ` — account: ${preview.twilioAccountName}`
                : ""}
              . Nothing has been submitted yet.
            </span>
          </p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-[10px] text-zinc-300">
            <dt className="text-zinc-500">Business</dt>
            <dd className="font-mono">{preview.payload.business_name}</dd>
            <dt className="text-zinc-500">EIN</dt>
            <dd className="font-mono">{preview.payload.ein}</dd>
            <dt className="text-zinc-500">Address</dt>
            <dd className="font-mono">
              {preview.payload.business_address},{" "}
              {preview.payload.business_city},{" "}
              {preview.payload.business_state}{" "}
              {preview.payload.business_zip}
            </dd>
            <dt className="text-zinc-500">Business phone</dt>
            <dd className="font-mono">{preview.payload.business_phone}</dd>
            <dt className="text-zinc-500">Contact</dt>
            <dd className="font-mono">
              {preview.payload.contact_name} &lt;
              {preview.payload.contact_email}&gt;
            </dd>
            <dt className="text-zinc-500">Use case</dt>
            <dd className="font-mono whitespace-pre-wrap">
              {preview.payload.use_case_description}
            </dd>
            <dt className="text-zinc-500">Samples</dt>
            <dd className="font-mono">
              {preview.payload.sample_messages.length > 0
                ? `${preview.payload.sample_messages.length} provided`
                : "default 2 samples (auto-generated)"}
            </dd>
          </dl>
          <p className="text-[10px] text-zinc-500">
            If this looks correct, click <span className="text-zinc-300">Submit to Twilio</span> to fire the real Brand Registration.
          </p>
        </div>
      )}

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
