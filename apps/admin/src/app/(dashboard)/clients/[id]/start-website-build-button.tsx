"use client";

import { useTransition, useState } from "react";
import { Globe, ExternalLink, AlertCircle } from "lucide-react";
import { startWebsiteBuild, startGoosekitBuild } from "./actions";

interface StartWebsiteBuildButtonProps {
  clientId: string;
  clientServiceId: string;
}

type Builder = "ai" | "goosekit";

/**
 * Kicks off a website build for a `website-build` client_service.
 *
 * Two builders are supported side-by-side — Greg picks per-client:
 * - **Start AI build** — the in-repo Claude+Vercel flow (`startWebsiteBuild`).
 * - **Start Goose Kit build** — the external Goose Kit orchestrator
 *   (`startGoosekitBuild`), which pushes to GitHub + deploys to Vercel
 *   using the org's Goose Kit credentials.
 *
 * On success we surface the preview URL inline so Greg can click through
 * to the deployment. If the AI builder hit the "no template for this niche"
 * branch we show an amber notice and leave the service in `in_progress` —
 * an escalation has already been opened on the server side.
 *
 * When the onboarding widget didn't capture the service-specific fields
 * the server needs (niche, services_offered), the first click fails with
 * a "Missing required fields" error. We then expand an inline manual-entry
 * form so Greg can type them in and retry without having to re-send the
 * onboarding link to the client. `phone`/`email`/`business_name` are
 * already on the `clients` row and never need manual entry. The same form
 * works for both builders — both server actions use the same resolver and
 * throw identical missing-field errors.
 */
export function StartWebsiteBuildButton({
  clientId,
  clientServiceId,
}: StartWebsiteBuildButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [needsTemplate, setNeedsTemplate] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [niche, setNiche] = useState("");
  const [servicesOffered, setServicesOffered] = useState("");
  const [lastBuilder, setLastBuilder] = useState<Builder | null>(null);

  function doStart(
    builder: Builder,
    overrides?: { niche?: string; servicesOffered?: string }
  ) {
    setError(null);
    setPreviewUrl(null);
    setNeedsTemplate(false);
    setLastBuilder(builder);
    startTransition(async () => {
      try {
        const result =
          builder === "ai"
            ? await startWebsiteBuild(clientId, clientServiceId, overrides)
            : await startGoosekitBuild(clientId, clientServiceId, overrides);
        if (!result.ok) {
          setError(result.error);
          // If the failure was specifically about niche/services_offered
          // (the two fields with no fallback source), expand the manual-
          // entry form so Greg can type them in and retry. Both builders
          // share the same resolver so the error message shape is
          // identical.
          if (/niche|services_offered/.test(result.error)) {
            setShowForm(true);
          }
          return;
        }
        setPreviewUrl(result.previewUrl);
        setNeedsTemplate(result.needsTemplate);
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
  const disabled = isPending || (showForm && !formReady);

  const aiLabel = isPending && lastBuilder === "ai"
    ? "Building…"
    : showForm
      ? "Start AI with these values"
      : "Start AI build";

  const gooseLabel = isPending && lastBuilder === "goosekit"
    ? "Building…"
    : showForm
      ? "Start Goose Kit with these values"
      : "Start Goose Kit build";

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
          <Globe className="h-3 w-3" />
          {gooseLabel}
        </button>
      </div>
      {previewUrl && (
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className={`flex items-center justify-end gap-1 text-[10px] ${
            lastBuilder === "goosekit"
              ? "text-purple-300 hover:text-purple-200"
              : "text-indigo-300 hover:text-indigo-200"
          }`}
        >
          <ExternalLink className="h-2.5 w-2.5" />
          Preview
        </a>
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
