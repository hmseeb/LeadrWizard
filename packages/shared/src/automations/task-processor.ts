import type { ServiceTask, ServiceTaskStatus } from "../types";
import type { SupabaseClient } from "../supabase/client";
import { createRouteLogger } from "../utils/logger";
import { checkA2PStatus } from "./a2p-manager";
import { checkGMBAccessStatus } from "./gmb-manager";
import { sendSMS } from "../comms/twilio-sms";
import { resolveTemplate, type TemplateParams } from "../comms/message-templates";
import { createEscalation } from "./escalation-notifier";
import { getOrgCredentials } from "../tenant/org-manager";

const log = createRouteLogger("automations/task-processor");

/**
 * Resolve the owning org_id for a `service_tasks` row by walking
 * client_services → clients → org_id. Returns null if any join is
 * missing (e.g. the client_service was deleted). Used by automations
 * that need per-tenant credentials instead of global `process.env.*`.
 */
async function resolveOrgIdForTask(
  supabase: SupabaseClient,
  task: ServiceTask
): Promise<string | null> {
  const { data: clientService } = await supabase
    .from("client_services")
    .select("client_id")
    .eq("id", task.client_service_id)
    .single();

  const clientId = (clientService as Record<string, string> | null)?.client_id;
  if (!clientId) return null;

  const { data: client } = await supabase
    .from("clients")
    .select("org_id")
    .eq("id", clientId)
    .single();

  return (client as Record<string, string> | null)?.org_id || null;
}

/**
 * Move a failed task to the dead letter queue after 5+ failures.
 * Creates an escalation automatically so ops gets notified.
 */
