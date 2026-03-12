import type { SupabaseClient } from "../supabase/client";

/**
 * Vapi outbound AI voice call adapter.
 * Vapi handles: telephony, AI conversation, function calling, recording, transcription.
 */

export interface VapiConfig {
  apiKey: string;
  assistantId: string;
}

export interface OutboundCallParams {
  phoneNumber: string;
  clientId: string;
  sessionId: string;
  assistantOverrides?: {
    firstMessage?: string;
    systemPrompt?: string;
    model?: {
      provider: string;
      model: string;
    };
  };
  metadata?: Record<string, unknown>;
}

export interface OutboundCallResult {
  callId: string;
  status: string;
}

export interface VapiCallEndEvent {
  call_id: string;
  phone_number: string;
  duration_seconds: number;
  status: "completed" | "no-answer" | "busy" | "failed";
  transcript: string;
  recording_url: string | null;
  summary: string | null;
  tool_calls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result: unknown;
  }>;
}

function getVapiConfig(): VapiConfig {
  const apiKey = process.env.VAPI_API_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;

  if (!apiKey || !assistantId) {
    throw new Error("Missing Vapi config: VAPI_API_KEY, VAPI_ASSISTANT_ID");
  }

  return { apiKey, assistantId };
}

/**
 * Initiate an outbound AI voice call via Vapi.
 * The assistant will use the system prompt to guide the onboarding conversation.
 */
export async function initiateOutboundCall(
  supabase: SupabaseClient,
  params: OutboundCallParams
): Promise<OutboundCallResult> {
  const config = getVapiConfig();

  const requestBody: Record<string, unknown> = {
    assistantId: config.assistantId,
    phoneNumberId: undefined, // Uses Vapi's default phone number
    customer: {
      number: params.phoneNumber,
    },
    metadata: {
      client_id: params.clientId,
      session_id: params.sessionId,
      ...params.metadata,
    },
  };

  // Apply assistant overrides (custom system prompt, first message)
  if (params.assistantOverrides) {
    requestBody.assistantOverrides = {
      firstMessage: params.assistantOverrides.firstMessage,
      model: params.assistantOverrides.model || {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        systemPrompt: params.assistantOverrides.systemPrompt,
      },
    };
  }

  const response = await fetch("https://api.vapi.ai/call/phone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Vapi call failed (${response.status}): ${errorBody}`);
  }

  const result = (await response.json()) as { id: string; status: string };

  // Log outbound call initiation
  await supabase.from("interaction_log").insert({
    client_id: params.clientId,
    session_id: params.sessionId,
    channel: "voice_call",
    direction: "outbound",
    content_type: "system_event",
    content: "Outbound AI voice call initiated",
    metadata: {
      call_id: result.id,
      phone_number: params.phoneNumber,
      status: result.status,
      assistant_id: config.assistantId,
    },
  });

  return {
    callId: result.id,
    status: result.status,
  };
}

/**
 * Process a Vapi call-end webhook event.
 * Logs the full transcript, duration, and any tool calls to the interaction log.
 */
export async function processCallEndEvent(
  supabase: SupabaseClient,
  event: VapiCallEndEvent,
  clientId: string,
  sessionId: string
): Promise<void> {
  // Log the completed call with transcript
  await supabase.from("interaction_log").insert({
    client_id: clientId,
    session_id: sessionId,
    channel: "voice_call",
    direction: "outbound",
    content_type: "voice",
    content: event.transcript || "No transcript available",
    metadata: {
      call_id: event.call_id,
      duration_seconds: event.duration_seconds,
      status: event.status,
      recording_url: event.recording_url,
      summary: event.summary,
      tool_calls: event.tool_calls,
    },
  });

  // Process any tool calls that recorded answers
  for (const toolCall of event.tool_calls) {
    if (toolCall.name === "recordAnswer" && toolCall.arguments) {
      const args = toolCall.arguments as {
        field_key?: string;
        field_value?: string;
        client_service_id?: string;
      };

      if (args.field_key && args.field_value) {
        await supabase.from("session_responses").insert({
          session_id: sessionId,
          client_service_id: args.client_service_id || null,
          field_key: args.field_key,
          field_value: args.field_value,
          answered_via: "voice_call",
        });
      }
    }
  }

  // Update session last interaction
  await supabase
    .from("onboarding_sessions")
    .update({
      current_channel: "voice_call",
      last_interaction_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}

/**
 * Get the status of an ongoing or completed Vapi call.
 */
export async function getCallStatus(
  callId: string
): Promise<{ status: string; duration?: number }> {
  const config = getVapiConfig();

  const response = await fetch(`https://api.vapi.ai/call/${callId}`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get call status: ${response.status}`);
  }

  const result = (await response.json()) as { status: string; duration?: number };
  return {
    status: result.status,
    duration: result.duration,
  };
}
