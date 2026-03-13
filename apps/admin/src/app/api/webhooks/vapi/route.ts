import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServerClient } from "@leadrwizard/shared/supabase";
import {
  processCallEndEvent,
  type VapiCallEndEvent,
} from "@leadrwizard/shared/comms";
import { scheduleNextFollowUp } from "@leadrwizard/shared/automations";
import type { OnboardingSession } from "@leadrwizard/shared/types";
import { createRouteLogger } from "@leadrwizard/shared/utils";

const moduleLog = createRouteLogger("webhooks/vapi");

/**
 * Vapi webhook handler.
 * Receives call status events and end-of-call data.
 *
 * Configure in Vapi Dashboard: Assistant > Server URL
 * POST https://your-domain.com/api/webhooks/vapi
 */
export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") || crypto.randomUUID();
  const log = createRouteLogger("webhooks/vapi", { correlation_id: correlationId });

  try {
    const body = await request.json();
    const supabase = createServerClient();

    const eventType = body.message?.type || body.type;

    switch (eventType) {
      case "end-of-call-report": {
        return await handleEndOfCall(supabase, body.message || body);
      }

      case "function-call": {
        return await handleFunctionCall(supabase, body.message || body);
      }

      case "status-update": {
        // Log status changes (ringing, in-progress, etc.)
        const metadata = body.message?.metadata || body.metadata || {};
        if (metadata.client_id && metadata.session_id) {
          await supabase.from("interaction_log").insert({
            client_id: metadata.client_id,
            session_id: metadata.session_id,
            channel: "voice_call",
            direction: "outbound",
            content_type: "system_event",
            content: `Call status: ${body.message?.status || body.status}`,
            metadata: { call_id: body.message?.call?.id || body.call?.id },
          });
        }
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ ok: true });
    }
  } catch (error) {
    log.error({ err: error }, "Vapi webhook error");
    Sentry.withScope((scope) => {
      scope.setTag("correlation_id", correlationId);
      Sentry.captureException(error);
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function handleEndOfCall(
  supabase: ReturnType<typeof createServerClient>,
  data: Record<string, unknown>
): Promise<NextResponse> {
  const metadata = (data.metadata || {}) as Record<string, string>;
  const clientId = metadata.client_id;
  const sessionId = metadata.session_id;

  if (!clientId || !sessionId) {
    moduleLog.warn("Vapi end-of-call report missing client_id or session_id");
    return NextResponse.json({ ok: true });
  }

  const callEvent: VapiCallEndEvent = {
    call_id: (data.call as Record<string, string>)?.id || "",
    phone_number: ((data.call as Record<string, Record<string, string>> | undefined)?.customer)?.number || "",
    duration_seconds: (data.durationSeconds as number) || 0,
    status: mapVapiStatus((data.endedReason as string) || ""),
    transcript: (data.transcript as string) || "",
    recording_url: (data.recordingUrl as string) || null,
    summary: (data.summary as string) || null,
    tool_calls: extractToolCalls(data),
  };

  await processCallEndEvent(supabase, callEvent, clientId, sessionId);

  // If call wasn't answered, schedule next follow-up
  if (
    callEvent.status === "no-answer" ||
    callEvent.status === "busy" ||
    callEvent.status === "failed"
  ) {
    // Get current escalation level from last outreach
    const { data: lastOutreach } = await supabase
      .from("outreach_queue")
      .select("escalation_level")
      .eq("client_id", clientId)
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const currentLevel = lastOutreach?.escalation_level || 0;

    const { data: session } = await supabase
      .from("onboarding_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (session) {
      await scheduleNextFollowUp(
        supabase,
        session as OnboardingSession,
        clientId,
        currentLevel
      );
    }
  }

  return NextResponse.json({ ok: true });
}

async function handleFunctionCall(
  supabase: ReturnType<typeof createServerClient>,
  data: Record<string, unknown>
): Promise<NextResponse> {
  const functionCall = data.functionCall as {
    name: string;
    parameters: Record<string, unknown>;
  };

  if (!functionCall) {
    return NextResponse.json({ ok: true });
  }

  const metadata = (data.metadata || {}) as Record<string, string>;
  const sessionId = metadata.session_id;

  switch (functionCall.name) {
    case "recordAnswer": {
      const params = functionCall.parameters as {
        field_key: string;
        field_value: string;
        client_service_id?: string;
      };

      if (sessionId && params.field_key && params.field_value) {
        await supabase.from("session_responses").insert({
          session_id: sessionId,
          client_service_id: params.client_service_id || null,
          field_key: params.field_key,
          field_value: params.field_value,
          answered_via: "voice_call",
        });
      }

      return NextResponse.json({
        result: "Answer recorded successfully",
      });
    }

    case "advanceToNextItem": {
      return NextResponse.json({
        result: "Moving to next item",
      });
    }

    case "requestCallback": {
      return NextResponse.json({
        result: "We'll call you back soon!",
      });
    }

    case "escalateToHuman": {
      if (metadata.client_id && sessionId) {
        // Resolve org_id for escalation
        const { data: escClient } = await supabase
          .from("clients")
          .select("org_id")
          .eq("id", metadata.client_id)
          .single();

        await supabase.from("escalations").insert({
          client_id: metadata.client_id,
          session_id: sessionId,
          reason:
            (functionCall.parameters.reason as string) ||
            "Client requested human assistance during voice call",
          context: { call_data: data },
          channel: "voice_call",
          status: "open",
          org_id: escClient?.org_id,
        });
      }
      return NextResponse.json({
        result: "A team member will follow up with you shortly.",
      });
    }

    default:
      return NextResponse.json({ result: "Unknown function" });
  }
}

function mapVapiStatus(
  endedReason: string
): VapiCallEndEvent["status"] {
  switch (endedReason) {
    case "assistant-ended-call":
    case "customer-ended-call":
      return "completed";
    case "customer-did-not-answer":
    case "voicemail":
      return "no-answer";
    case "customer-busy":
      return "busy";
    default:
      return "failed";
  }
}

function extractToolCalls(
  data: Record<string, unknown>
): VapiCallEndEvent["tool_calls"] {
  const messages = (data.messages as Array<Record<string, unknown>>) || [];
  const toolCalls: VapiCallEndEvent["tool_calls"] = [];

  for (const msg of messages) {
    if (msg.role === "tool_calls" || msg.toolCalls) {
      const calls =
        (msg.toolCalls as Array<Record<string, unknown>>) || [];
      for (const call of calls) {
        toolCalls.push({
          name: (call.function as Record<string, string>)?.name || "",
          arguments: JSON.parse(
            (call.function as Record<string, string>)?.arguments || "{}"
          ),
          result: call.result,
        });
      }
    }
  }

  return toolCalls;
}
