import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServerClient } from "@leadrwizard/shared/supabase";
import type {
  ServiceDefinition,
  DataFieldDefinition,
} from "@leadrwizard/shared/types";
import {
  createRouteLogger,
  filterCurrentlyRequiredFields,
} from "@leadrwizard/shared/utils";

/**
 * Backfill endpoint for `onboarding_sessions.completion_pct` / `status`.
 *
 * Exists because a bug in widget/response omitted `field_value` from the
 * progress-recompute query, which made `required_if: equals_empty` clauses
 * always fire — conditional fields (e.g. website-build's tagline) were
 * treated as required even when the gate field was filled in. That inflated
 * totalRequired, so sessions got stuck below 100% and never flipped to
 * `completed`. The widget GET endpoint computed it correctly live, so
 * clients saw "You're all set!" while the admin dashboard showed e.g. 69%.
 *
 * POST with {} to recompute all sessions in state `active` or `completed`.
 * POST with { sessionId } to recompute a single session.
 *
 * Auth: Bearer CRON_SECRET (same as other admin-only endpoints).
 */
export async function POST(request: Request) {
  const correlationId =
    request.headers.get("x-correlation-id") || crypto.randomUUID();
  const log = createRouteLogger("admin/recompute-session-progress", {
    correlation_id: correlationId,
  });

  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
    };
    const supabase = createServerClient();

    let query = supabase
      .from("onboarding_sessions")
      .select("id, client_id, status, completion_pct")
      .in("status", ["active", "completed"]);
    if (body.sessionId) query = query.eq("id", body.sessionId);

    const { data: sessions, error: sessionsError } = await query;
    if (sessionsError) throw sessionsError;

    const updated: Array<{
      session_id: string;
      from_pct: number;
      to_pct: number;
      from_status: string;
      to_status: string;
    }> = [];

    for (const session of sessions || []) {
      const { data: clientServices } = await supabase
        .from("client_services")
        .select(
          "id, service:service_definitions(required_data_fields)"
        )
        .eq("client_id", session.client_id)
        .eq("opted_out", false);

      const { data: responses } = await supabase
        .from("session_responses")
        .select("field_key, field_value, client_service_id")
        .eq("session_id", session.id);

      let totalRequired = 0;
      let totalAnswered = 0;

      for (const cs of clientServices || []) {
        const row = cs as Record<string, unknown>;
        const definition = row.service as ServiceDefinition | null;
        const serviceResponses = (responses || []).filter(
          (r: {
            field_key: string;
            field_value: string;
            client_service_id: string | null;
          }) => r.client_service_id === cs.id
        );
        const answersByKey: Record<string, string> = {};
        for (const r of serviceResponses) {
          answersByKey[r.field_key] = r.field_value;
        }
        const requiredFields = filterCurrentlyRequiredFields(
          definition?.required_data_fields || [],
          answersByKey
        );
        totalRequired += requiredFields.length;
        const answeredKeys = new Set(
          serviceResponses.map((r) => r.field_key)
        );
        totalAnswered += requiredFields.filter((f: DataFieldDefinition) =>
          answeredKeys.has(f.key)
        ).length;
      }

      const newPct =
        totalRequired > 0
          ? Math.round((totalAnswered / totalRequired) * 100)
          : 100;
      const newStatus =
        totalRequired > 0 && totalAnswered >= totalRequired
          ? "completed"
          : session.status === "completed"
            ? "completed"
            : session.status;

      if (
        newPct !== session.completion_pct ||
        newStatus !== session.status
      ) {
        const { error: updateError } = await supabase
          .from("onboarding_sessions")
          .update({ completion_pct: newPct, status: newStatus })
          .eq("id", session.id);
        if (updateError) {
          log.error(
            { err: updateError, session_id: session.id },
            "Failed to update session"
          );
          continue;
        }
        updated.push({
          session_id: session.id as string,
          from_pct: session.completion_pct as number,
          to_pct: newPct,
          from_status: session.status as string,
          to_status: newStatus as string,
        });
      }
    }

    log.info(
      { scanned: sessions?.length || 0, updated: updated.length },
      "Recompute complete"
    );
    return NextResponse.json({
      ok: true,
      scanned: sessions?.length || 0,
      updated,
    });
  } catch (error) {
    log.error({ err: error }, "Recompute failed");
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
