import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createServerClient } from "@leadrwizard/shared/supabase";
import {
  constructEvent,
  processStripeWebhook,
} from "@leadrwizard/shared/billing";

/**
 * Stripe webhook handler.
 * Processes subscription events (checkout complete, subscription update/cancel, payment failure).
 *
 * Configure in Stripe Dashboard: Developers > Webhooks
 * POST https://your-domain.com/api/webhooks/stripe
 */
export async function POST(request: Request) {
  try {
    // Step 1 — Get raw body and signature
    const body = await request.text();
    const sig = request.headers.get("stripe-signature");

    if (!sig) {
      return NextResponse.json(
        { error: "Missing stripe-signature header" },
        { status: 400 }
      );
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET environment variable is not set");
    }

    // Step 2 — Verify signature
    let event: Stripe.Event;
    try {
      event = constructEvent(body, sig, webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid signature";
      return NextResponse.json(
        { error: `Webhook signature verification failed: ${message}` },
        { status: 400 }
      );
    }

    // Step 3 — Idempotency check (prevents replay attacks)
    const supabase = createServerClient();

    const { data: existing } = await supabase
      .from("processed_webhook_events")
      .select("id")
      .eq("id", event.id)
      .maybeSingle();

    if (existing) {
      // Return 200, NOT 4xx/5xx — Stripe retries on 5xx causing infinite loops
      return NextResponse.json({ received: true });
    }

    // Insert BEFORE processing to prevent race conditions
    await supabase
      .from("processed_webhook_events")
      .upsert(
        { id: event.id, source: "stripe" },
        { onConflict: "id", ignoreDuplicates: true }
      );

    // Step 4 — Process event
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
