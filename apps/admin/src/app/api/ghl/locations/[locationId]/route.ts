import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";
import { getUserOrg, getOrgCredentials } from "@leadrwizard/shared/tenant";
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
 * Mirrors /api/ghl/locations/route.ts exactly for credential resolution so
 * the same "GHL API key configured and decryptable" invariant holds in both
 * places. Each failure mode returns a distinct error message so the UI shows
 * actionable feedback instead of generic crypto errors.
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

    // --- Resolve GHL API key (matches /api/ghl/locations/route.ts pattern) ---
    let apiKey: string;
    try {
      const creds = await getOrgCredentials(serviceClient, orgData.org.id);
      if (creds.ghl) {
        apiKey = creds.ghl.apiKey;
      } else {
        // Fallback: decrypt the key manually when getOrgCredentials skipped
        // populating creds.ghl because ghl_location_id was not set.
        const { data: org } = await serviceClient
          .from("organizations")
          .select("ghl_api_key_encrypted")
          .eq("id", orgData.org.id)
          .single();

        const row = org as Record<string, string | null> | null;
        if (!row?.ghl_api_key_encrypted) {
          return NextResponse.json(
            {
              error:
                "GHL API key is not configured. Add it under Settings → Integrations → GHL.",
            },
            { status: 400 }
          );
        }

        const { decrypt } = await import("@leadrwizard/shared/crypto");
        apiKey = decrypt(row.ghl_api_key_encrypted);
      }
    } catch (credErr) {
      const message = credErr instanceof Error ? credErr.message : String(credErr);
      // Bubble up decrypt / env failures with a hint instead of a raw
      // "Invalid key length" message the user can't act on.
      return NextResponse.json(
        {
          error: `Failed to read GHL API key: ${message}. If you recently rotated the ENCRYPTION_KEY env var, re-save the GHL credentials in Settings to re-encrypt them.`,
        },
        { status: 500 }
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
