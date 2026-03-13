import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServerClient } from "@leadrwizard/shared/supabase";
import { handlePaymentWebhook } from "@leadrwizard/shared/automations";
import type { PaymentWebhookPayload } from "@leadrwizard/shared/automations";
import { createRouteLogger } from "@leadrwizard/shared/utils";

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
  const correlationId = request.headers.get("x-correlation-id") || crypto.randomUUID();
  let log = createRouteLogger("webhooks/payment", { correlation_id: correlationId });
  let orgId: string | null = null;
  let sessionId: string | undefined;

  try {
    const body = await request.json();

    const supabase = createServerClient();

    // Resolve org_id from API key header or request body
    orgId = await resolveOrgId(supabase, request, body);

    if (!orgId) {
      return NextResponse.json(
        { error: "Unauthorized: provide a valid API key via Authorization header or X-API-Key" },
        { status: 401 }
      );
    }

    // Enrich logger with org context
    log = log.child({ org_id: orgId });

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

    // Idempotency: check if this payment_ref was already processed
    const paymentRef = body.payment_ref || body.id;
    if (paymentRef) {
      const { data: existing } = await supabase
        .from("processed_webhook_events")
        .select("id")
        .eq("id", String(paymentRef))
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ received: true, duplicate: true }); // 200, not 4xx
      }

      await supabase
        .from("processed_webhook_events")
        .upsert(
          { id: String(paymentRef), source: "payment" },
          { onConflict: "id", ignoreDuplicates: true }
        );
    }

    const result = await handlePaymentWebhook(supabase, orgId, payload);
    sessionId = result.session.id;

    return NextResponse.json({
      success: true,
      client_id: result.client.id,
      session_id: result.session.id,
    });
  } catch (error) {
    log.error({ err: error }, "Payment webhook error");
    Sentry.withScope((scope) => {
      scope.setTag("correlation_id", correlationId);
      if (orgId) scope.setTag("org_id", orgId);
      if (sessionId) scope.setTag("session_id", sessionId);
      Sentry.captureException(error);
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Resolves the org_id from the request.
 * Priority: Authorization Bearer token -> X-API-Key header -> X-Internal-Secret header (dev only).
 * The request body is never trusted for org resolution — prevents account takeover.
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

  // Internal secret for testing (dev only) — env var gated, not body-based
  const internalSecret = request.headers.get("x-internal-secret");
  if (
    internalSecret &&
    process.env.INTERNAL_WEBHOOK_SECRET &&
    internalSecret === process.env.INTERNAL_WEBHOOK_SECRET
  ) {
    // For internal testing, require explicit org_id in a header, not body
    const headerOrgId = request.headers.get("x-org-id");
    if (headerOrgId) return headerOrgId;
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
