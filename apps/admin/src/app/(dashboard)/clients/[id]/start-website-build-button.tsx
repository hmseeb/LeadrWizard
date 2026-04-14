"use client";

import { useTransition, useState, useEffect, useRef } from "react";
import {
  Globe,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import {
  startWebsiteBuild,
  startGoosekitBuild,
  getGoosekitBuildStatus,
} from "./actions";
import {
  GOOSEKIT_STATUS_LABELS,
  GOOSEKIT_TERMINAL_STATUSES,
  type GoosekitJobStatus,
} from "@leadrwizard/shared/automations";

interface StartWebsiteBuildButtonProps {
  clientId: string;
  clientServiceId: string;
  /**
   * Goose Kit job state persisted on `client_services`. Passed in from the
   * server component so a page refresh picks up the in-flight build and
   * auto-resumes polling — no extra round trip on mount.
   */
  initialGoosekitJobId?: string | null;
  initialGoosekitStatus?: GoosekitJobStatus | null;
  initialGoosekitLiveUrl?: string | null;
  initialGoosekitError?: string | null;
}

type Builder = "ai" | "goosekit";

const GOOSEKIT_POLL_MS = 3_000;

function isTerminalStatus(s: GoosekitJobStatus | null): boolean {
  return !!s && GOOSEKIT_TERMINAL_STATUSES.includes(s);
}

/**
 * Kicks off a website build for a `website-build` client_service.
 *
 * Two builders are supported side-by-side — Greg picks per-client:
 * - **Start AI build** — the in-repo Claude+Vercel flow (`startWebsiteBuild`).
 *   Synchronous: one server action call, then either a preview URL or a
 *   "no template" notice comes back.
 * - **Start Goose Kit build** — the external Goose Kit orchestrator
 *   (`startGoosekitBuild`). **Asynchronous**: the server action fires off
 *   the job and returns a job_id immediately. This component then polls
 *   `getGoosekitBuildStatus` every 3s (matching Goose Kit's own dashboard
 *   cadence) until the job reaches a terminal state (READY or FAILED).
 *
 * The Goose Kit job_id is persisted on `client_services`, so if you
 * navigate away and come back mid-build, this component is handed back
 * the current state via its props and resumes polling automatically.
 *
 * When the onboarding widget didn't capture the service-specific fields
 * the server needs (niche, services_offered), the first click fails with
 * a "Missing required fields" error. We then expand an inline manual-
 * entry form so Greg can type them in and retry without having to
 * re-send the onboarding link to the client. `phone`/`email`/
 * `business_name` are already on the `clients` row and never need manual
 * entry. The same form works for both builders — both server actions
 * use the same resolver and throw identical missing-field errors.
 */
export function StartWebsiteBuildButton({
  clientId,
  clientServiceId,
  initialGoosekitJobId = null,
  initialGoosekitStatus = null,
  initialGoosekitLiveUrl = null,
  initialGoosekitError = null,
}: StartWebsiteBuildButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [needsTemplate, setNeedsTemplate] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [niche, setNiche] = useState("");
  const [servicesOffered, setServicesOffered] = useState("");
  const [lastBuilder, setLastBuilder] = useState<Builder | null>(null);

  // Goose Kit-specific state. Seeded from props so a page refresh picks up
  // the in-flight job and shows its current progress without needing a
  // separate initial poll. Once we have a non-terminal job_id in state,
  // the polling effect below takes over.
  const [goosekitJobId, setGoosekitJobId] = useState<string | null>(
    initialGoosekitJobId
  );
  const [goosekitStatus, setGoosekitStatus] = useState<GoosekitJobStatus | null>(
    initialGoosekitStatus
  );
  const [goosekitLiveUrl, setGoosekitLiveUrl] = useState<string | null>(
    initialGoosekitLiveUrl
  );
  const [goosekitError, setGoosekitError] = useState<string | null>(
    initialGoosekitError
  );

  // Poll `getGoosekitBuildStatus` every 3s as long as:
  //   1. There's a job_id on file
  //   2. The status is not terminal (READY / FAILED)
  // On terminal states the effect cleans up its own interval. Uses a
  // cancelled flag so a response arriving after unmount can't setState.
  const pollingRef = useRef(false);
  useEffect(() => {
    if (!goosekitJobId) return;
    if (isTerminalStatus(goosekitStatus)) return;

    let cancelled = false;
    pollingRef.current = true;

    const tick = async () => {
      if (cancelled) return;
      const result = await getGoosekitBuildStatus(clientId, clientServiceId);
      if (cancelled) return;
      if (!result.ok) {
        // Transient poll error — log it and keep polling on the next tick.
        // Goose Kit may be briefly unreachable; treating a single 500 as
        // "give up" would be too fragile.
        console.warn("[goosekit] poll error:", result.error);
        return;
      }
      if (result.status) setGoosekitStatus(result.status);
      if (result.liveUrl) setGoosekitLiveUrl(result.liveUrl);
      if (result.error) setGoosekitError(result.error);
      if (result.isTerminal) {
        pollingRef.current = false;
      }
    };

    // Fire one poll immediately so the UI updates as soon as the effect
    // mounts (instead of waiting 3s for the first interval tick).
    tick();
    const interval = setInterval(tick, GOOSEKIT_POLL_MS);

    return () => {
      cancelled = true;
      pollingRef.current = false;
      clearInterval(interval);
    };
  }, [goosekitJobId, goosekitStatus, clientId, clientServiceId]);

  function doStart(
    builder: Builder,
    overrides?: { niche?: string; servicesOffered?: string }
  ) {
    setError(null);
    setPreviewUrl(null);
    setNeedsTemplate(false);
    setLastBuilder(builder);

    // Clear Goose Kit-specific state when starting a new Goose Kit build;
    // leave it alone when firing the AI builder so an earlier successful
    // Goose Kit result doesn't disappear from the UI.
    if (builder === "goosekit") {
      setGoosekitJobId(null);
      setGoosekitStatus(null);
      setGoosekitLiveUrl(null);
      setGoosekitError(null);
    }

    startTransition(async () => {
      try {
        if (builder === "ai") {
          const result = await startWebsiteBuild(
            clientId,
            clientServiceId,
            overrides
          );
          if (!result.ok) {
            setError(result.error);
            if (/niche|services_offered/.test(result.error)) {
              setShowForm(true);
            }
            return;
          }
          setPreviewUrl(result.previewUrl);
          setNeedsTemplate(result.needsTemplate);
          setShowForm(false);
          return;
        }

        // Goose Kit path — fast return, then polling takes over.
        const result = await startGoosekitBuild(
          clientId,
          clientServiceId,
          overrides
        );
        if (!result.ok) {
          setError(result.error);
          if (/niche|services_offered/.test(result.error)) {
            setShowForm(true);
          }
          return;
        }
        setGoosekitJobId(result.jobId);
        setGoosekitStatus(result.status);
        setShowForm(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start build");
      }
    });
  }

  function handleBuilderClick(builder: Builder) {
    if (showForm) {
      doStart(builder, {
        niche: niche.trim(),
        servicesOffered: servicesOffered.trim(),
      });
    } else {
      doStart(builder);
    }
  }

  const formReady =
    niche.trim().length > 0 && servicesOffered.trim().length > 0;

  // Lock both builder buttons while either builder is mid-flight, and
  // while a Goose Kit job is actively polling toward a terminal state.
  // Prevents double-fires when a build is already running.
  const goosekitActive =
    !!goosekitJobId && !isTerminalStatus(goosekitStatus);
  const disabled =
    isPending || goosekitActive || (showForm && !formReady);

  const aiLabel = isPending && lastBuilder === "ai"
    ? "Building…"
    : showForm
      ? "Start AI with these values"
      : "Start AI build";

  const gooseLabel = (() => {
    if (isPending && lastBuilder === "goosekit") return "Queuing…";
    if (goosekitActive) {
      const stepLabel = goosekitStatus
        ? GOOSEKIT_STATUS_LABELS[goosekitStatus]
        : "Running";
      return `Goose Kit: ${stepLabel}…`;
    }
    if (showForm) return "Start Goose Kit with these values";
    return "Start Goose Kit build";
  })();

  return (
    <div className="flex w-full flex-col items-stretch gap-2">
      {showForm && (
        <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="text-[10px] text-zinc-400">
            These fields weren&apos;t captured during onboarding. Fill them in
            to start the build.
          </p>
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Niche
            </label>
            <input
              type="text"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="e.g. plumber, dentist, payment processing"
              disabled={isPending}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
            />
          </div>
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Services offered
            </label>
            <textarea
              value={servicesOffered}
              onChange={(e) => setServicesOffered(e.target.value)}
              placeholder="One per line, or comma-separated"
              disabled={isPending}
              rows={3}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
            />
          </div>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => handleBuilderClick("ai")}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-md border border-indigo-700/50 bg-indigo-900/20 px-2 py-1 text-xs font-medium text-indigo-300 hover:border-indigo-500/50 hover:bg-indigo-900/40 disabled:opacity-50"
        >
          <Globe className="h-3 w-3" />
          {aiLabel}
        </button>
        <button
          type="button"
          onClick={() => handleBuilderClick("goosekit")}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-md border border-purple-700/50 bg-purple-900/20 px-2 py-1 text-xs font-medium text-purple-300 hover:border-purple-500/50 hover:bg-purple-900/40 disabled:opacity-50"
        >
          {goosekitActive ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Globe className="h-3 w-3" />
          )}
          {gooseLabel}
        </button>
      </div>

      {/* AI build preview link (synchronous path) */}
      {previewUrl && lastBuilder === "ai" && (
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-end gap-1 text-[10px] text-indigo-300 hover:text-indigo-200"
        >
          <ExternalLink className="h-2.5 w-2.5" />
          Preview
        </a>
      )}

      {/* Goose Kit live progress + terminal result */}
      {goosekitJobId && goosekitStatus && (
        <div className="flex flex-col items-end gap-0.5 text-[10px]">
          {goosekitActive && (
            <p className="flex items-center gap-1 text-purple-300">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {GOOSEKIT_STATUS_LABELS[goosekitStatus]}…
            </p>
          )}
          {goosekitStatus === "READY" && goosekitLiveUrl && (
            <a
              href={goosekitLiveUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
            >
              <CheckCircle2 className="h-2.5 w-2.5" />
              Live preview
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          {goosekitStatus === "FAILED" && goosekitError && (
            <p className="flex items-start gap-1 text-rose-400">
              <AlertCircle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
              <span>Goose Kit: {goosekitError}</span>
            </p>
          )}
        </div>
      )}

      {needsTemplate && (
        <p className="flex items-center justify-end gap-1 text-[10px] text-amber-400">
          <AlertCircle className="h-2.5 w-2.5" />
          No template — escalation created
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
