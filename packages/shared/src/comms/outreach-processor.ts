import type { SupabaseClient } from "../supabase/client";
import type { OutreachQueueItem, Client, OnboardingSession, OrgCredentials } from "../types";
import { createRouteLogger } from "../utils/logger";
import { sendSMS } from "./twilio-sms";
import { initiateOutboundCall } from "./vapi-calls";
import { sendEmail, emailTemplates } from "./ghl-email";
import { resolveTemplate, type TemplateParams } from "./message-templates";
import { scheduleNextFollowUp, cancelPendingOutreach } from "../automations/outreach-scheduler";
import { contextToSystemPrompt, buildAgentContext } from "../agent/agent-context";
import { checkCompletion, getMissingSummary } from "../agent/completion-checker";
import { getOrgCredentials } from "../tenant/org-manager";

const log = createRouteLogger("comms/outreach-processor");

/**
 * Processes pending items in the outreach queue.
 * Called by a cron job (pg_cron / Edge Function) every 1-5 minutes.
 */
export async function processOutreachQueue(
  supabase: SupabaseClient
): Promise<{ processed: number; errors: number }> {
  // Fetch pending outreach items that are due
  const { data: items, error } = await supabase
    .from("outreach_queue")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("priority", { ascending: false }) // urgent first
    .order("scheduled_at", { ascending: true })
    .limit(50);

  if (error || !items) {
    return { processed: 0, errors: error ? 1 : 0 };
  }

  let processed = 0;
  let errors = 0;

  for (const item of items as OutreachQueueItem[]) {
    try {
      await processOutreachItem(supabase, item);
      processed++;
    } catch (err) {
      errors++;
      log.error({ err: err instanceof Error ? err : new Error(String(err)), item_id: item.id }, "Failed to process outreach item");

      // Mark as failed after 3 attempts
      const newAttemptCount = item.attempt_count + 1;
      if (newAttemptCount >= 3) {
        await supabase
          .from("outreach_queue")
          .update({ status: "failed", attempt_count: newAttemptCount })
          .eq("id", item.id);
      } else {
        // Retry in 5 minutes
        await supabase
          .from("outreach_queue")
          .update({
            attempt_count: newAttemptCount,
            scheduled_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          })
          .eq("id", item.id);
      }
    }
  }

  return { processed, errors };
}

async function processOutreachItem(
  supabase: SupabaseClient,
  item: OutreachQueueItem
): Promise<void> {
  // Get client info
  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", item.client_id)
    .single();

  if (!client) {
    throw new Error(`Client ${item.client_id} not found`);
  }

  // Get session info
  let session: OnboardingSession | null = null;
  if (item.session_id) {
    const { data } = await supabase
      .from("onboarding_sessions")
      .select("*")
      .eq("id", item.session_id)
      .single();
    session = data as OnboardingSession | null;
  }

  // Check if session was completed since this was queued
  if (session?.status === "completed") {
    await supabase
      .from("outreach_queue")
      .update({ status: "cancelled" })
      .eq("id", item.id);
    return;
  }

  const typedClient = client as Client;

  // Resolve per-org credentials
  const orgCreds = await getOrgCredentials(supabase, typedClient.org_id);

  const onboardingUrl = `${process.env.NEXT_PUBLIC_WIDGET_URL || "https://app.leadrwizard.com/onboard"}?session=${item.session_id || ""}`;

  const templateParams: TemplateParams = {
    name: typedClient.name.split(" ")[0], // First name only
    businessName: typedClient.business_name || undefined,
    packageName: (item.message_params as Record<string, string>)?.package_name,
    onboardingUrl,
    itemsRemaining: session?.completion_pct
      ? Math.round(((100 - session.completion_pct) / 100) * 20) // rough estimate
      : undefined,
  };

  switch (item.channel) {
    case "sms": {
      if (!typedClient.phone) {
        throw new Error(`Client ${typedClient.id} has no phone number`);
      }
      const message = resolveTemplate(item.message_template, templateParams);
      await sendSMS(supabase, {
        to: typedClient.phone,
        body: message,
        clientId: typedClient.id,
        sessionId: item.session_id || undefined,
      }, orgCreds.twilio);
      break;
    }

    case "voice_call": {
      if (!typedClient.phone) {
        throw new Error(`Client ${typedClient.id} has no phone number`);
      }

      // Build a system prompt for the voice agent
      let systemPrompt =
        "You are a friendly onboarding assistant. Help the client complete their setup.";

      if (session) {
        // Try to build full context for better prompting
        try {
          const { data: clientServices } = await supabase
            .from("client_services")
            .select("*, service:service_definitions(*)")
            .eq("client_id", typedClient.id)
            .eq("opted_out", false);

          const { data: responses } = await supabase
            .from("session_responses")
            .select("*")
            .eq("session_id", session.id);

          const { data: tasks } = await supabase
            .from("service_tasks")
            .select("*")
            .in(
              "client_service_id",
              (clientServices || []).map((cs: Record<string, unknown>) => cs.id)
            );

          if (clientServices) {
            const context = buildAgentContext({
              client: typedClient,
              session,
              clientServices: clientServices.map((cs: Record<string, unknown>) => ({
                ...cs,
                service: undefined,
              })) as never[],
              serviceDefinitions: clientServices.map(
                (cs: Record<string, unknown>) => cs.service
              ) as never[],
              responses: (responses || []) as never[],
              tasks: (tasks || []) as never[],
              recentInteractions: [],
              currentChannel: "voice_call",
            });
            systemPrompt = contextToSystemPrompt(context);
          }
        } catch {
          // Fall back to generic prompt
        }
      }

      await initiateOutboundCall(supabase, {
        phoneNumber: typedClient.phone,
        clientId: typedClient.id,
        sessionId: item.session_id || "",
        assistantOverrides: {
          firstMessage: `Hi ${templateParams.name}! This is your setup assistant calling about your ${templateParams.packageName || "services"}. Do you have a few minutes to finish your setup?`,
          systemPrompt,
        },
      }, orgCreds.vapi);
      break;
    }

    case "email": {
      if (!typedClient.ghl_contact_id) {
        throw new Error(`Client ${typedClient.id} has no GHL contact ID`);
      }

      const emailContent = item.message_template.includes("welcome")
        ? emailTemplates.welcome({
            name: templateParams.name,
            packageName: templateParams.packageName || "services",
            onboardingUrl,
          })
        : emailTemplates.reminder({
            name: templateParams.name,
            itemsRemaining: templateParams.itemsRemaining || 0,
            onboardingUrl,
          });

      await sendEmail(supabase, {
        contactId: typedClient.ghl_contact_id,
        subject: emailContent.subject,
        htmlBody: emailContent.html,
        clientId: typedClient.id,
        sessionId: item.session_id || undefined,
      }, orgCreds.ghl);
      break;
    }
  }

  // Mark as sent
  await supabase
    .from("outreach_queue")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      attempt_count: item.attempt_count + 1,
    })
    .eq("id", item.id);
}

