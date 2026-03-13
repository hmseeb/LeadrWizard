import type { SupabaseClient } from "../supabase/client";

/**
 * GoHighLevel email adapter.
 * Sends emails through GHL's conversation/email API on the contact's sub-account.
 * GHL handles delivery, tracking (opens/clicks), and contact record updates.
 */

export interface GHLEmailConfig {
  apiKey: string;
  locationId: string;
}

export interface SendEmailParams {
  contactId: string;
  subject: string;
  htmlBody: string;
  clientId: string;
  sessionId?: string;
}

export interface SendEmailResult {
  conversationId: string;
  messageId: string;
}

export function getGHLConfig(
  orgConfig?: { apiKey: string; locationId: string }
): GHLEmailConfig {
  if (orgConfig) {
    return {
      apiKey: orgConfig.apiKey,
      locationId: orgConfig.locationId,
    };
  }
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    throw new Error("Missing GHL config: GHL_API_KEY, GHL_LOCATION_ID");
  }

  return { apiKey, locationId };
}

/**
 * Send an email to a GHL contact via GHL's Conversations API.
 * The email is sent from the sub-account's configured email address.
 */
export async function sendEmail(
  supabase: SupabaseClient,
  params: SendEmailParams,
  orgConfig?: { apiKey: string; locationId: string }
): Promise<SendEmailResult> {
  const config = getGHLConfig(orgConfig);

  // Create or get conversation for this contact
  const response = await fetch(
    "https://services.leadconnectorhq.com/conversations/messages",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Version: "2021-04-15",
      },
      body: JSON.stringify({
        type: "Email",
        contactId: params.contactId,
        subject: params.subject,
        html: params.htmlBody,
        emailFrom: undefined, // Uses location's default email
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GHL email failed (${response.status}): ${errorBody}`);
  }

  const result = (await response.json()) as {
    conversationId: string;
    messageId: string;
  };

  // Log outbound email interaction
  await supabase.from("interaction_log").insert({
    client_id: params.clientId,
    session_id: params.sessionId || null,
    channel: "email",
    direction: "outbound",
    content_type: "text",
    content: `Subject: ${params.subject}\n\n${stripHtml(params.htmlBody)}`,
    metadata: {
      conversation_id: result.conversationId,
      message_id: result.messageId,
      ghl_contact_id: params.contactId,
      subject: params.subject,
    },
  });

  return {
    conversationId: result.conversationId,
    messageId: result.messageId,
  };
}

/**
 * Email templates for onboarding outreach.
 * These generate HTML email content for different stages.
 */
export const emailTemplates = {
  welcome(params: { name: string; packageName: string; onboardingUrl: string }): {
    subject: string;
    html: string;
  } {
    return {
      subject: `Welcome! Let's get your ${params.packageName} set up`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #6366f1;">Welcome aboard, ${params.name}!</h2>
          <p>Thanks for choosing us. I'm your setup assistant and I'm here to get your <strong>${params.packageName}</strong> running as quickly as possible.</p>
          <p>The setup takes just a few minutes — you can even do it by voice!</p>
          <a href="${params.onboardingUrl}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">Start Setup</a>
          <p style="color: #6b7280; font-size: 14px;">Or reply to this email and I'll call you to walk through it together.</p>
        </div>
      `,
    };
  },

  reminder(params: {
    name: string;
    itemsRemaining: number;
    onboardingUrl: string;
  }): { subject: string; html: string } {
    return {
      subject: `${params.name}, you're almost there — ${params.itemsRemaining} items left`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #6366f1;">Almost done, ${params.name}!</h2>
          <p>You only have <strong>${params.itemsRemaining} items</strong> left to complete your setup. It'll take less than 5 minutes.</p>
          <a href="${params.onboardingUrl}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">Continue Setup</a>
          <p style="color: #6b7280; font-size: 14px;">Your services won't activate until setup is complete. Reply CALL and I'll ring you right now.</p>
        </div>
      `,
    };
  },

  completion(params: { name: string; servicesDelivered: string[] }): {
    subject: string;
    html: string;
  } {
    const serviceList = params.servicesDelivered
      .map((s) => `<li>${s}</li>`)
      .join("");

    return {
      subject: `You're all set, ${params.name}! Your services are live.`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #22c55e;">All set, ${params.name}!</h2>
          <p>Your setup is complete. Here's what's been activated:</p>
          <ul>${serviceList}</ul>
          <p>If you have any questions, just reply to this email.</p>
        </div>
      `,
    };
  },
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
