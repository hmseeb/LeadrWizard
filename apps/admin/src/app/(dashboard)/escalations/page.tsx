import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { RealtimeEscalations } from "./realtime-escalations";

export default async function EscalationsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const orgData = user ? await getUserOrg(supabase, user.id) : null;

  const { data: escalations } = await supabase
    .from("escalations")
    .select(
      `
      *,
      client:clients(name, email, business_name)
    `
    )
    .eq("org_id", orgData?.org.id ?? "")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <RealtimeEscalations
      initialEscalations={escalations ?? []}
      orgId={orgData?.org.id ?? ""}
    />
  );
}
