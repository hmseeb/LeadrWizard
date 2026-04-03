import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";
import { getUserOrg, getOrgCredentials } from "@leadrwizard/shared/tenant";
import { NextResponse } from "next/server";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

/**
 * GET /api/ghl/locations
 * Fetches all GHL subaccounts/locations under the agency.
 * Reads the Agency API key from the org's encrypted credentials in the database.
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

    // Get decrypted GHL credentials from the database
    const creds = await getOrgCredentials(serviceClient, orgData.org.id);

    if (!creds.ghl) {
      // Also check if the key exists but locationId was null (we made it optional)
      const { data: org } = await serviceClient
        .from("organizations")
        .select("ghl_api_key_encrypted, ghl_company_id")
        .eq("id", orgData.org.id)
        .single();

      if (!org || !(org as Record<string, string | null>).ghl_api_key_encrypted) {
        return NextResponse.json({ error: "GHL API key not configured" }, { status: 400 });
      }

      // Decrypt manually since getOrgCredentials requires locationId
      const { decrypt } = await import("@leadrwizard/shared/crypto");
      const row = org as Record<string, string | null>;
      const apiKey = decrypt(row.ghl_api_key_encrypted!);
      const companyId = row.ghl_company_id;

      return await fetchLocations(apiKey, companyId);
    }

    return await fetchLocations(creds.ghl.apiKey, creds.ghl.companyId);
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
