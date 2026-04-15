import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { resolveGhlCredentials } from "@/lib/ghl-credentials";
import { NextResponse } from "next/server";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

/**
 * GET /api/ghl/locations
 * Fetches all GHL subaccounts/locations under the agency.
 *
 * Credential resolution is delegated to `resolveGhlCredentials`, which
 * tolerates a stale/unreadable encrypted blob by falling back to the
 * `GHL_API_KEY` env var — so an ENCRYPTION_KEY rotation doesn't brick the
 * "Link GHL sub-account" flow.
 */
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createSupabaseServiceClient();
    const orgData = await getUserOrg(serviceClient, user.id);
    if (!orgData) {
      return NextResponse.json({ error: "No organization found" }, { status: 403 });
    }

    let apiKey: string;
    let companyId: string | null;
    try {
      const resolved = await resolveGhlCredentials(serviceClient, orgData.org.id);
      apiKey = resolved.apiKey;
      companyId = resolved.companyId;
    } catch (credErr) {
      return NextResponse.json(
        { error: credErr instanceof Error ? credErr.message : String(credErr) },
        { status: 400 }
      );
    }

    return await fetchLocations(apiKey, companyId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch locations" },
      { status: 500 }
    );
  }
}

async function fetchLocations(apiKey: string, companyId?: string | null) {
  const url = new URL(`${GHL_API_BASE}/locations/search`);
  if (companyId) {
    url.searchParams.set("companyId", companyId);
  }
  url.searchParams.set("limit", "100");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: "2021-07-28",
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    return NextResponse.json(
      { error: `GHL API error: ${errorBody}` },
      { status: response.status }
    );
  }

  const data = await response.json();
  const locations = (data.locations || []) as Array<{
    id: string;
    name: string;
    email?: string;
    phone?: string;
    city?: string;
    state?: string;
  }>;

  return NextResponse.json({
    locations: locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      email: loc.email || null,
      phone: loc.phone || null,
      city: loc.city || null,
      state: loc.state || null,
    })),
  });
}
