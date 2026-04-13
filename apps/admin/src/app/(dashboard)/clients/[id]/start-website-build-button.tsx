"use client";

import { useTransition, useState } from "react";
import { Globe, ExternalLink, AlertCircle } from "lucide-react";
import { startWebsiteBuild } from "./actions";

interface StartWebsiteBuildButtonProps {
  clientId: string;
  clientServiceId: string;
}

/**
 * Kicks off the AI website build for a `website-build` client_service.
 *
 * Shown on the services card on the client detail page when the row is
 * in `ready_to_deliver`. On success we surface the preview URL inline so
 * Greg can click through to the Vercel deployment. If the builder hit the
 * "no template for this niche" branch we show a yellow notice and leave
 * the service in `in_progress` — an escalation has already been opened
 * on the server side.
 */
export function StartWebsiteBuildButton({
  clientId,
  clientServiceId,
}: StartWebsiteBuildButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [needsTemplate, setNeedsTemplate] = useState(false);

  function handleClick() {
    setError(null);
    setPreviewUrl(null);
    setNeedsTemplate(false);
    startTransition(async () => {
      try {
        const result = await startWebsiteBuild(clientId, clientServiceId);
        if (!result.ok) {
          // Server action caught the error internally and returned the real
          // message as data (see actions.ts). Next.js won't scrub this the
          // way it scrubs thrown errors in production builds.
          setError(result.error);
          return;
        }
        setPreviewUrl(result.previewUrl);
        setNeedsTemplate(result.needsTemplate);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start build");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded-md border border-indigo-700/50 bg-indigo-900/20 px-2 py-1 text-xs font-medium text-indigo-300 hover:border-indigo-500/50 hover:bg-indigo-900/40 disabled:opacity-50"
      >
        <Globe className="h-3 w-3" />
        {isPending ? "Building…" : "Start website build"}
      </button>
      {previewUrl && (
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-indigo-300 hover:text-indigo-200"
        >
          <ExternalLink className="h-2.5 w-2.5" />
          Preview
        </a>
      )}
      {needsTemplate && (
        <p className="flex items-center gap-1 text-[10px] text-amber-400">
          <AlertCircle className="h-2.5 w-2.5" />
          No template — escalation created
        </p>
      )}
      {error && (
        <p className="flex items-center gap-1 text-[10px] text-rose-400">
          <AlertCircle className="h-2.5 w-2.5" />
          {error}
        </p>
      )}
    </div>
  );
}
