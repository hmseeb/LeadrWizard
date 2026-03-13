import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServerClient } from "@leadrwizard/shared/supabase";
import {
  parseInboundSMS,
  logInboundSMS,
  sendSMS,
  handleInboundSMSReply,
  validateTwilioSignature,
} from "@leadrwizard/shared/comms";
import { createRouteLogger } from "@leadrwizard/shared/utils";

/**
 * Twilio inbound SMS webhook.
 * Receives SMS replies from clients and processes them.
 *
 * Configure in Twilio: Messaging > Phone Number > Webhook URL
 * POST https://your-domain.com/api/webhooks/twilio
 */
export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") || crypto.randomUUID();
  const log = createRouteLogger("webhooks/twilio", { correlation_id: correlationId });

  try {
    const contentType = request.headers.get("content-type") || "";
    let body: Record<string, string>;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries()) as Record<string, string>;
    } else {
      body = await request.json();
    }

    // Validate Twilio signature to prevent spoofed requests
    const signature = request.headers.get("x-twilio-signature") || "";
    const requestUrl = new URL(request.url);
    const webhookUrl = `${requestUrl.protocol}//${requestUrl.host}${requestUrl.pathname}`;

    const isValid = await validateTwilioSignature(signature, webhookUrl, body);
    if (!isValid) {
      log.warn("Invalid Twilio signature");
      return new NextResponse("Forbidden", { status: 403 });
    }

    const sms = parseInboundSMS(body);

    if (!sms.body && sms.numMedia === 0) {
      return twimlResponse(""); // Empty message, no response
    }

    const supabase = createServerClient();

    // Find the client by phone number
    const result = await logInboundSMS(supabase, sms);

    if (!result) {
      // Unknown sender — could be a new lead or wrong number
      log.warn({ from: sms.from }, "Inbound SMS from unknown number");
      return twimlResponse(
        "Thanks for reaching out! It looks like we don't have your number on file. Please contact us at our main line."
      );
    }

    // Process the reply and determine response
    const { action, response } = await handleInboundSMSReply(
      supabase,
      result.clientId,
      result.sessionId,
      sms.body
    );

    // Handle special actions
    if (action === "escalate") {
      // Create escalation
      await supabase.from("escalations").insert({
        client_id: result.clientId,
        session_id: result.sessionId,
        reason: `Client replied HELP via SMS: "${sms.body}"`,
        context: { inbound_message: sms.body, from: sms.from },
        channel: "sms",
        status: "open",
      });
    }

    if (action === "opt_out") {
      // Mark session as abandoned
      if (result.sessionId) {
        await supabase
          .from("onboarding_sessions")
          .update({ status: "abandoned", updated_at: new Date().toISOString() })
          .eq("id", result.sessionId);
      }
    }

    // Send the auto-reply via Twilio (so it's logged in interaction_log)
    if (response) {
      await sendSMS(supabase, {
        to: sms.from,
        body: response,
        clientId: result.clientId,
        sessionId: result.sessionId || undefined,
      });
    }

    // Return TwiML empty response (we send replies via API, not TwiML)
    return twimlResponse("");
  } catch (error) {
    log.error({ err: error }, "Twilio webhook error");
    Sentry.withScope((scope) => {
      scope.setTag("correlation_id", correlationId);
      Sentry.captureException(error);
    });
    return twimlResponse("");
  }
}

function twimlResponse(message: string): NextResponse {
  const twiml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

  return new NextResponse(twiml, {
    headers: { "Content-Type": "text/xml" },
  });
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
