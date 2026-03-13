import type { ServiceTask, ServiceTaskStatus } from "../types";
import type { SupabaseClient } from "../supabase/client";
import { checkA2PStatus } from "./a2p-manager";
import { checkGMBAccessStatus } from "./gmb-manager";
import { sendSMS } from "../comms/twilio-sms";
import { resolveTemplate, type TemplateParams } from "../comms/message-templates";

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
          newStatus = await checkA2PStatus(supabase, task);
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
          // Retry failed GHL provisioning
          if (task.status === "in_progress" && task.attempt_count < 3) {
            // The task was created but API call failed — will be retried
            // by the payment handler on next attempt
            await supabase
              .from("service_tasks")
              .update({
                next_check_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                attempt_count: task.attempt_count + 1,
                updated_at: new Date().toISOString(),
              })
              .eq("id", task.id);
          }
          break;
        }

        case "ghl_snapshot_deploy": {
          // Retry failed snapshot deployments
          if (task.status === "in_progress" && task.attempt_count < 3) {
            await supabase
              .from("service_tasks")
              .update({
                next_check_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                attempt_count: task.attempt_count + 1,
                updated_at: new Date().toISOString(),
              })
              .eq("id", task.id);
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
      console.error(
        `Failed to process task ${task.id} (${task.task_type}):`,
        err instanceof Error ? err.message : err
      );
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
