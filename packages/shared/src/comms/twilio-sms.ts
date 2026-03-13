import type { SupabaseClient } from "../supabase/client";
import type { InteractionLog } from "../types";

/**
 * Twilio SMS adapter.
 * Handles sending SMS via Twilio REST API and processing inbound messages.
 */

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export interface SendSMSParams {
  to: string;
  body: string;
  clientId: string;
  sessionId?: string;
}

export interface SendSMSResult {
  messageSid: string;
  status: string;
}

export interface InboundSMS {
  messageSid: string;
  from: string;
  to: string;
  body: string;
  numMedia: number;
  mediaUrls: string[];
}

export function getTwilioConfig(
  orgConfig?: { accountSid: string; authToken: string; phoneNumber: string }
): TwilioConfig {
  if (orgConfig) {
    return {
      accountSid: orgConfig.accountSid,
      authToken: orgConfig.authToken,
      fromNumber: orgConfig.phoneNumber,
    };
  }
  // Fallback to env vars (backward compat)
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error(
      "Missing Twilio config: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER"
    );
  }

  return { accountSid, authToken, fromNumber };
}

/**
 * Send an SMS via Twilio REST API.
 * Also logs the interaction to the audit trail.
 */
export async function sendSMS(
  supabase: SupabaseClient,
  params: SendSMSParams,
  orgConfig?: { accountSid: string; authToken: string; phoneNumber: string }
): Promise<SendSMSResult> {
  const config = getTwilioConfig(orgConfig);

  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;

  const formData = new URLSearchParams({
    To: params.to,
    From: config.fromNumber,
    Body: params.body,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${config.accountSid}:${config.authToken}`).toString(
          "base64"
        ),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Twilio SMS failed (${response.status}): ${errorBody}`);
  }

  const result = (await response.json()) as { sid: string; status: string };

  // Log outbound interaction
  await supabase.from("interaction_log").insert({
    client_id: params.clientId,
    session_id: params.sessionId || null,
    channel: "sms",
    direction: "outbound",
    content_type: "text",
    content: params.body,
    metadata: {
      message_sid: result.sid,
      to: params.to,
      from: config.fromNumber,
      status: result.status,
    },
  });

  return {
    messageSid: result.sid,
    status: result.status,
  };
}

/**
 * Parse an inbound Twilio webhook request body into a structured object.
 */
export function parseInboundSMS(
  body: Record<string, string>
): InboundSMS {
  const numMedia = parseInt(body.NumMedia || "0", 10);
  const mediaUrls: string[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = body[`MediaUrl${i}`];
    if (url) mediaUrls.push(url);
  }

  return {
    messageSid: body.MessageSid || "",
    from: body.From || "",
    to: body.To || "",
    body: body.Body || "",
    numMedia,
    mediaUrls,
  };
}

/**
 * Log an inbound SMS to the interaction log.
 * Returns the client record if found by phone number.
 */
export async function logInboundSMS(
  supabase: SupabaseClient,
  sms: InboundSMS
): Promise<{ clientId: string; sessionId: string | null } | null> {
  // Look up client by phone number
  const normalizedPhone = sms.from.replace(/\D/g, "");
  const { data: clients } = await supabase
    .from("clients")
    .select("id")
    .or(
      `phone.like.%${normalizedPhone.slice(-10)}`
    )
    .limit(1);

  if (!clients || clients.length === 0) {
    return null;
  }

  const clientId = clients[0].id;

  // Find active session for this client
  const { data: sessions } = await supabase
    .from("onboarding_sessions")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .limit(1);

  const sessionId = sessions?.[0]?.id || null;

  // Log inbound interaction
  await supabase.from("interaction_log").insert({
    client_id: clientId,
    session_id: sessionId,
    channel: "sms",
    direction: "inbound",
    content_type: "text",
    content: sms.body,
    metadata: {
      message_sid: sms.messageSid,
      from: sms.from,
      to: sms.to,
      num_media: sms.numMedia,
      media_urls: sms.mediaUrls,
    },
  });

  return { clientId, sessionId };
}

/**
 * Validate that a Twilio webhook request is authentic.
 * Uses the X-Twilio-Signature header.
 */
export async function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>,
  orgConfig?: { accountSid: string; authToken: string; phoneNumber: string }
): Promise<boolean> {
  const config = getTwilioConfig(orgConfig);

  // Build the data string: URL + sorted params
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  // HMAC-SHA1 with auth token
  const encoder = new TextEncoder();
  const keyData = encoder.encode(config.authToken);
  const msgData = encoder.encode(data);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const computedSignature = Buffer.from(sig).toString("base64");

  return computedSignature === signature;
}
