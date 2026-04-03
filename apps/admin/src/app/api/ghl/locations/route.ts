import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { NextResponse } from "next/server";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

/**
 * GET /api/ghl/locations
 * Fetches all GHL subaccounts/locations under the agency.
 * Requires the agency GHL API key (from env or org credentials).
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

    const apiKey = process.env.GHL_API_KEY;
    const companyId = process.env.GHL_COMPANY_ID;

    if (!apiKey) {
      return NextResponse.json({ error: "GHL API key not configured" }, { status: 500 });
    }

    // Fetch locations from GHL
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

    // Return simplified list
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
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch locations" },
      { status: 500 }
    );
  }
}
