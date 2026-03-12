import type {
  ChannelType,
  OnboardingSession,
  OutreachCadenceConfig,
  OutreachQueueItem,
} from "../types";
import type { SupabaseClient } from "../supabase/client";

/**
 * Default outreach cadence — escalates from SMS to voice calls to email.
 */
export const DEFAULT_OUTREACH_CADENCE: OutreachCadenceConfig = {
  steps: [
    {
      delay_minutes: 60,
      channel: "sms",
      message_template: "reminder_1",
    },
    {
      delay_minutes: 240,
      channel: "sms",
      message_template: "reminder_2",
    },
    {
      delay_minutes: 1440, // 24 hours
      channel: "voice_call",
      message_template: "call_reminder_1",
    },
    {
      delay_minutes: 2880, // 48 hours
      channel: "email",
      message_template: "email_reminder_1",
    },
    {
      delay_minutes: 2880,
      channel: "sms",
      message_template: "reminder_3",
    },
    {
      delay_minutes: 4320, // 72 hours
      channel: "voice_call",
      message_template: "call_reminder_2",
    },
    {
      delay_minutes: 7200, // 5 days
      channel: "sms",
      message_template: "urgent_reminder",
    },
    {
      delay_minutes: 10080, // 7 days
      channel: "voice_call",
      message_template: "final_call",
    },
  ],
};

/**
 * Schedules the next follow-up based on current escalation level.
 * Called when a session becomes inactive (client stopped responding).
 */
export async function scheduleNextFollowUp(
  supabase: SupabaseClient,
  session: OnboardingSession,
  clientId: string,
  currentEscalationLevel: number,
  cadence: OutreachCadenceConfig = DEFAULT_OUTREACH_CADENCE
): Promise<OutreachQueueItem | null> {
  if (currentEscalationLevel >= cadence.steps.length) {
    // All cadence steps exhausted — escalate to human
    await supabase.from("escalations").insert({
      client_id: clientId,
      session_id: session.id,
      reason: "Client unresponsive after all follow-up attempts",
      context: { escalation_level: currentEscalationLevel },
      channel: "system",
      status: "open",
    });
    return null;
  }

  const step = cadence.steps[currentEscalationLevel];
  const scheduledAt = new Date(
    Date.now() + step.delay_minutes * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("outreach_queue")
    .insert({
      client_id: clientId,
      session_id: session.id,
      channel: step.channel,
      message_template: step.message_template,
      message_params: {},
      scheduled_at: scheduledAt,
      status: "pending",
      attempt_count: 0,
      priority: currentEscalationLevel >= 4 ? "urgent" : "normal",
      escalation_level: currentEscalationLevel + 1,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to schedule follow-up: ${error.message}`);
  return data as OutreachQueueItem;
}

/**
 * Cancels all pending outreach for a session.
 * Called when a client resumes their onboarding or completes it.
 */
export async function cancelPendingOutreach(
  supabase: SupabaseClient,
  sessionId: string
): Promise<void> {
  const { error } = await supabase
    .from("outreach_queue")
    .update({ status: "cancelled" })
    .eq("session_id", sessionId)
    .eq("status", "pending");

  if (error)
    throw new Error(`Failed to cancel pending outreach: ${error.message}`);
}
