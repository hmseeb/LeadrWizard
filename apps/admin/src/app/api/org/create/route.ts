import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createOrganization } from "@leadrwizard/shared/tenant";
import { createRouteLogger } from "@leadrwizard/shared/utils";

/**
 * Creates a new organization for the authenticated user.
 */
export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") || crypto.randomUUID();
  const log = createRouteLogger("org/create", { correlation_id: correlationId });

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user already has an org
    const { data: existingMembership } = await supabase
      .from("org_members")
      .select("org_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (existingMembership) {
      return NextResponse.json(
        { error: "You already belong to an organization" },
        { status: 400 }
      );
    }

    const { name } = (await request.json()) as { name: string };

    if (!name || name.trim().length < 2) {
      return NextResponse.json(
        { error: "Organization name must be at least 2 characters" },
        { status: 400 }
      );
    }

    const result = await createOrganization(supabase, {
      name: name.trim(),
      ownerUserId: user.id,
      ownerEmail: user.email || "",
    });

    return NextResponse.json({
      org: result.org,
      membership: result.membership,
    });
  } catch (error) {
    log.error({ err: error }, "Org creation error");
    Sentry.withScope((scope) => {
      scope.setTag("correlation_id", correlationId);
      Sentry.captureException(error);
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create org" },
      { status: 500 }
    );
  }
}
