import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { resolveGhlCredentials } from "@/lib/ghl-credentials";
import { NextResponse } from "next/server";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

/**
 * GET /api/ghl/locations/[locationId]
 *
 * Fetches a single GHL subaccount (location) by its ID. Used by the client
 * detail page "Link GHL subaccount" flow: Greg manually creates a sub-account
 * in GHL (our plan doesn't allow API creation), pastes the location ID into
 * LeadrWizard, and this endpoint verifies it + returns the details to display.
 *
 * Credential resolution is delegated to `resolveGhlCredentials`, which
 * tolerates a stale/unreadable encrypted blob by falling back to the
 * `GHL_API_KEY` env var — the same pattern used elsewhere in the codebase.
 * That way an ENCRYPTION_KEY rotation doesn't brick this flow.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ locationId: string }> }
) {
  try {
    const { locationId } = await context.params;

    if (!locationId || locationId.trim().length === 0) {
      return NextResponse.json(
        { error: "locationId is required" },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createSupabaseServiceClient();
    const orgData = await getUserOrg(serviceClient, user.id);
    if (!orgData) {
      return NextResponse.json({ error: "No organization found" }, { status: 403 });
    }

    // --- Resolve GHL API key (tolerates stale encrypted blobs / key rotation). ---
    let apiKey: string;
    try {
      const resolved = await resolveGhlCredentials(serviceClient, orgData.org.id);
      apiKey = resolved.apiKey;
    } catch (credErr) {
      return NextResponse.json(
        {
          error: credErr instanceof Error ? credErr.message : String(credErr),
        },
        { status: 400 }
      );
    }

    // --- Fetch the location from GHL ---
    let response: Response;
    try {
      response = await fetch(`${GHL_API_BASE}/locations/${locationId}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: "2021-07-28",
        },
      });
    } catch (fetchErr) {
      return NextResponse.json(
        {
          error: `Could not reach GHL API: ${fetchErr instanceof Error ? fetchErr.message : "network error"}`,
        },
        { status: 502 }
      );
    }

    if (response.status === 401 || response.status === 403) {
      return NextResponse.json(
        {
          error:
            "GHL API rejected the agency key. Verify it under Settings → Integrations → GHL.",
        },
        { status: response.status }
      );
    }

    if (response.status === 404) {
      return NextResponse.json(
        {
          error:
            "Location not found. Double-check the ID in your GHL agency view.",
        },
        { status: 404 }
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      return NextResponse.json(
        { error: `GHL API error (${response.status}): ${errorBody}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const loc = (data.location || data) as {
      id: string;
      name?: string;
      email?: string;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
      country?: string;
      postalCode?: string;
      website?: string;
      timezone?: string;
    };

    return NextResponse.json({
      location: {
        id: loc.id,
        name: loc.name || null,
        email: loc.email || null,
        phone: loc.phone || null,
        address: loc.address || null,
        city: loc.city || null,
        state: loc.state || null,
        country: loc.country || null,
        postalCode: loc.postalCode || null,
        website: loc.website || null,
        timezone: loc.timezone || null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch location" },
      { status: 500 }
    );
  }
}