/**
 * Handle an inbound SMS reply from a client.
 * Determines intent and takes action (resume session, schedule call, etc.)
 */
export async function handleInboundSMSReply(
  supabase: SupabaseClient,
  clientId: string,
  sessionId: string | null,
  messageBody: string
): Promise<{ action: string; response: string }> {
  const normalizedBody = messageBody.trim().toUpperCase();

  // Cancel any pending outreach since they're engaging
  if (sessionId) {
    await cancelPendingOutreach(supabase, sessionId);
  }

  // Check for known intents
  if (normalizedBody === "CALL" || normalizedBody === "YES") {
    // Client wants a phone call
    const { data: client } = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .single();

    if (client?.phone) {
      const typedClient = client as Client;
      const orgCreds = await getOrgCredentials(supabase, typedClient.org_id);

      // Get or find active session
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const { data: sessions } = await supabase
          .from("onboarding_sessions")
          .select("id")
          .eq("client_id", clientId)
          .eq("status", "active")
          .limit(1);
        activeSessionId = sessions?.[0]?.id || null;
      }

      if (activeSessionId) {
        await initiateOutboundCall(supabase, {
          phoneNumber: typedClient.phone!,
          clientId: typedClient.id,
          sessionId: activeSessionId as string,
          assistantOverrides: {
            firstMessage: `Hi ${typedClient.name.split(" ")[0]}! You asked me to call. Ready to finish your setup?`,
          },
        }, orgCreds.vapi);
      }

      return {
        action: "call_initiated",
        response: "Calling you now! Pick up and I'll walk you through it.",
      };
    }

    return {
      action: "no_phone",
      response: "I'd love to call but I don't have your phone number. Can you share it?",
    };
  }

  if (normalizedBody === "STOP" || normalizedBody === "UNSUBSCRIBE") {
    return {
      action: "opt_out",
      response: "Got it. You've been unsubscribed from messages. Reply START to re-subscribe anytime.",
    };
  }

  if (normalizedBody === "HELP") {
    return {
      action: "escalate",
      response: "Connecting you with our team. Someone will reach out shortly!",
    };
  }

  if (normalizedBody === "APPROVE") {
    return {
      action: "approval",
      response: "Approved! We're moving forward with your setup.",
    };
  }

  // For any other message, treat it as a potential answer to an onboarding question
  // The AI agent should parse this — for now, acknowledge and provide the link
  const onboardingUrl = sessionId
    ? `${process.env.NEXT_PUBLIC_WIDGET_URL || "https://app.leadrwizard.com/onboard"}?session=${sessionId}`
    : "";

  return {
    action: "unknown_intent",
    response: onboardingUrl
      ? `Thanks for your reply! The fastest way to complete your setup is here: ${onboardingUrl}\n\nOr reply CALL and I'll ring you.`
      : "Thanks for your reply! A team member will get back to you shortly.",
  };
}
