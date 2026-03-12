import type {
  AnswerMethod,
  ChannelType,
  InteractionLog,
  SessionResponse,
} from "../types";
import type { SupabaseClient } from "../supabase/client";

export interface RecordResponseParams {
  session_id: string;
  client_service_id: string | null;
  field_key: string;
  field_value: string;
  answered_via: AnswerMethod;
}

export interface LogInteractionParams {
  client_id: string;
  session_id: string | null;
  channel: ChannelType;
  direction: InteractionLog["direction"];
  content_type: InteractionLog["content_type"];
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Records a structured response from any channel.
 */
export async function recordResponse(
  supabase: SupabaseClient,
  params: RecordResponseParams
): Promise<SessionResponse> {
  const { data, error } = await supabase
    .from("session_responses")
    .insert({
      session_id: params.session_id,
      client_service_id: params.client_service_id,
      field_key: params.field_key,
      field_value: params.field_value,
      answered_via: params.answered_via,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to record response: ${error.message}`);
  return data as SessionResponse;
}

/**
 * Logs an interaction to the audit trail.
 * Every SMS, email, call, widget interaction, and system event gets logged.
 */
export async function logInteraction(
  supabase: SupabaseClient,
  params: LogInteractionParams
): Promise<InteractionLog> {
  const { data, error } = await supabase
    .from("interaction_log")
    .insert({
      client_id: params.client_id,
      session_id: params.session_id,
      channel: params.channel,
      direction: params.direction,
      content_type: params.content_type,
      content: params.content,
      metadata: params.metadata || {},
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to log interaction: ${error.message}`);
  return data as InteractionLog;
}

/**
 * Updates session progress after a response is recorded.
 */
export async function updateSessionProgress(
  supabase: SupabaseClient,
  sessionId: string,
  completionPct: number,
  channel: ChannelType
): Promise<void> {
  const { error } = await supabase
    .from("onboarding_sessions")
    .update({
      completion_pct: completionPct,
      current_channel: channel,
      last_interaction_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error)
    throw new Error(`Failed to update session progress: ${error.message}`);
}
