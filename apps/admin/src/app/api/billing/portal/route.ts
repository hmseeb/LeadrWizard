import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createBillingPortalSession } from "@leadrwizard/shared/billing";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { createRouteLogger } from "@leadrwizard/shared/utils";

/**
 * Creates a Stripe Billing Portal session for managing subscriptions.
 */
export async function POST() {
  const correlationId = crypto.randomUUID();
  const log = createRouteLogger("billing/portal", { correlation_id: correlationId });

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orgData = await getUserOrg(supabase, user.id);
    if (!orgData) {
      return NextResponse.json({ error: "No organization found" }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_WIDGET_URL?.replace("/onboard", "") || "";
    const portalUrl = await createBillingPortalSession(
      supabase,
      orgData.org.id,
      `${baseUrl}/billing`
    );

    return NextResponse.json({ url: portalUrl });
  } catch (error) {
    log.error({ err: error }, "Portal error");
    Sentry.withScope((scope) => {
      scope.setTag("correlation_id", correlationId);
      Sentry.captureException(error);
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Portal creation failed" },
      { status: 500 }
    );
  }
}
