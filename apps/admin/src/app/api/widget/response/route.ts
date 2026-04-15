import { NextResponse, after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServerClient } from "@leadrwizard/shared/supabase";
import type {
  ServiceDefinition,
  SessionResponse,
  DataFieldDefinition,
} from "@leadrwizard/shared/types";
import { createRouteLogger } from "@leadrwizard/shared/utils";
import { maybeTriggerA2POnCompletion } from "@leadrwizard/shared/automations";
import { triggerDefaultWebsiteBuild } from "@/lib/website-build-trigger";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") || crypto.randomUUID();
  let log = createRouteLogger("widget/response", { correlation_id: correlationId });
  let orgId: string | undefined;
  let sessionId: string | undefined;

  try {
    const body = await request.json();
    ({ sessionId } = body);
    const { fieldKey, fieldValue, clientServiceId, answeredVia, clientId } = body;

    if (!sessionId || !fieldKey || fieldValue === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: sessionId, fieldKey, fieldValue" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Service role client — bypasses RLS so we can insert after anon policies are removed
    const supabase = createServerClient();

    // Validate session exists and is active — server-side org resolution
    const { data: session } = await supabase
      .from("onboarding_sessions")
      .select("id, org_id, client_id, status")
      .eq("id", sessionId)
      .eq("status", "active")
      .maybeSingle();

    if (!session) {
      return NextResponse.json(
        { error: "Session not found or not active" },
        { status: 404, headers: corsHeaders }
      );
    }

    orgId = session.org_id as string;
    // Enrich logger with resolved context
    log = log.child({ org_id: orgId, session_id: sessionId });

    // Insert response — org_id resolved server-side, never trusted from client body
    const { error: insertError } = await supabase.from("session_responses").insert({
      session_id: sessionId,
      client_service_id: clientServiceId || null,
      field_key: fieldKey,
      field_value: String(fieldValue),
      answered_via: answeredVia || "click",
    });

    if (insertError) {
      throw new Error(`Failed to insert response: ${insertError.message}`);
    }

    // Log interaction server-side (replaces anon interaction_log insert in widget)
    const resolvedClientId = clientId || session.client_id;
    if (resolvedClientId) {
      await supabase.from("interaction_log").insert({
        client_id: resolvedClientId,
        session_id: sessionId,
        channel: "widget",
        direction: "inbound",
        content_type: "text",
        content: `${fieldKey}: ${String(fieldValue)}`,
        metadata: { answered_via: answeredVia || "click" },
      });
    }

    // --- Auto-completion check ---
    // After inserting the response, check if all required fields are now collected.
    // If so, mark the session as completed with 100% progress.
    // Also transition any service whose required fields are now all answered
    // from 'pending_onboarding' → 'ready_to_deliver' so the agency worklist
    // reflects "data collected, ready for delivery/automation".
    const { data: clientServices } = await supabase
      .from("client_services")
      .select(
        "id, service_id, status, service:service_definitions(slug, required_data_fields)"
      )
      .eq("client_id", session.client_id)
      .eq("opted_out", false);

    const { data: allResponses } = await supabase
      .from("session_responses")
      .select("field_key, client_service_id")
      .eq("session_id", sessionId);

    // Calculate if all required fields are answered
    let totalRequired = 0;
    let totalAnswered = 0;
    const readyServiceIds: string[] = [];
    // Services that just transitioned AND are the website-build service —
    // these are the ones we fire the auto-trigger on.
    const websiteBuildServiceIds: string[] = [];

    for (const cs of clientServices || []) {
      const row = cs as Record<string, unknown>;
      const definition = row.service as
        | (ServiceDefinition & { slug?: string })
        | null;
      const requiredFields = (definition?.required_data_fields || []).filter(
        (f: DataFieldDefinition) => f.required
      );
      totalRequired += requiredFields.length;

      const answeredKeys = new Set(
        (allResponses || [])
          .filter((r: { field_key: string; client_service_id: string | null }) => r.client_service_id === cs.id)
          .map((r: { field_key: string; client_service_id: string | null }) => r.field_key)
      );

      const answeredCount = requiredFields.filter((f: DataFieldDefinition) =>
        answeredKeys.has(f.key)
      ).length;
      totalAnswered += answeredCount;

      // Service has collected all required fields AND is still sitting in
      // pending_onboarding — promote it. We only advance from pending_onboarding
      // so we never clobber a later state (in_progress, delivered) that some
      // other automation (A2P manager, etc.) has already moved it to.
      const currentStatus = row.status as string | null;
      if (
        requiredFields.length > 0 &&
        answeredCount >= requiredFields.length &&
        currentStatus === "pending_onboarding"
      ) {
        readyServiceIds.push(cs.id as string);
        if (definition?.slug === "website-build") {
          websiteBuildServiceIds.push(cs.id as string);
        }
      }
    }

    if (readyServiceIds.length > 0) {
      await supabase
        .from("client_services")
        .update({
          status: "ready_to_deliver",
          updated_at: new Date().toISOString(),
        })
        .in("id", readyServiceIds);
    }

    // --- Auto-trigger website build(s) ---
    // For any website-build service that just crossed into ready_to_deliver,
    // fire the org's default builder (AI or Goose Kit). We use Next.js 15's
    // `after()` so this runs after the HTTP response is sent — the AI builder
    // is slow (Claude + Vercel deploy) and we don't want the widget to sit
    // waiting on it. Failures are logged but intentionally don't block the
    // response; the service is already at ready_to_deliver, so Greg can
    // retry manually from the client detail page if the auto-trigger fails.
    if (
      websiteBuildServiceIds.length > 0 &&
      session.client_id &&
      orgId
    ) {
      const capturedClientId = session.client_id as string;
      const capturedOrgId = orgId;
      const serviceIdsToFire = [...websiteBuildServiceIds];
      after(async () => {
        for (const serviceId of serviceIdsToFire) {
          try {
            const result = await triggerDefaultWebsiteBuild(
              supabase,
              capturedOrgId,
              capturedClientId,
              serviceId,
              { source: "auto_trigger_on_onboarding_submit" }
            );
            if (!result.ok) {
              log.warn(
                {
                  client_service_id: serviceId,
                  builder: result.builder,
                  error: result.error,
                },
                "Auto-trigger website build failed — service left at ready_to_deliver for manual retry"
              );
            } else {
              log.info(
                {
                  client_service_id: serviceId,
                  builder: result.builder,
                },
                "Auto-trigger website build kicked off"
              );
            }
          } catch (err) {
            log.error(
              { err, client_service_id: serviceId },
              "Auto-trigger website build threw"
            );
            Sentry.captureException(err, {
              tags: {
                correlation_id: correlationId,
                org_id: capturedOrgId,
                auto_trigger: "website_build",
              },
              extra: { client_service_id: serviceId },
            });
          }
        }
      });
    }

    const completionPct =
      totalRequired > 0
        ? Math.round((totalAnswered / totalRequired) * 100)
        : 100;

    // Update session completion_pct on every submission. We intentionally do
    // NOT flip onboarding_sessions.status to 'completed' here — that used to
    // happen when totalAnswered >= totalRequired, which was too early for
    // packages containing A2P (Twilio brand + campaign approval takes 1-7
    // days). The task-processor cron (checkForCompletedSessions) is the only
    // place that closes sessions, and it does so when every non-opted-out
    // client_service reaches `delivered`.
    await supabase
      .from("onboarding_sessions")
      .update({
        completion_pct: completionPct,
        last_interaction_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    // --- A2P trigger on onboarding completion ---
    // If the client has now answered every required field for every service,
    // fire the A2P registration to Twilio. The helper is idempotent (gates on
    // `client_services.status === 'pending_onboarding'`) so repeat calls from
    // rapid submissions are safe. A2P Twilio failures are logged via Sentry
    // but must not fail the widget response — the client has already seen
    // their "all done" screen and there's nothing they can do about it.
    const onboardingComplete = totalRequired > 0 && totalAnswered >= totalRequired;
    if (onboardingComplete) {
      try {
        const triggerResult = await maybeTriggerA2POnCompletion(
          supabase,
          sessionId
        );
        if (triggerResult.triggered) {
          log.info(
            { task_id: triggerResult.taskId },
            "A2P registration submitted after onboarding completion"
          );
        } else if (
          triggerResult.reason !== "no_a2p" &&
          triggerResult.reason !== "already_triggered"
        ) {
          // "no_a2p" and "already_triggered" are expected steady-state
          // outcomes. Anything else is worth logging.
          log.warn(
            { reason: triggerResult.reason },
            "A2P trigger did not fire after onboarding completion"
          );
        }
      } catch (err) {
        log.error(
          { err: err instanceof Error ? err : new Error(String(err)) },
          "Failed to fire A2P registration after onboarding completion"
        );
        Sentry.captureException(err, {
          tags: {
            correlation_id: correlationId,
            org_id: orgId,
            auto_trigger: "a2p_registration",
          },
          extra: { session_id: sessionId },
        });
      }
    }

    return NextResponse.json(
      { ok: true, completionPct, completed: false },
      { headers: corsHeaders }
    );
  } catch (error) {
    log.error({ err: error }, "Widget response error");
    Sentry.withScope((scope) => {
      scope.setTag("correlation_id", correlationId);
      if (orgId) scope.setTag("org_id", orgId);
      if (sessionId) scope.setTag("session_id", sessionId);
      Sentry.captureException(error);
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
