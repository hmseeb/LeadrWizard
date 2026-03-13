import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServerClient } from "@leadrwizard/shared/supabase";
import type {
  ServiceDefinition,
  SessionResponse,
  DataFieldDefinition,
} from "@leadrwizard/shared/types";
import { createRouteLogger } from "@leadrwizard/shared/utils";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") || crypto.randomUUID();
  const log = createRouteLogger("widget/response", { correlation_id: correlationId });

  try {
    const body = await request.json();
    const { sessionId, fieldKey, fieldValue, clientServiceId, answeredVia, clientId } = body;

    if (!sessionId || !fieldKey || fieldValue === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: sessionId, fieldKey, fieldValue" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Service role client — bypasses RLS so we can insert after anon policies are removed
    const supabase = createServerClient();

    // Validate session exists and is active — server-side org resolution
    const { data: session } = await supabase
      .from("onboarding_sessions")
      .select("id, org_id, client_id, status")
      .eq("id", sessionId)
      .eq("status", "active")
      .maybeSingle();

    if (!session) {
      return NextResponse.json(
        { error: "Session not found or not active" },
        { status: 404, headers: corsHeaders }
      );
    }

    // Insert response — org_id resolved server-side, never trusted from client body
    const { error: insertError } = await supabase.from("session_responses").insert({
      session_id: sessionId,
      client_service_id: clientServiceId || null,
      field_key: fieldKey,
      field_value: String(fieldValue),
      answered_via: answeredVia || "click",
    });

    if (insertError) {
      throw new Error(`Failed to insert response: ${insertError.message}`);
    }

    // Log interaction server-side (replaces anon interaction_log insert in widget)
    const resolvedClientId = clientId || session.client_id;
    if (resolvedClientId) {
      await supabase.from("interaction_log").insert({
        client_id: resolvedClientId,
        session_id: sessionId,
        channel: "widget",
        direction: "inbound",
        content_type: "text",
        content: `${fieldKey}: ${String(fieldValue)}`,
        metadata: { answered_via: answeredVia || "click" },
      });
    }

    // --- Auto-completion check ---
    // After inserting the response, check if all required fields are now collected.
    // If so, mark the session as completed with 100% progress.
    const { data: clientServices } = await supabase
      .from("client_services")
      .select("id, service_id, service:service_definitions(required_data_fields)")
      .eq("client_id", session.client_id)
      .eq("opted_out", false);

    const { data: allResponses } = await supabase
      .from("session_responses")
      .select("field_key, client_service_id")
      .eq("session_id", sessionId);

    // Calculate if all required fields are answered
    let totalRequired = 0;
    let totalAnswered = 0;

    for (const cs of clientServices || []) {
      const definition = (cs as Record<string, unknown>).service as ServiceDefinition | null;
      const requiredFields = (definition?.required_data_fields || []).filter(
        (f: DataFieldDefinition) => f.required
      );
      totalRequired += requiredFields.length;

      const answeredKeys = new Set(
        (allResponses || [])
          .filter((r: { field_key: string; client_service_id: string | null }) => r.client_service_id === cs.id)
          .map((r: { field_key: string; client_service_id: string | null }) => r.field_key)
      );

      totalAnswered += requiredFields.filter((f: DataFieldDefinition) =>
        answeredKeys.has(f.key)
      ).length;
    }

    const completionPct =
      totalRequired > 0
        ? Math.round((totalAnswered / totalRequired) * 100)
        : 100;

    // Update session completion_pct on every submission
    const updateData: Record<string, unknown> = {
      completion_pct: completionPct,
      last_interaction_at: new Date().toISOString(),
    };

    // Auto-complete when all required fields are collected
    if (totalRequired > 0 && totalAnswered >= totalRequired) {
      updateData.status = "completed";
    }

    await supabase
      .from("onboarding_sessions")
      .update(updateData)
      .eq("id", sessionId);

    return NextResponse.json(
      { ok: true, completionPct, completed: updateData.status === "completed" },
      { headers: corsHeaders }
    );
  } catch (error) {
    log.error({ err: error }, "Widget response error");
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
