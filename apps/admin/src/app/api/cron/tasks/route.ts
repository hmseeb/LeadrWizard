import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServerClient } from "@leadrwizard/shared/supabase";
import { processServiceTasks } from "@leadrwizard/shared/automations";
import { createRouteLogger } from "@leadrwizard/shared/utils";

/**
 * Cron endpoint for processing async service tasks.
 * Polls A2P registration status, GMB access approval, website approvals, etc.
 *
 * Recommended schedule: every 15 minutes
 * Configure via pg_cron or external scheduler:
 *   POST https://your-domain.com/api/cron/tasks
 *   Header: Authorization: Bearer <CRON_SECRET>
 */
export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") || crypto.randomUUID();
  const log = createRouteLogger("cron/tasks", { correlation_id: correlationId });

  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    const result = await processServiceTasks(supabase);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    log.error({ err: error }, "Service task processing error");
    Sentry.withScope((scope) => {
      scope.setTag("correlation_id", correlationId);
      Sentry.captureException(error);
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
