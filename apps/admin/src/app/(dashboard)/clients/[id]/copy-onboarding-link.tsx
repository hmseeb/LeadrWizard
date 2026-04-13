"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyOnboardingLinkProps {
  sessionId: string;
}

function buildOnboardingUrl(sessionId: string): string {
  const configured = process.env.NEXT_PUBLIC_WIDGET_URL;
  if (configured) {
    return `${configured}?session=${sessionId}`;
  }
  if (typeof window !== "undefined") {
    return `${window.location.origin}/onboard?session=${sessionId}`;
  }
  return `/onboard?session=${sessionId}`;
}

export function CopyOnboardingLink({ sessionId }: CopyOnboardingLinkProps) {
  const [copied, setCopied] = useState(false);
  const url = buildOnboardingUrl(sessionId);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this onboarding link:", url);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-surface p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Onboarding Link
          </p>
          <p className="mt-1 truncate font-mono text-xs text-zinc-400">
            {url}
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-brand-500/50 hover:text-brand-400"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy link
            </>
          )}
        </button>
      </div>
    </div>
  );
}
