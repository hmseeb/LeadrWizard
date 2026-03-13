import { useState, useEffect, useCallback } from "react";
import type {
  AgentDecision,
  DataFieldDefinition,
} from "@leadrwizard/shared/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WizardSessionState {
  loading: boolean;
  error: string | null;
  client: { id: string; name: string; business_name: string | null } | null;
  session: { id: string; status: string; completion_pct: number; last_interaction_at: string | null } | null;
  services: ServiceWithProgress[];
  currentQuestion: AgentDecision | null;
  completionPct: number;
  mode: "voice" | "visual";
  submitting: boolean;
  stepError: string | null;
}

export interface ServiceWithProgress {
  clientServiceId: string;
  serviceId: string;
  serviceName: string;
  missingFields: DataFieldDefinition[];
  pct: number;
  totalRequired: number;
  completedCount: number;
}

// ---------------------------------------------------------------------------
// Retry utility
// ---------------------------------------------------------------------------

/**
 * Retry a function with exponential backoff.
 * Delays: 1s, 2s, 4s (for default baseDelay=1000, maxAttempts=3)
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWizardSession(sessionId: string, apiBaseUrl?: string) {
  const [state, setState] = useState<WizardSessionState>({
    loading: true,
    error: null,
    client: null,
    session: null,
    services: [],
    currentQuestion: null,
    completionPct: 0,
    mode: "visual",
    submitting: false,
    stepError: null,
  });

  const baseUrl = apiBaseUrl || "";

  // -----------------------------------------------------------------------
  // Load session via API
  // -----------------------------------------------------------------------
  const loadSession = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/api/widget/session/${sessionId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Session not found" }));
        throw new Error(err.error || "Failed to load session");
      }
      const data = await res.json();
      setState((s) => ({
        ...s,
        loading: false,
        error: null,
        client: data.client,
        session: data.session,
        services: data.services,
        currentQuestion: data.currentQuestion,
        completionPct: data.completionPct,
        submitting: false,
        stepError: null,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [baseUrl, sessionId]);

  // -----------------------------------------------------------------------
  // Submit response with retry + exponential backoff
  // -----------------------------------------------------------------------
  const submitResponse = useCallback(
    async (
      fieldKey: string,
      fieldValue: string,
      clientServiceId: string | null,
      answeredVia: "click" | "voice" = "click"
    ) => {
      // Guard against double-submission
      if (state.submitting) return;

      setState((s) => ({ ...s, submitting: true, stepError: null }));

      const doSubmit = async () => {
        const res = await fetch(`${baseUrl}/api/widget/response`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            fieldKey,
            fieldValue,
            clientServiceId,
            answeredVia,
            clientId: state.client?.id || null,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(err.error || "Failed to submit response");
        }
      };

      try {
        await withRetry(doSubmit, 3, 1000);
        // Reload session to get next question from server
        await loadSession();
      } catch (err) {
        setState((s) => ({
          ...s,
          submitting: false,
          stepError:
            "We couldn't save your response after multiple attempts. Please try again or contact support.",
        }));
      }
    },
    [baseUrl, sessionId, state.client, state.submitting, loadSession]
  );

  // -----------------------------------------------------------------------
  // Mode toggle (visual/voice)
  // -----------------------------------------------------------------------
  const setMode = useCallback((mode: "voice" | "visual") => {
    setState((s) => ({ ...s, mode }));
  }, []);

  // -----------------------------------------------------------------------
  // Clear step error (allows user to manually retry after seeing error)
  // -----------------------------------------------------------------------
  const clearStepError = useCallback(() => {
    setState((s) => ({ ...s, stepError: null }));
  }, []);

  // -----------------------------------------------------------------------
  // Initial load
  // -----------------------------------------------------------------------
  useEffect(() => {
    loadSession();
  }, [loadSession]);

  return {
    ...state,
    submitResponse,
    setMode,
    clearStepError,
    reload: loadSession,
  };
}