async function moveToDLQ(
  supabase: SupabaseClient,
  task: ServiceTask,
  error: string
): Promise<void> {
  // Resolve org_id and client_id through client_services -> clients
  const { data: clientService } = await supabase
    .from("client_services")
    .select("client_id")
    .eq("id", task.client_service_id)
    .single();

  const clientId = (clientService as Record<string, string> | null)?.client_id || null;

  let orgId: string | null = null;
  if (clientId) {
    const { data: client } = await supabase
      .from("clients")
      .select("org_id")
      .eq("id", clientId)
      .single();
    orgId = (client as Record<string, string> | null)?.org_id || null;
  }

  if (!orgId) {
    log.error({ task_id: task.id }, "Cannot move task to DLQ: unable to resolve org_id");
    return;
  }

  // Insert into dead_letter_queue
  await supabase.from("dead_letter_queue").insert({
    original_table: "service_tasks",
    original_id: task.id,
    task_type: task.task_type,
    org_id: orgId,
    client_id: clientId,
    last_error: error,
    attempt_count: task.attempt_count,
    payload: task.last_result || {},
  });

  // Mark original task as failed with DLQ flag
  await supabase
    .from("service_tasks")
    .update({
      status: "failed" as ServiceTaskStatus,
      last_result: {
        ...(task.last_result || {}),
        moved_to_dlq: true,
        dlq_reason: error,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id);

  // Create escalation for ops visibility
  if (clientId) {
    try {
      await createEscalation(supabase, {
        clientId,
        reason: `Service task "${task.task_type}" failed ${task.attempt_count} times and was moved to the dead letter queue. Last error: ${error}`,
        context: {
          task_id: task.id,
          task_type: task.task_type,
          attempt_count: task.attempt_count,
          last_error: error,
          moved_to_dlq: true,
        },
        channel: "system",
      });
    } catch {
      // Escalation creation failure should not block DLQ insertion
      log.error({ task_id: task.id }, "Failed to create escalation for DLQ entry");
    }
  }
}

/**
 * Service task processor — polls async tasks that are waiting on external systems.
 * Called by a cron job every 5-15 minutes.
 *
 * Handles:
 * - A2P 10DLC registration status (Twilio — days to complete)
 * - GMB access request approval (Google — hours to days)
 * - GHL sub-account provisioning retries
 * - Website approval tracking
 */
export async function processServiceTasks(
  supabase: SupabaseClient
): Promise<{ checked: number; updated: number; errors: number }> {
  // Fetch tasks that are due for a status check
  const { data: tasks, error } = await supabase
    .from("service_tasks")
    .select("*")
    .in("status", ["waiting_external", "in_progress"])
    .lte("next_check_at", new Date().toISOString())
    .order("next_check_at", { ascending: true })
    .limit(50);

  if (error || !tasks) {
    return { checked: 0, updated: 0, errors: error ? 1 : 0 };
  }

  let checked = 0;
  let updated = 0;
  let errors = 0;

  for (const rawTask of tasks) {
    const task = rawTask as ServiceTask;
    checked++;

    try {
      const previousStatus = task.status;
      let newStatus: ServiceTaskStatus = task.status;

      switch (task.task_type) {
        case "a2p_registration": {
          // Resolve the org this task belongs to so we can load its
          // per-tenant Twilio credentials. Previously `checkA2PStatus`
          // read `process.env.TWILIO_*` which never matched what Greg
          // had configured in Settings → Integrations.
          const orgId = await resolveOrgIdForTask(supabase, task);
          if (!orgId) {
            log.warn(
              { task_id: task.id },
              "Cannot poll A2P task: unable to resolve org_id — leaving task for next cron"
            );
            break;
          }
          const creds = await getOrgCredentials(supabase, orgId);
          if (!creds.twilio) {
            log.warn(
              { task_id: task.id, org_id: orgId },
              "Cannot poll A2P task: org has no Twilio credentials configured"
            );
            break;
          }
          newStatus = await checkA2PStatus(
            supabase,
            task,
            creds.twilio,
            creds.ghl ? { apiKey: creds.ghl.apiKey } : undefined
          );
          break;
        }

        case "gmb_access_request": {
          const result = await checkGMBAccessStatus(supabase, task);
          newStatus = result.status;

          // If GMB needs client follow-up, send a reminder SMS
          if (result.needs_client_followup) {
            await sendGMBFollowUpSMS(supabase, task);
          }
          break;
        }

        case "ghl_sub_account_provision": {
          if (task.status === "in_progress" && task.attempt_count < 5) {
            const backoffMinutes = 5 * Math.pow(3, task.attempt_count);
            await supabase
              .from("service_tasks")
              .update({
                next_check_at: new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString(),
                attempt_count: task.attempt_count + 1,
                updated_at: new Date().toISOString(),
              })
              .eq("id", task.id);
          } else if (task.status === "in_progress" && task.attempt_count >= 5) {
            await moveToDLQ(supabase, task, "GHL sub-account provisioning failed after 5 attempts");
          }
          break;
        }

        case "ghl_snapshot_deploy": {
          if (task.status === "in_progress" && task.attempt_count < 5) {
            const backoffMinutes = 5 * Math.pow(3, task.attempt_count);
            await supabase
              .from("service_tasks")
              .update({
                next_check_at: new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString(),
                attempt_count: task.attempt_count + 1,
                updated_at: new Date().toISOString(),
              })
              .eq("id", task.id);
          } else if (task.status === "in_progress" && task.attempt_count >= 5) {
            await moveToDLQ(supabase, task, "GHL snapshot deployment failed after 5 attempts");
          }
          break;
        }

        case "website_generation": {
          // Website tasks are handled interactively (approval flow)
          // Just check if it's been stuck too long
          const lastResult = task.last_result as Record<string, unknown> | null;
          const step = lastResult?.step as string;

          if (step === "preview_sent") {
            const hoursSinceUpdate =
              (Date.now() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60);

            // Remind client about pending website preview after 48h
            if (hoursSinceUpdate > 48) {
              await sendWebsitePreviewReminder(supabase, task);
            }
          }
          break;
        }
      }

      if (newStatus !== previousStatus) {
        updated++;
      }
    } catch (err) {
      errors++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err: err instanceof Error ? err : new Error(errorMessage), task_id: task.id, task_type: task.task_type }, "Failed to process task");

      // Increment attempt count
      const newAttemptCount = task.attempt_count + 1;

      if (newAttemptCount >= 5) {
        // Move to dead letter queue after 5 failures
        await moveToDLQ(supabase, { ...task, attempt_count: newAttemptCount }, errorMessage);
      } else {
        // Schedule retry with exponential backoff: 5min, 15min, 45min, 135min
        const backoffMinutes = 5 * Math.pow(3, newAttemptCount - 1);
        await supabase
          .from("service_tasks")
          .update({
            attempt_count: newAttemptCount,
            next_check_at: new Date(
              Date.now() + backoffMinutes * 60 * 1000
            ).toISOString(),
            last_result: {
              ...(task.last_result || {}),
              last_error: errorMessage,
              last_error_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", task.id);
      }
    }
  }

  // Also check for completed onboarding sessions
  await checkForCompletedSessions(supabase);

  return { checked, updated, errors };
}

/**
 * Send a follow-up SMS to the client about pending GMB access approval.
 */
async function sendGMBFollowUpSMS(
  supabase: SupabaseClient,
  task: ServiceTask
): Promise<void> {
  // Get the client info via client_service
  const { data: clientService } = await supabase
    .from("client_services")
    .select("client_id")
    .eq("id", task.client_service_id)
    .single();

  if (!clientService) return;

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", (clientService as Record<string, string>).client_id)
    .single();

  if (!client || !(client as Record<string, string | null>).phone) return;

  const typedClient = client as { id: string; name: string; phone: string };

  const templateParams: TemplateParams = {
    name: typedClient.name.split(" ")[0],
  };

  const message = resolveTemplate("gmb_access_reminder", templateParams);

  await sendSMS(supabase, {
    to: typedClient.phone,
    body: message,
    clientId: typedClient.id,
  });
}

/**
 * Send a reminder about pending website preview approval.
 */
async function sendWebsitePreviewReminder(
  supabase: SupabaseClient,
  task: ServiceTask
): Promise<void> {
  const lastResult = task.last_result as Record<string, unknown> | null;
  const previewUrl = lastResult?.preview_url as string;
  if (!previewUrl) return;

  const { data: clientService } = await supabase
    .from("client_services")
    .select("client_id")
    .eq("id", task.client_service_id)
    .single();

  if (!clientService) return;

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", (clientService as Record<string, string>).client_id)
    .single();

  if (!client || !(client as Record<string, string | null>).phone) return;

  const typedClient = client as { id: string; name: string; phone: string };

  await sendSMS(supabase, {
    to: typedClient.phone,
    body: `Hey ${typedClient.name.split(" ")[0]}! Your website preview is ready. Check it out here: ${previewUrl}\n\nReply APPROVE to go live, or let us know what changes you'd like (up to 3).`,
    clientId: typedClient.id,
  });

  // Update next check so we don't spam
  await supabase
    .from("service_tasks")
    .update({
      next_check_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id);
}

/**
 * Check if any onboarding sessions have all services delivered.
 * If so, mark the session as completed.
 */
async function checkForCompletedSessions(
  supabase: SupabaseClient
): Promise<void> {
  // Find active sessions
  const { data: sessions } = await supabase
    .from("onboarding_sessions")
    .select("id, client_id")
    .eq("status", "active")
    .limit(100);

  if (!sessions) return;

  for (const session of sessions) {
    const { data: services } = await supabase
      .from("client_services")
      .select("status, opted_out")
      .eq("client_id", session.client_id);

    if (!services || services.length === 0) continue;

    // Check if all non-opted-out services are delivered
    const activeServices = services.filter((s) => !s.opted_out);
    const allDelivered = activeServices.every((s) => s.status === "delivered");

    if (allDelivered && activeServices.length > 0) {
      await supabase
        .from("onboarding_sessions")
        .update({
          status: "completed",
          completion_pct: 100,
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.id);

      // Log completion
      await supabase.from("interaction_log").insert({
        client_id: session.client_id,
        session_id: session.id,
        channel: "system",
        direction: "outbound",
        content_type: "system_event",
        content: "All services delivered. Onboarding complete!",
        metadata: { services_delivered: activeServices.length },
      });
    }
  }
}
