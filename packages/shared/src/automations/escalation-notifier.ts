import type { Escalation, Client, OnboardingSession, InteractionLog } from "../types";
import type { SupabaseClient } from "../supabase/client";
import { createRouteLogger } from "../utils/logger";

/**
 * Escalation notification system.
 * Sends alerts to Slack or Google Chat when the bot needs human help.
 *
 * Triggers:
 * - Client unresponsive after all follow-up attempts
 * - Client explicitly requests human help (HELP keyword, escalateToHuman voice command)
 * - External process stuck (A2P rejected, GMB access denied)
 * - Bot can't parse client intent after multiple attempts
 */

export interface EscalationNotification {
  escalation: Escalation;
  client: Client;
  session: OnboardingSession | null;
  recentInteractions: InteractionLog[];
}

const log = createRouteLogger("automations/escalation-notifier");

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{ type: string; text?: { type: string; text: string }; url?: string }>;
  fields?: Array<{ type: string; text: string }>;
}

/**
 * Creates an escalation and sends notification to the configured channel.
 */
export async function createEscalation(
  supabase: SupabaseClient,
  params: {
    clientId: string;
    sessionId?: string;
    reason: string;
    context?: Record<string, unknown>;
    channel: string;
  }
): Promise<Escalation> {
  const { data: escalation, error } = await supabase
    .from("escalations")
    .insert({
      client_id: params.clientId,
      session_id: params.sessionId || null,
      reason: params.reason,
      context: params.context || {},
      channel: params.channel,
      status: "open",
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create escalation: ${error.message}`);

  // Gather context for notification
  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", params.clientId)
    .single();

  let session: OnboardingSession | null = null;
  if (params.sessionId) {
    const { data } = await supabase
      .from("onboarding_sessions")
      .select("*")
      .eq("id", params.sessionId)
      .single();
    session = data as OnboardingSession | null;
  }

  // Get recent interactions for context
  const { data: interactions } = await supabase
    .from("interaction_log")
    .select("*")
    .eq("client_id", params.clientId)
    .order("created_at", { ascending: false })
    .limit(10);

  // Send notification
  if (client) {
    await sendEscalationNotification({
      escalation: escalation as Escalation,
      client: client as Client,
      session,
      recentInteractions: (interactions || []) as InteractionLog[],
    });
  }

  // Log the escalation event
  await supabase.from("interaction_log").insert({
    client_id: params.clientId,
    session_id: params.sessionId || null,
    channel: "system",
    direction: "outbound",
    content_type: "system_event",
    content: `Escalation created: ${params.reason}`,
    metadata: { escalation_id: (escalation as Escalation).id },
  });

  return escalation as Escalation;
}

/**
 * Sends escalation notification to Slack and/or Google Chat.
 */
async function sendEscalationNotification(
  notification: EscalationNotification
): Promise<void> {
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  const googleChatUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;

  const promises: Promise<void>[] = [];

  if (slackUrl && slackUrl !== "https://hooks.slack.com/services/xxx") {
    promises.push(sendSlackNotification(slackUrl, notification));
  }

  if (googleChatUrl && googleChatUrl !== "https://chat.googleapis.com/v1/spaces/xxx") {
    promises.push(sendGoogleChatNotification(googleChatUrl, notification));
  }

  if (promises.length === 0) {
    log.warn("No escalation webhook URL configured");
    return;
  }

  await Promise.allSettled(promises);
}

/**
 * Sends a rich Slack notification with escalation context.
 */
async function sendSlackNotification(
  webhookUrl: string,
  notification: EscalationNotification
): Promise<void> {
  const { escalation, client, session, recentInteractions } = notification;

  const statusEmoji = escalation.status === "open" ? ":rotating_light:" : ":warning:";
  const completionPct = session?.completion_pct ?? 0;

  // Build interaction summary
  const interactionSummary = recentInteractions
    .slice(0, 5)
    .map((i) => {
      const time = new Date(i.created_at).toLocaleString();
      const dir = i.direction === "inbound" ? "<<" : ">>";
      return `${time} [${i.channel}] ${dir} ${i.content.substring(0, 100)}`;
    })
    .join("\n");

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${statusEmoji} Escalation: ${escalation.reason.substring(0, 100)}`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Client:*\n${client.name}` },
        { type: "mrkdwn", text: `*Business:*\n${client.business_name || "N/A"}` },
        { type: "mrkdwn", text: `*Email:*\n${client.email}` },
        { type: "mrkdwn", text: `*Phone:*\n${client.phone || "N/A"}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Channel:*\n${escalation.channel}` },
        { type: "mrkdwn", text: `*Completion:*\n${completionPct}%` },
        { type: "mrkdwn", text: `*Session Status:*\n${session?.status || "N/A"}` },
        {
          type: "mrkdwn",
          text: `*Created:*\n${new Date(escalation.created_at).toLocaleString()}`,
        },
      ],
    },
  ];

  if (interactionSummary) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Recent Interactions:*\n\`\`\`${interactionSummary}\`\`\``,
      },
    });
  }

  // Add context if available
  const contextData = escalation.context as Record<string, unknown>;
  if (contextData && Object.keys(contextData).length > 0) {
    const contextStr = Object.entries(contextData)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n")
      .substring(0, 500);

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Additional Context:*\n\`\`\`${contextStr}\`\`\``,
      },
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "View in Dashboard" },
        url: `${process.env.NEXT_PUBLIC_WIDGET_URL?.replace("/onboard", "") || "https://app.leadrwizard.com"}/escalations`,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "View Client" },
        url: `${process.env.NEXT_PUBLIC_WIDGET_URL?.replace("/onboard", "") || "https://app.leadrwizard.com"}/clients/${client.id}`,
      },
    ],
  });

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });

  if (!response.ok) {
    log.error({ status: response.status }, "Slack notification failed");
  }
}

