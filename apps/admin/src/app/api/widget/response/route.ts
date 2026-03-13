import { NextResponse } from "next/server";
import { createServerClient } from "@leadrwizard/shared/supabase";

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
  try {
    const body = await request.json();
    const { sessionId, fieldKey, fieldValue, clientServiceId, answeredVia, clientId } = body;

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

    return NextResponse.json({ ok: true }, { headers: corsHeaders });
  } catch (error) {
    console.error("Widget response error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
