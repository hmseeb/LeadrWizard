import type {
  AgentContext,
  Client,
  ClientService,
  DataFieldDefinition,
  InteractionLog,
  OnboardingSession,
  ServiceDefinition,
  ServiceTask,
  SessionResponse,
} from "../types";

/**
 * Builds the full context the AI agent needs to make decisions.
 * This context is passed to Claude to determine the next question/action.
 */
export function buildAgentContext(params: {
  client: Client;
  session: OnboardingSession;
  clientServices: ClientService[];
  serviceDefinitions: ServiceDefinition[];
  responses: SessionResponse[];
  tasks: ServiceTask[];
  recentInteractions: InteractionLog[];
  currentChannel: AgentContext["current_channel"];
}): AgentContext {
  const {
    client,
    session,
    clientServices,
    serviceDefinitions,
    responses,
    tasks,
    recentInteractions,
    currentChannel,
  } = params;

  const services = clientServices
    .filter((cs) => !cs.opted_out)
    .map((cs) => {
      const definition = serviceDefinitions.find(
        (sd) => sd.id === cs.service_id
      );
      if (!definition) {
        throw new Error(`Service definition not found for ${cs.service_id}`);
      }

      const serviceResponses = responses.filter(
        (r) => r.client_service_id === cs.id
      );
      const serviceTasks = tasks.filter(
        (t) => t.client_service_id === cs.id
      );
      const answeredKeys = new Set(serviceResponses.map((r) => r.field_key));
      const missingFields = definition.required_data_fields.filter(
        (f) => f.required && !answeredKeys.has(f.key)
      );

      return {
        client_service: cs,
        definition,
        responses: serviceResponses,
        missing_fields: missingFields,
        tasks: serviceTasks,
      };
    });

  return {
    client,
    session,
    services,
    interaction_history: recentInteractions,
    current_channel: currentChannel,
  };
}

/**
 * Converts agent context into a system prompt for Claude.
 */
export function contextToSystemPrompt(context: AgentContext): string {
  const { client, services } = context;

  const serviceLines = services.map((s) => {
    const status = s.client_service.status;
    const missingCount = s.missing_fields.length;
    const taskSummary = s.tasks
      .map((t) => `${t.task_type}: ${t.status}`)
      .join(", ");

    return [
      `- ${s.definition.name} (status: ${status})`,
      missingCount > 0
        ? `  Missing ${missingCount} fields: ${s.missing_fields.map((f) => f.label).join(", ")}`
        : "  All data collected",
      taskSummary ? `  Tasks: ${taskSummary}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `You are a friendly, persistent onboarding assistant for ${client.business_name || client.name}.

CLIENT INFO:
- Name: ${client.name}
- Business: ${client.business_name || "Not provided"}
- Email: ${client.email}
- Phone: ${client.phone || "Not provided"}

SERVICES TO SET UP:
${serviceLines.join("\n\n")}

INSTRUCTIONS:
- Ask about ONE missing field at a time
- Be conversational and friendly, but focused
- If the client seems confused, offer to explain what the field is for
- If the client wants to skip a service, confirm and mark it as opted out
- When all data for a service is collected, confirm and move to the next service
- Never let the client leave without collecting all required data — be persistent but kind
- If you can't get an answer after multiple attempts, escalate to a human`;
}
