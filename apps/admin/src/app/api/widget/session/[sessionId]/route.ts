import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServerClient } from "@leadrwizard/shared/supabase";
import type {
  ClientService,
  ServiceDefinition,
  SessionResponse,
  DataFieldDefinition,
  AgentDecision,
} from "@leadrwizard/shared/types";
import {
  createRouteLogger,
  filterCurrentlyRequiredFields,
} from "@leadrwizard/shared/utils";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      "Access-Control-Max-Age": "86400",
    },
  });
}

interface ServiceWithProgress {
  clientService: ClientService;
  definition: ServiceDefinition;
  responses: SessionResponse[];
  missingFields: DataFieldDefinition[];
  pct: number;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const correlationId = request.headers.get("x-correlation-id") || crypto.randomUUID();
  let log = createRouteLogger("widget/session", { correlation_id: correlationId });
  let sessionId: string | undefined;
  let orgId: string | undefined;

  try {
    ({ sessionId } = await params);

    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing sessionId" },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = createServerClient();

    // Load session (active or completed — completed sessions show completion screen)
    const { data: session, error: sessionError } = await supabase
      .from("onboarding_sessions")
      .select("*")
      .eq("id", sessionId)
      .in("status", ["active", "completed"])
      .maybeSingle();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Session not found or not active" },
        { status: 404, headers: corsHeaders }
      );
    }

    orgId = session.org_id as string;
    // Enrich logger with resolved context
    log = log.child({ org_id: orgId, session_id: sessionId });

    // Load org voice config
    const { data: org } = await supabase
      .from("organizations")
      .select("elevenlabs_agent_id")
      .eq("id", session.org_id)
      .single();

    // Load client (only safe fields, not full record)
    const { data: client } = await supabase
      .from("clients")
      .select("id, name, email, business_name")
      .eq("id", session.client_id)
      .single();

    if (!client) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    // Load client services with service definitions
    const { data: clientServices } = await supabase
      .from("client_services")
      .select("*, service:service_definitions(*)")
      .eq("client_id", session.client_id)
      .eq("opted_out", false);

    // Load existing responses for this session
    const { data: responses } = await supabase
      .from("session_responses")
      .select("*")
      .eq("session_id", sessionId);

    // Calculate progress per service (same logic as the existing widget hook).
    // The `required_if` clause means a field's required-ness depends on
    // sibling answers — e.g. `tagline` is only required when
    // `existing_website` is empty/N/A. We evaluate that per-service so
    // services don't bleed answers into each other.
    const services: ServiceWithProgress[] = (clientServices || []).map(
      (cs: Record<string, unknown>) => {
        const definition = cs.service as unknown as ServiceDefinition;
        const serviceResponses = (responses || []).filter(
          (r: SessionResponse) => r.client_service_id === cs.id
        );
        const answeredKeys = new Set(
          serviceResponses.map((r: SessionResponse) => r.field_key)
        );
        const answersByKey: Record<string, string> = {};
        for (const r of serviceResponses) {
          answersByKey[r.field_key] = r.field_value;
        }
        const requiredFields = filterCurrentlyRequiredFields(
          definition?.required_data_fields || [],
          answersByKey
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

    // Determine current question
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

    // Calculate overall completion percentage. We re-derive the
    // per-service required-field count from `filterCurrentlyRequiredFields`
    // (which honors `required_if`) instead of just counting `required: true`
    // fields, so the progress bar matches the question flow exactly.
    const perServiceRequiredCount = services.map((s) => {
      const answers: Record<string, string> = {};
      for (const r of s.responses) {
        answers[r.field_key] = r.field_value;
      }
      return filterCurrentlyRequiredFields(
        s.definition?.required_data_fields || [],
        answers
      ).length;
    });
    const totalFields = perServiceRequiredCount.reduce((a, b) => a + b, 0);
    const completedFields = services.reduce(
      (sum, s, idx) => sum + perServiceRequiredCount[idx] - s.missingFields.length,
      0
    );
    const completionPct =
      totalFields > 0
        ? Math.round((completedFields / totalFields) * 100)
        : 100;

    return NextResponse.json(
      {
        session: {
          id: session.id,
          status: session.status,
          completion_pct: session.completion_pct,
          last_interaction_at: session.last_interaction_at,
        },
        client: {
          id: client.id,
          name: client.name,
          business_name: client.business_name,
        },
        services: services.map((s, idx) => ({
          clientServiceId: s.clientService.id,
          serviceId: s.definition.id,
          serviceName: s.definition.name,
          missingFields: s.missingFields,
          pct: s.pct,
          totalRequired: perServiceRequiredCount[idx],
          completedCount: perServiceRequiredCount[idx] - s.missingFields.length,
        })),
        currentQuestion,
        completionPct,
        voiceConfig: {
          elevenlabsAgentId: org?.elevenlabs_agent_id || null,
        },
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    log.error({ err: error }, "Widget session load error");
    Sentry.withScope((scope) => {
      scope.setTag("correlation_id", correlationId);
      if (orgId) scope.setTag("org_id", orgId);
      if (sessionId) scope.setTag("session_id", sessionId);
      Sentry.captureException(error);
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
