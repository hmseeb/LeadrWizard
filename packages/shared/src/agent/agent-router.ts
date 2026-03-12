import type { AgentContext, AgentDecision, ChannelType } from "../types";
import { contextToSystemPrompt } from "./agent-context";

/**
 * Determines the next action the agent should take based on current context.
 * In production, this calls Claude API. For now, uses rule-based logic.
 */
export async function decideNextAction(
  context: AgentContext
): Promise<AgentDecision> {
  // Find the first service with missing fields
  const serviceWithMissing = context.services.find(
    (s) => s.missing_fields.length > 0
  );

  if (!serviceWithMissing) {
    // Check for pending tasks
    const pendingTasks = context.services.flatMap((s) =>
      s.tasks.filter(
        (t) => t.status === "pending" || t.status === "in_progress"
      )
    );

    if (pendingTasks.length > 0) {
      return {
        action: "ask_question",
        message:
          "Great news — I have all the info I need! Some setup tasks are still processing. I'll keep you updated on progress.",
      };
    }

    return {
      action: "complete",
      message:
        "Everything is set up! All your services are ready to go. Welcome aboard!",
    };
  }

  const nextField = serviceWithMissing.missing_fields[0];
  const serviceName = serviceWithMissing.definition.name;

  return {
    action: "ask_question",
    service_id: serviceWithMissing.definition.id,
    field_key: nextField.key,
    message: buildQuestionMessage(nextField, serviceName, context.current_channel),
    options: nextField.options,
  };
}

function buildQuestionMessage(
  field: AgentContext["services"][0]["missing_fields"][0],
  serviceName: string,
  channel: ChannelType
): string {
  const helpText = field.help_text ? ` (${field.help_text})` : "";

  if (channel === "sms") {
    return `For your ${serviceName} setup — what's your ${field.label.toLowerCase()}?${helpText}`;
  }

  return `Let's continue setting up your ${serviceName}. What's your ${field.label.toLowerCase()}?${helpText}`;
}

/**
 * Returns the system prompt for Claude API calls.
 * Used by voice (ElevenLabs/Vapi) and SMS response handlers.
 */
export function getAgentSystemPrompt(context: AgentContext): string {
  return contextToSystemPrompt(context);
}
