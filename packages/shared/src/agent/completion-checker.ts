import type {
  AgentContext,
  ClientService,
  DataFieldDefinition,
  ServiceDefinition,
  SessionResponse,
} from "../types";

export interface CompletionStatus {
  overall_pct: number;
  services: ServiceCompletionStatus[];
  all_data_collected: boolean;
  all_tasks_done: boolean;
  fully_complete: boolean;
}

export interface ServiceCompletionStatus {
  service_id: string;
  service_name: string;
  status: ClientService["status"];
  total_fields: number;
  completed_fields: number;
  missing_fields: DataFieldDefinition[];
  pct: number;
  pending_tasks: number;
}

/**
 * Checks completion status across all services for a client.
 * Used by the widget (progress bar), follow-up scheduler, and completion gate.
 */
export function checkCompletion(context: AgentContext): CompletionStatus {
  const serviceStatuses: ServiceCompletionStatus[] = context.services.map(
    (s) => {
      const totalRequired = s.definition.required_data_fields.filter(
        (f) => f.required
      ).length;
      const completed = totalRequired - s.missing_fields.length;
      const pendingTasks = s.tasks.filter(
        (t) =>
          t.status === "pending" ||
          t.status === "in_progress" ||
          t.status === "waiting_external"
      ).length;

      return {
        service_id: s.definition.id,
        service_name: s.definition.name,
        status: s.client_service.status,
        total_fields: totalRequired,
        completed_fields: completed,
        missing_fields: s.missing_fields,
        pct: totalRequired > 0 ? Math.round((completed / totalRequired) * 100) : 100,
        pending_tasks: pendingTasks,
      };
    }
  );

  const totalFields = serviceStatuses.reduce(
    (sum, s) => sum + s.total_fields,
    0
  );
  const completedFields = serviceStatuses.reduce(
    (sum, s) => sum + s.completed_fields,
    0
  );
  const allDataCollected = serviceStatuses.every(
    (s) => s.missing_fields.length === 0
  );
  const allTasksDone = serviceStatuses.every((s) => s.pending_tasks === 0);

  return {
    overall_pct:
      totalFields > 0 ? Math.round((completedFields / totalFields) * 100) : 100,
    services: serviceStatuses,
    all_data_collected: allDataCollected,
    all_tasks_done: allTasksDone,
    fully_complete: allDataCollected && allTasksDone,
  };
}

/**
 * Returns a human-friendly summary of what's still needed.
 * Used in follow-up messages and widget UI.
 */
export function getMissingSummary(status: CompletionStatus): string {
  const incomplete = status.services.filter(
    (s) => s.missing_fields.length > 0
  );

  if (incomplete.length === 0) {
    return "All information has been collected!";
  }

  const items = incomplete.map((s) => {
    const fieldNames = s.missing_fields.map((f) => f.label).join(", ");
    return `${s.service_name}: ${fieldNames}`;
  });

  return `Still needed:\n${items.join("\n")}`;
}
