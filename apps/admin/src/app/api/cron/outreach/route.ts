import { NextResponse } from "next/server";
import { createServerClient } from "@leadrwizard/shared/supabase";
import { processOutreachQueue } from "@leadrwizard/shared/comms";

/**
 * Cron endpoint to process the outreach queue.
 * Should be called every 1-5 minutes via Vercel Cron, Supabase pg_cron,
 * or an external cron service.
 *
 * Security: Validates CRON_SECRET header to prevent unauthorized access.
 */
export async function GET(request: Request) {
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
    console.error("Outreach cron error:", error);
    return NextResponse.json(
      { error: "Processing failed" },
      { status: 500 }
    );
  }
}
