import { useState, useEffect, useCallback } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  OnboardingSession,
  Client,
  ClientService,
  ServiceDefinition,
  SessionResponse,
  DataFieldDefinition,
  AgentDecision,
} from "@leadrwizard/shared/types";

export interface WizardSessionState {
  loading: boolean;
  error: string | null;
  client: Client | null;
  session: OnboardingSession | null;
  services: ServiceWithProgress[];
  currentQuestion: AgentDecision | null;
  completionPct: number;
  mode: "voice" | "visual";
}

export interface ServiceWithProgress {
  clientService: ClientService;
  definition: ServiceDefinition;
  responses: SessionResponse[];
  missingFields: DataFieldDefinition[];
  pct: number;
}

export function useWizardSession(
  sessionId: string,
  apiBaseUrl?: string,
  supabaseUrl?: string,
  supabaseKey?: string
) {
  const [state, setState] = useState<WizardSessionState>({
    loading: true,
    error: null,
    client: null,
    session: null,
    services: [],
    currentQuestion: null,
    completionPct: 0,
    mode: "voice",
  });

  const [supabase] = useState<SupabaseClient | null>(() => {
    const url = supabaseUrl || getMetaContent("leadrwizard:supabase-url");
    const key = supabaseKey || getMetaContent("leadrwizard:supabase-key");
    if (!url || !key) return null;
    return createClient(url, key);
  });

  const loadSession = useCallback(async () => {
    if (!supabase) {
      setState((s) => ({
        ...s,
        loading: false,
        error: "Supabase not configured",
      }));
      return;
    }

    try {
      // Load session
      const { data: session, error: sessionError } = await supabase
        .from("onboarding_sessions")
        .select("*")
        .eq("id", sessionId)
        .single();

      if (sessionError || !session) {
        setState((s) => ({
          ...s,
          loading: false,
          error: "Session not found",
        }));
        return;
      }

      // Load client
      const { data: client } = await supabase
        .from("clients")
        .select("*")
        .eq("id", session.client_id)
        .single();

      // Load client services with definitions
      const { data: clientServices } = await supabase
        .from("client_services")
        .select("*, service:service_definitions(*)")
        .eq("client_id", session.client_id)
        .eq("opted_out", false);

      // Load responses
      const { data: responses } = await supabase
        .from("session_responses")
        .select("*")
        .eq("session_id", sessionId);

      // Calculate progress per service
      const services: ServiceWithProgress[] = (clientServices || []).map(
        (cs: Record<string, unknown>) => {
          const definition = cs.service as unknown as ServiceDefinition;
          const serviceResponses = (responses || []).filter(
            (r: SessionResponse) => r.client_service_id === cs.id
          );
          const answeredKeys = new Set(
            serviceResponses.map((r: SessionResponse) => r.field_key)
          );
          const requiredFields = (definition?.required_data_fields || []).filter(
            (f: DataFieldDefinition) => f.required
          );
          const missingFields = requiredFields.filter(
            (f: DataFieldDefinition) => !answeredKeys.has(f.key)
          );
          const pct =
            requiredFields.length > 0
              ? Math.round(
                  ((requiredFields.length - missingFields.length) /
                    requiredFields.length) *
                    100
                )
              : 100;

          return {
            clientService: cs as unknown as ClientService,
            definition,
            responses: serviceResponses,
            missingFields,
            pct,
          };
        }
      );

      // Find next question
      const serviceWithMissing = services.find(
        (s) => s.missingFields.length > 0
      );
      const currentQuestion: AgentDecision | null = serviceWithMissing
        ? {
            action: "ask_question",
            service_id: serviceWithMissing.definition.id,
            field_key: serviceWithMissing.missingFields[0].key,
            message: `What's your ${serviceWithMissing.missingFields[0].label.toLowerCase()}?`,
            options: serviceWithMissing.missingFields[0].options,
          }
        : {
            action: "complete",
            message: "All set! Your onboarding is complete.",
          };

      // Calculate overall completion
      const totalFields = services.reduce(
        (sum, s) =>
          sum +
          s.definition.required_data_fields.filter(
            (f: DataFieldDefinition) => f.required
          ).length,
        0
      );
      const completedFields = services.reduce(
        (sum, s) =>
          sum +
          s.definition.required_data_fields.filter(
            (f: DataFieldDefinition) => f.required
          ).length -
          s.missingFields.length,
        0
      );
      const completionPct =
        totalFields > 0
          ? Math.round((completedFields / totalFields) * 100)
          : 100;

      setState({
        loading: false,
        error: null,
        client: client as Client,
        session: session as OnboardingSession,
        services,
        currentQuestion,
        completionPct,
        mode: "voice",
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [supabase, sessionId]);

  const submitResponse = useCallback(
    async (
      fieldKey: string,
      fieldValue: string,
      clientServiceId: string | null,
      answeredVia: "click" | "voice" = "click"
    ) => {
      const baseUrl = apiBaseUrl || "";
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

      // Reload session to get next question
      await loadSession();
    },
    [apiBaseUrl, sessionId, state.client, loadSession]
  );

  const setMode = useCallback((mode: "voice" | "visual") => {
    setState((s) => ({ ...s, mode }));
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  return { ...state, submitResponse, setMode, reload: loadSession };
}

function getMetaContent(name: string): string | null {
  if (typeof document === "undefined") return null;
  const meta = document.querySelector(`meta[name="${name}"]`);
  return meta?.getAttribute("content") || null;
}
