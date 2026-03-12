import { NextResponse } from "next/server";
import { createServerClient } from "@leadrwizard/shared/supabase";
import { handlePaymentWebhook } from "@leadrwizard/shared/automations";
import type { PaymentWebhookPayload } from "@leadrwizard/shared/automations";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // TODO: Verify webhook signature (Stripe, GHL, etc.)

    const payload: PaymentWebhookPayload = {
      customer_name: body.customer_name,
      customer_email: body.customer_email,
      customer_phone: body.customer_phone,
      business_name: body.business_name,
      package_id: body.package_id,
      payment_ref: body.payment_ref || body.id,
      metadata: body.metadata,
    };

    // TODO: Get org_id from webhook source or API key
    const orgId = body.org_id;

    if (!orgId || !payload.customer_email || !payload.package_id) {
      return NextResponse.json(
        { error: "Missing required fields: org_id, customer_email, package_id" },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
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
