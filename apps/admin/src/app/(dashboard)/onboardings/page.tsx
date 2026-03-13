import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { RealtimeSessions } from "./realtime-sessions";

export default async function OnboardingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const orgData = user ? await getUserOrg(supabase, user.id) : null;

  const { data: sessions } = await supabase
    .from("onboarding_sessions")
    .select(
      `
      *,
      client:clients(name, email, business_name, phone)
    `
    )
    .eq("org_id", orgData?.org.id ?? "")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <RealtimeSessions
      initialSessions={sessions ?? []}
      orgId={orgData?.org.id ?? ""}
    />
  );
}
