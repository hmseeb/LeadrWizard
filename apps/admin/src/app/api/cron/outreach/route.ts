import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServerClient } from "@leadrwizard/shared/supabase";
import { processOutreachQueue } from "@leadrwizard/shared/comms";
import { createRouteLogger } from "@leadrwizard/shared/utils";

/**
 * Cron endpoint to process the outreach queue.
 * Should be called every 1-5 minutes via Vercel Cron, Supabase pg_cron,
 * or an external cron service.
 *
 * Security: Validates CRON_SECRET header to prevent unauthorized access.
 */
export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") || crypto.randomUUID();
  const log = createRouteLogger("cron/outreach", { correlation_id: correlationId });

  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    const result = await processOutreachQueue(supabase);

    return NextResponse.json({
      ok: true,
      processed: result.processed,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error({ err: error }, "Outreach cron error");
    Sentry.withScope((scope) => {
      scope.setTag("correlation_id", correlationId);
      Sentry.captureException(error);
    });
    return NextResponse.json(
      { error: "Processing failed" },
      { status: 500 }
    );
  }
}
