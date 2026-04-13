"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Zap } from "lucide-react";

declare global {
  interface Window {
    LeadrWizard?: {
      init: (config: {
        sessionId: string;
        containerId: string;
        apiBaseUrl: string;
        allowedOrigins?: string[];
        theme?: {
          primaryColor?: string;
          borderRadius?: string;
          fontFamily?: string;
        };
      }) => void;
    };
  }
}

const CONTAINER_ID = "leadrwizard-onboard-container";

export function OnboardClient() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;

    if (!sessionId) {
      setErrorMessage(
        "Missing session ID. Please use the link provided to you."
      );
      setStatus("error");
      return;
    }

    const widgetScriptUrl =
      process.env.NEXT_PUBLIC_WIDGET_SCRIPT_URL || "/widget.js";

    // If the widget script is already loaded (e.g. fast client nav), init directly.
    if (typeof window !== "undefined" && window.LeadrWizard) {
      initWidget(sessionId);
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-leadrwizard-widget]`
    );
    if (existing) {
      existing.addEventListener("load", () => initWidget(sessionId));
      existing.addEventListener("error", handleScriptError);
      return;
    }

    const script = document.createElement("script");
    script.src = widgetScriptUrl;
    script.async = true;
    script.defer = true;
    script.dataset.leadrwizardWidget = "true";
    script.addEventListener("load", () => initWidget(sessionId));
    script.addEventListener("error", handleScriptError);
    document.head.appendChild(script);

    function handleScriptError() {
      setErrorMessage(
        "Could not load the onboarding widget. Please try again or contact support."
      );
      setStatus("error");
    }

    function initWidget(sid: string) {
      if (initializedRef.current) return;
      if (!window.LeadrWizard) {
        handleScriptError();
        return;
      }
      try {
        window.LeadrWizard.init({
          sessionId: sid,
          containerId: CONTAINER_ID,
          apiBaseUrl: window.location.origin,
        });
        initializedRef.current = true;
        setStatus("ready");
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to start onboarding."
        );
        setStatus("error");
      }
    }
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-zinc-950 bg-[radial-gradient(ellipse_at_center,_rgba(16,185,129,0.06)_0%,_transparent_70%)]">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-8">
        <header className="flex items-center justify-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/15 shadow-glow">
            <Zap className="h-5 w-5 text-brand-400" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight text-zinc-50">
            LeadrWizard
          </span>
        </header>

        <main className="mt-8 flex-1">
          {status === "loading" && (
            <div className="rounded-xl border border-zinc-800 bg-surface p-8 text-center shadow-card">
              <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-brand-400" />
              <p className="mt-4 text-sm text-zinc-400">
                Loading your onboarding...
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="rounded-xl border border-rose-900/50 bg-rose-950/30 p-6 shadow-card">
              <h2 className="font-display text-lg font-semibold text-rose-300">
                We hit a snag
              </h2>
              <p className="mt-2 text-sm text-rose-200/80">{errorMessage}</p>
            </div>
          )}

          {/* Widget mounts into this container. Visible once ready. */}
          <div
            id={CONTAINER_ID}
            className={status === "ready" ? "mt-0 rounded-xl bg-white p-4 shadow-card" : "hidden"}
          />
        </main>

        <footer className="mt-8 text-center text-xs text-zinc-600">
          Powered by LeadrWizard
        </footer>
      </div>
    </div>
  );
}
