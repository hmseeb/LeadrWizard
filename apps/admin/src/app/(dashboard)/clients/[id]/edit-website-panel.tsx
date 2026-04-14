"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
} from "lucide-react";
import { editClientWebsite, getGoosekitBuildStatus } from "./actions";
import {
  GOOSEKIT_STATUS_LABELS,
  GOOSEKIT_TERMINAL_STATUSES,
  type GoosekitJobStatus,
} from "@leadrwizard/shared/automations";

interface EditWebsitePanelProps {
  clientId: string;
  clientServiceId: string;
  /**
   * URL of the last successful Goose Kit build. We display a "View current
   * site" link next to the editor so Greg can see what he's editing
   * without leaving the page.
   */
  liveUrl: string | null;
  /**
   * Whether a Goose Kit job is already in flight on this client_service
   * when the page loads (e.g. build or prior edit still running). When
   * true we disable the form and poll for its completion before letting
   * Greg submit a new edit.
   */
  initialGoosekitJobId: string | null;
  initialGoosekitStatus: GoosekitJobStatus | null;
  initialGoosekitError: string | null;
}

const GOOSEKIT_POLL_MS = 3_000;

function isTerminalStatus(s: GoosekitJobStatus | null): boolean {
  return !!s && GOOSEKIT_TERMINAL_STATUSES.includes(s);
}

/**
 * Edit panel for a Goose Kit-built website. Takes a free-text instruction
 * ("make the hero headline bolder, swap the color palette to navy") and
 * fires `editClientWebsite`, which calls Goose Kit's `/edit` endpoint.
 * Goose Kit returns a fresh job_id that lives on the same polling
 * infrastructure as a regular `/build` — we reuse `getGoosekitBuildStatus`
 * to tick every 3s until the edit job reaches a terminal state.
 *
 * Only rendered when the client_service has a successful Goose Kit live
 * URL on file — we don't offer this as a replacement for the AI-builder's
 * own adjustment flow, it's specifically for Goose Kit sites since that's
 * the only builder whose edit path is currently wired up.
 */
export function EditWebsitePanel({
  clientId,
  clientServiceId,
  liveUrl,
  initialGoosekitJobId,
  initialGoosekitStatus,
  initialGoosekitError,
}: EditWebsitePanelProps) {
  const [isPending, startTransition] = useTransition();
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);

  // Reuse the same polling shape as StartWebsiteBuildButton — an edit job
  // looks identical to a build job from the status-poll side, so the
  // same logic works.
  const [jobId, setJobId] = useState<string | null>(initialGoosekitJobId);
  const [status, setStatus] = useState<GoosekitJobStatus | null>(
    initialGoosekitStatus
  );
  const [currentLiveUrl, setCurrentLiveUrl] = useState<string | null>(liveUrl);
  const [jobError, setJobError] = useState<string | null>(initialGoosekitError);

  const jobActive = !!jobId && !isTerminalStatus(status);

  const pollingRef = useRef(false);
  useEffect(() => {
    if (!jobId) return;
    if (isTerminalStatus(status)) return;

    let cancelled = false;
    pollingRef.current = true;

    const tick = async () => {
      if (cancelled) return;
      const result = await getGoosekitBuildStatus(clientId, clientServiceId);
      if (cancelled) return;
      if (!result.ok) {
        console.warn("[goosekit-edit] poll error:", result.error);
        return;
      }
      if (result.status) setStatus(result.status);
      if (result.liveUrl) setCurrentLiveUrl(result.liveUrl);
      if (result.error) setJobError(result.error);
      if (result.isTerminal) {
        pollingRef.current = false;
        // On successful completion, clear the textarea so the next edit
        // starts fresh. We keep `justSubmitted` true so the success
        // message renders once the edit has landed.
        if (result.status === "READY") {
          setInstructions("");
        }
      }
    };

    tick();
    const interval = setInterval(tick, GOOSEKIT_POLL_MS);
    return () => {
      cancelled = true;
      pollingRef.current = false;
      clearInterval(interval);
    };
  }, [jobId, status, clientId, clientServiceId]);

  function handleSubmit() {
    const trimmed = instructions.trim();
    if (!trimmed) {
      setError("Describe what you want changed before submitting.");
      return;
    }
    setError(null);
    setJustSubmitted(false);

    startTransition(async () => {
      try {
        const result = await editClientWebsite(
          clientId,
          clientServiceId,
          trimmed
        );
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setJobId(result.jobId);
        setStatus(result.status);
        setJobError(null);
        setJustSubmitted(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to submit edit");
      }
    });
  }

  const disabled = isPending || jobActive;
  const buttonLabel = (() => {
    if (isPending) return "Submitting…";
    if (jobActive) {
      const label = status ? GOOSEKIT_STATUS_LABELS[status] : "Running";
      return `Goose Kit: ${label}…`;
    }
    return "Submit edit to Goose Kit";
  })();

  return (
    <div className="rounded-xl border border-zinc-800 bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Pencil className="h-4 w-4 text-purple-300" />
          <h3 className="text-sm font-medium text-zinc-100">
            Edit this website
          </h3>
        </div>
        {currentLiveUrl && (
          <a
            href={currentLiveUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-[10px] text-purple-300 hover:text-purple-200"
          >
            View current site
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Describe the change in plain English. Goose Kit will update the
        live site with the requested edit and push a new deploy.
      </p>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="e.g. Change the hero headline to 'Best plumber in town', make the primary color navy blue, add a testimonials section."
        disabled={disabled}
        rows={4}
        className="mt-3 block w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-purple-500/60 focus:outline-none focus:ring-1 focus:ring-purple-500/30 disabled:opacity-50"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex-1 text-[10px] text-zinc-500">
          {jobActive && (
            <span className="flex items-center gap-1 text-purple-300">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {status ? GOOSEKIT_STATUS_LABELS[status] : "Running"}…
            </span>
          )}
          {!jobActive && justSubmitted && status === "READY" && (
            <span className="flex items-center gap-1 text-emerald-300">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Edit deployed
            </span>
          )}
          {!jobActive && status === "FAILED" && jobError && (
            <span className="flex items-start gap-1 text-rose-400">
              <AlertCircle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
              <span>Goose Kit: {jobError}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || instructions.trim().length === 0}
          className="inline-flex items-center gap-1 rounded-md border border-purple-700/50 bg-purple-900/20 px-3 py-1.5 text-xs font-medium text-purple-300 hover:border-purple-500/50 hover:bg-purple-900/40 disabled:opacity-50"
        >
          {jobActive ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Pencil className="h-3 w-3" />
          )}
          {buttonLabel}
        </button>
      </div>
      {error && (
        <p className="mt-2 flex items-start gap-1 text-[10px] text-rose-400">
          <AlertCircle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