/**
 * Sends a Google Chat notification with escalation context.
 */
async function sendGoogleChatNotification(
  webhookUrl: string,
  notification: EscalationNotification
): Promise<void> {
  const { escalation, client, session, recentInteractions } = notification;

  const completionPct = session?.completion_pct ?? 0;

  const interactionLines = recentInteractions
    .slice(0, 5)
    .map((i) => {
      const dir = i.direction === "inbound" ? "IN" : "OUT";
      return `[${i.channel}/${dir}] ${i.content.substring(0, 80)}`;
    })
    .join("\n");

  const dashboardUrl = process.env.NEXT_PUBLIC_WIDGET_URL?.replace("/onboard", "") || "https://app.leadrwizard.com";

  const card = {
    cardsV2: [
      {
        cardId: `escalation-${escalation.id}`,
        card: {
          header: {
            title: "Escalation Alert",
            subtitle: escalation.reason.substring(0, 120),
            imageUrl: "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/warning/default/48px.svg",
            imageType: "CIRCLE",
          },
          sections: [
            {
              header: "Client Info",
              widgets: [
                {
                  decoratedText: {
                    topLabel: "Name",
                    text: client.name,
                  },
                },
                {
                  decoratedText: {
                    topLabel: "Business",
                    text: client.business_name || "N/A",
                  },
                },
                {
                  decoratedText: {
                    topLabel: "Contact",
                    text: `${client.email} | ${client.phone || "No phone"}`,
                  },
                },
                {
                  decoratedText: {
                    topLabel: "Onboarding Progress",
                    text: `${completionPct}% complete | Channel: ${escalation.channel}`,
                  },
                },
              ],
            },
            ...(interactionLines
              ? [
                  {
                    header: "Recent Interactions",
                    widgets: [
                      {
                        textParagraph: {
                          text: `<pre>${interactionLines}</pre>`,
                        },
                      },
                    ],
                  },
                ]
              : []),
            {
              widgets: [
                {
                  buttonList: {
                    buttons: [
                      {
                        text: "View in Dashboard",
                        onClick: {
                          openLink: { url: `${dashboardUrl}/escalations` },
                        },
                      },
                      {
                        text: "View Client",
                        onClick: {
                          openLink: { url: `${dashboardUrl}/clients/${client.id}` },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });

  if (!response.ok) {
    log.error({ status: response.status }, "Google Chat notification failed");
  }
}

/**
 * Resolves an escalation and optionally notifies the channel.
 */
export async function resolveEscalation(
  supabase: SupabaseClient,
  escalationId: string,
  resolvedBy: string,
  resolution?: string
): Promise<void> {
  await supabase
    .from("escalations")
    .update({
      status: "resolved",
      assigned_to: resolvedBy,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", escalationId);

  // Log resolution
  const { data: escalation } = await supabase
    .from("escalations")
    .select("client_id, session_id")
    .eq("id", escalationId)
    .single();

  if (escalation) {
    await supabase.from("interaction_log").insert({
      client_id: escalation.client_id,
      session_id: escalation.session_id,
      channel: "system",
      direction: "outbound",
      content_type: "system_event",
      content: `Escalation resolved by ${resolvedBy}${resolution ? `: ${resolution}` : ""}`,
      metadata: { escalation_id: escalationId },
    });
  }
}

/**
 * Assigns an escalation to a team member.
 */
export async function assignEscalation(
  supabase: SupabaseClient,
  escalationId: string,
  assignee: string
): Promise<void> {
  await supabase
    .from("escalations")
    .update({
      status: "assigned",
      assigned_to: assignee,
    })
    .eq("id", escalationId);
}
