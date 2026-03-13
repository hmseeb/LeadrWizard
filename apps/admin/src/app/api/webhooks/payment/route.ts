import { NextResponse } from "next/server";
import { createServerClient } from "@leadrwizard/shared/supabase";
import { handlePaymentWebhook } from "@leadrwizard/shared/automations";
import type { PaymentWebhookPayload } from "@leadrwizard/shared/automations";

/**
 * Payment webhook handler.
 *
 * Authenticates via Bearer token or API key that maps to an organization.
 * Accepts payment events from Stripe, GHL, or custom integrations.
 *
 * POST https://your-domain.com/api/webhooks/payment
 * Headers:
 *   Authorization: Bearer <org_api_key>
 *   — OR —
 *   X-API-Key: <org_api_key>
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const supabase = createServerClient();

    // Resolve org_id from API key header or request body
    const orgId = await resolveOrgId(supabase, request, body);

    if (!orgId) {
      return NextResponse.json(
        { error: "Unauthorized: provide a valid API key via Authorization header or X-API-Key" },
        { status: 401 }
      );
    }

    const payload: PaymentWebhookPayload = {
      customer_name: body.customer_name,
      customer_email: body.customer_email,
      customer_phone: body.customer_phone,
      business_name: body.business_name,
      package_id: body.package_id,
      payment_ref: body.payment_ref || body.id,
      metadata: body.metadata,
    };

    if (!payload.customer_email || !payload.package_id) {
      return NextResponse.json(
        { error: "Missing required fields: customer_email, package_id" },
        { status: 400 }
      );
    }

    // Verify the webhook signature if a signing secret is configured
    const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (webhookSecret) {
      const signature = request.headers.get("x-webhook-signature") || "";
      const isValid = await verifyWebhookSignature(
        signature,
        JSON.stringify(body),
        webhookSecret
      );
      if (!isValid) {
        return NextResponse.json(
          { error: "Invalid webhook signature" },
          { status: 403 }
        );
      }
    }

    const result = await handlePaymentWebhook(supabase, orgId, payload);

    return NextResponse.json({
      success: true,
      client_id: result.client.id,
      session_id: result.session.id,
    });
  } catch (error) {
    console.error("Payment webhook error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Resolves the org_id from the request.
 * Priority: Authorization Bearer token -> X-API-Key header -> body.org_id fallback.
 */
async function resolveOrgId(
  supabase: ReturnType<typeof createServerClient>,
  request: Request,
  body: Record<string, unknown>
): Promise<string | null> {
  // Extract API key from headers
  const authHeader = request.headers.get("authorization") || "";
  const apiKeyHeader = request.headers.get("x-api-key") || "";
  const apiKey = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : apiKeyHeader.trim();

  if (apiKey) {
    // Look up the organization by API key
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("api_key", apiKey)
      .single();

    if (org) {
      return org.id as string;
    }
  }

  // Fallback: explicit org_id in the body (for testing / trusted internal calls)
  if (typeof body.org_id === "string" && body.org_id) {
    return body.org_id;
  }

  return null;
}

/**
 * Verifies a webhook signature using HMAC-SHA256.
 */
async function verifyWebhookSignature(
  signature: string,
  payload: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(payload);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const computedSignature = Buffer.from(sig).toString("hex");

  // Constant-time comparison
  if (signature.length !== computedSignature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ computedSignature.charCodeAt(i);
  }
  return mismatch === 0;
}
