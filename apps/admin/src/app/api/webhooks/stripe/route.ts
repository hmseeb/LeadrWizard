import { NextResponse } from "next/server";
import { createServerClient } from "@leadrwizard/shared/supabase";
import { processStripeWebhook } from "@leadrwizard/shared/billing";

/**
 * Stripe webhook handler.
 * Processes subscription events (checkout complete, subscription update/cancel, payment failure).
 *
 * Configure in Stripe Dashboard: Developers > Webhooks
 * POST https://your-domain.com/api/webhooks/stripe
 */
export async function POST(request: Request) {
  try {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    // In production, verify the webhook signature using STRIPE_WEBHOOK_SECRET
    // For now, parse the event directly
    const event = JSON.parse(body) as {
      type: string;
      data: { object: Record<string, unknown> };
    };

    const supabase = createServerClient();
    await processStripeWebhook(supabase, event);

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
