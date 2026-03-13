import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createCheckoutSession } from "@leadrwizard/shared/billing";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { createRouteLogger } from "@leadrwizard/shared/utils";

/**
 * Creates a Stripe Checkout session for a plan upgrade.
 */
export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") || crypto.randomUUID();
  const log = createRouteLogger("billing/checkout", { correlation_id: correlationId });

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { planSlug } = (await request.json()) as { planSlug: string };

    const orgData = await getUserOrg(supabase, user.id);
    if (!orgData) {
      return NextResponse.json({ error: "No organization found" }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_WIDGET_URL?.replace("/onboard", "") || "";
    const { checkoutUrl } = await createCheckoutSession(
      supabase,
      orgData.org.id,
      planSlug,
      `${baseUrl}/billing?success=true`,
      `${baseUrl}/billing?cancelled=true`
    );

    return NextResponse.json({ url: checkoutUrl });
  } catch (error) {
    log.error({ err: error }, "Checkout error");
    Sentry.withScope((scope) => {
      scope.setTag("correlation_id", correlationId);
      Sentry.captureException(error);
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Checkout failed" },
      { status: 500 }
    );
  }
}
