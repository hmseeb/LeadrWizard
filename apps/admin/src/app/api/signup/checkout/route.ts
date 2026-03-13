import { NextResponse } from "next/server";
import { createServerClient } from "@leadrwizard/shared/supabase";
import { createSignupCheckoutSession } from "@leadrwizard/shared/billing";

/**
 * Public checkout endpoint for new agency signup.
 * No authentication required -- the agency is a brand new visitor.
 *
 * POST /api/signup/checkout
 * Body: { planSlug: string, email: string, orgName: string }
 * Returns: { checkoutUrl: string }
 *
 * Local testing with Stripe CLI (SIGN-04):
 *   1. stripe listen --forward-to localhost:3000/api/webhooks/stripe
 *   2. Set STRIPE_WEBHOOK_SECRET in .env.local to the whsec_... from CLI output
 *   3. curl -X POST http://localhost:3000/api/signup/checkout \
 *        -H "Content-Type: application/json" \
 *        -d '{"planSlug":"starter","email":"test@example.com","orgName":"Test Agency"}'
 *   4. Or: stripe trigger checkout.session.completed
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { planSlug, email, orgName } = body as {
      planSlug: string;
      email: string;
      orgName: string;
    };

    if (!planSlug || !email || !orgName) {
      return NextResponse.json(
        { error: "Missing required fields: planSlug, email, orgName" },
        { status: 400 }
      );
    }

    // Basic email validation
    if (!email.includes("@") || !email.includes(".")) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const supabase = createServerClient();

    const { checkoutUrl } = await createSignupCheckoutSession(
      supabase,
      planSlug,
      email,
      orgName.trim(),
      `${appUrl}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
      `${appUrl}/signup?cancelled=true`
    );

    return NextResponse.json({ checkoutUrl });
  } catch (error) {
    console.error("Signup checkout error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Checkout creation failed" },
      { status: 500 }
    );
  }
}
