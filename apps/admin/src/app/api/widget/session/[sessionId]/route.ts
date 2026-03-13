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
import { createRouteLogger } from "@leadrwizard/shared/utils";

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
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const correlationId = crypto.randomUUID();
  const log = createRouteLogger("widget/session", { correlation_id: correlationId });

  try {
    const { sessionId } = await params;

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

    // Calculate progress per service (same logic as the existing widget hook)
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

    // Calculate overall completion percentage
    const totalFields = services.reduce(
      (sum, s) =>
        sum +
        (s.definition?.required_data_fields || []).filter(
          (f: DataFieldDefinition) => f.required
        ).length,
      0
    );
    const completedFields = services.reduce(
      (sum, s) =>
        sum +
        (s.definition?.required_data_fields || []).filter(
          (f: DataFieldDefinition) => f.required
        ).length -
        s.missingFields.length,
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
        services: services.map((s) => ({
          clientServiceId: s.clientService.id,
          serviceId: s.definition.id,
          serviceName: s.definition.name,
          missingFields: s.missingFields,
          pct: s.pct,
          totalRequired: (s.definition?.required_data_fields || []).filter(
            (f: DataFieldDefinition) => f.required
          ).length,
          completedCount:
            (s.definition?.required_data_fields || []).filter(
              (f: DataFieldDefinition) => f.required
            ).length - s.missingFields.length,
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
      Sentry.captureException(error);
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
