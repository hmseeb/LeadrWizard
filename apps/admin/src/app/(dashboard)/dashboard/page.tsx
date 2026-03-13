import { createSupabaseServerClient } from "@/lib/supabase-server";
import { SetupWizard } from "./setup-wizard";
import { getUserOrg } from "@leadrwizard/shared/tenant";

interface AnalyticsSnapshot {
  snapshot_date: string;
  active_sessions: number;
  completed_sessions: number;
  abandoned_sessions: number;
  avg_completion_pct: number;
  total_interactions: number;
  sms_sent: number;
  voice_calls_made: number;
  emails_sent: number;
  escalations_opened: number;
  escalations_resolved: number;
  services_delivered: number;
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();

  // Detect org and empty state for setup wizard
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let showWizard = false;
  let orgName = "";
  let hasServices = false;
  let hasPackages = false;
  let hasIntegrations = false;

  if (user) {
    const orgData = await getUserOrg(supabase, user.id);
    if (orgData) {
      orgName = orgData.org.name;

      const [
        { count: svcCount },
        { count: pkgCount },
        { data: orgRecord },
      ] = await Promise.all([
        supabase
          .from("service_definitions")
          .select("*", { count: "exact", head: true })
          .eq("org_id", orgData.org.id)
          .eq("is_active", true),
        supabase
          .from("service_packages")
          .select("*", { count: "exact", head: true })
          .eq("org_id", orgData.org.id)
          .eq("is_active", true),
        supabase
          .from("organizations")
          .select("onboarding_completed, settings")
          .eq("id", orgData.org.id)
          .single(),
      ]);

      hasServices = (svcCount ?? 0) > 0;
      hasPackages = (pkgCount ?? 0) > 0;

      // Check if integrations are configured (GHL or Twilio keys present in settings)
      const settings = (orgRecord?.settings || {}) as Record<string, unknown>;
      hasIntegrations = !!(settings.twilio_account_sid || settings.ghl_api_key);

      // Show wizard if onboarding not marked complete AND missing any content
      showWizard =
        !orgRecord?.onboarding_completed &&
        (!hasServices || !hasPackages);
    }
  }

  // Live counts
  const [
    { count: activeSessionCount },
    { count: completedSessionCount },
    { count: totalClientCount },
    { count: openEscalationCount },
    { count: pendingOutreachCount },
    { count: deliveredServiceCount },
  ] = await Promise.all([
    supabase
      .from("onboarding_sessions")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("onboarding_sessions")
      .select("*", { count: "exact", head: true })
      .eq("status", "completed"),
    supabase
      .from("clients")
      .select("*", { count: "exact", head: true }),
    supabase
      .from("escalations")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
    supabase
      .from("outreach_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("client_services")
      .select("*", { count: "exact", head: true })
      .eq("status", "delivered"),
  ]);

  // Average completion for active sessions
  const { data: activeSessions } = await supabase
    .from("onboarding_sessions")
    .select("completion_pct")
    .eq("status", "active");

  const avgCompletion = activeSessions?.length
    ? Math.round(
        activeSessions.reduce((sum, s) => sum + (s.completion_pct || 0), 0) /
          activeSessions.length
      )
    : 0;

  // Recent analytics snapshots (last 14 days)
  const { data: snapshots } = await supabase
    .from("analytics_snapshots")
    .select("*")
    .order("snapshot_date", { ascending: false })
    .limit(14);

  const typedSnapshots = (snapshots || []) as AnalyticsSnapshot[];

  // Today's interaction counts by channel
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: todayInteractions } = await supabase
    .from("interaction_log")
    .select("channel, direction")
    .gte("created_at", todayStart.toISOString());

  const todayOutbound = (todayInteractions || []).filter(
    (i) => i.direction === "outbound"
  );
  const todaySMS = todayOutbound.filter((i) => i.channel === "sms").length;
  const todayVoice = todayOutbound.filter(
    (i) => i.channel === "voice_call"
  ).length;
  const todayEmail = todayOutbound.filter((i) => i.channel === "email").length;

  // Pending service tasks
  const { data: pendingTasks } = await supabase
    .from("service_tasks")
    .select("task_type, status")
    .in("status", ["pending", "in_progress", "waiting_external"]);

  const tasksByType: Record<string, number> = {};
  for (const task of pendingTasks || []) {
    tasksByType[task.task_type] = (tasksByType[task.task_type] || 0) + 1;
  }

  // Recent escalations
  const { data: recentEscalations } = await supabase
    .from("escalations")
    .select(
      `
      *,
      client:clients(name, business_name)
    `
    )
    .order("created_at", { ascending: false })
    .limit(5);

  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-1 text-gray-500">Overview of your onboarding operations</p>

      {showWizard && (
        <div className="mt-6">
          <SetupWizard
            hasServices={hasServices}
            hasPackages={hasPackages}
            hasIntegrations={hasIntegrations}
            orgName={orgName}
          />
        </div>
      )}

      {/* KPI Cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard
          label="Active Onboardings"
          value={activeSessionCount ?? 0}
          color="green"
        />
        <KPICard
          label="Completed"
          value={completedSessionCount ?? 0}
          color="brand"
        />
        <KPICard
          label="Total Clients"
          value={totalClientCount ?? 0}
          color="blue"
        />
        <KPICard
          label="Open Escalations"
          value={openEscalationCount ?? 0}
          color={openEscalationCount && openEscalationCount > 0 ? "red" : "gray"}
        />
      </div>

      {/* Secondary metrics */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard
          label="Avg Completion"
          value={`${avgCompletion}%`}
          color="brand"
          small
        />
        <KPICard
          label="Pending Outreach"
          value={pendingOutreachCount ?? 0}
          color="yellow"
          small
        />
        <KPICard
          label="Services Delivered"
          value={deliveredServiceCount ?? 0}
          color="green"
          small
        />
        <KPICard
          label="Today&apos;s Interactions"
          value={(todayInteractions || []).length}
          color="blue"
          small
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Today's Outreach */}
        <div className="rounded-lg border bg-white p-6">
          <h2 className="text-lg font-semibold">Today&apos;s Outreach</h2>
          <div className="mt-4 space-y-3">
            <ChannelBar label="SMS" count={todaySMS} color="bg-blue-500" max={Math.max(todaySMS, todayVoice, todayEmail, 1)} />
            <ChannelBar label="Voice Calls" count={todayVoice} color="bg-purple-500" max={Math.max(todaySMS, todayVoice, todayEmail, 1)} />
            <ChannelBar label="Email" count={todayEmail} color="bg-green-500" max={Math.max(todaySMS, todayVoice, todayEmail, 1)} />
          </div>
        </div>

        {/* Pending Service Tasks */}
        <div className="rounded-lg border bg-white p-6">
          <h2 className="text-lg font-semibold">Pending Service Tasks</h2>
          <div className="mt-4 space-y-3">
            {Object.entries(tasksByType).length > 0 ? (
              Object.entries(tasksByType).map(([type, count]) => (
                <div key={type} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">
                    {formatTaskType(type)}
                  </span>
                  <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-sm font-medium text-yellow-700">
                    {count}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-400">No pending tasks</p>
            )}
          </div>
        </div>

        {/* Recent Escalations */}
        <div className="rounded-lg border bg-white p-6">
          <h2 className="text-lg font-semibold">Recent Escalations</h2>
          <div className="mt-4 space-y-3">
            {recentEscalations?.length ? (
              recentEscalations.map((esc) => {
                const client = esc.client as {
                  name: string;
                  business_name: string | null;
                } | null;
                return (
                  <div
                    key={esc.id}
                    className="flex items-start justify-between text-sm"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {esc.reason.substring(0, 60)}
                        {esc.reason.length > 60 ? "..." : ""}
                      </p>
                      <p className="text-gray-500">
                        {client?.name} — {client?.business_name || "N/A"}
                      </p>
                    </div>
                    <span
                      className={`ml-2 flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        esc.status === "open"
                          ? "bg-red-100 text-red-700"
                          : esc.status === "assigned"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-green-100 text-green-700"
                      }`}
                    >
                      {esc.status}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-gray-400">
                No escalations. The bot is handling everything.
              </p>
            )}
          </div>
        </div>

        {/* Historical Trends */}
        <div className="rounded-lg border bg-white p-6">
          <h2 className="text-lg font-semibold">14-Day Trend</h2>
          <div className="mt-4">
            {typedSnapshots.length > 0 ? (
              <div className="space-y-2">
                <div className="grid grid-cols-5 gap-2 text-xs font-medium text-gray-500">
                  <span>Date</span>
                  <span>Completed</span>
                  <span>Interactions</span>
                  <span>Delivered</span>
                  <span>Escalations</span>
                </div>
                {typedSnapshots.slice(0, 7).map((snap) => (
                  <div
                    key={snap.snapshot_date}
                    className="grid grid-cols-5 gap-2 text-sm"
                  >
                    <span className="text-gray-500">
                      {new Date(snap.snapshot_date).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="font-medium text-green-600">
                      {snap.completed_sessions}
                    </span>
                    <span>{snap.total_interactions}</span>
                    <span className="text-brand-600">
                      {snap.services_delivered}
                    </span>
                    <span
                      className={
                        snap.escalations_opened > 0
                          ? "text-red-600"
                          : "text-gray-400"
                      }
                    >
                      {snap.escalations_opened}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                Analytics data will appear after the first daily snapshot runs.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({
  label,
  value,
  color,
  small,
}: {
  label: string;
  value: number | string;
  color: string;
  small?: boolean;
}) {
  const colorMap: Record<string, string> = {
    green: "text-green-600",
    brand: "text-brand-600",
    blue: "text-blue-600",
    red: "text-red-600",
    yellow: "text-yellow-600",
    gray: "text-gray-400",
  };

  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p
        className={`mt-1 font-bold ${colorMap[color] || "text-gray-900"} ${
          small ? "text-xl" : "text-3xl"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function ChannelBar({
  label,
  count,
  color,
  max,
}: {
  label: string;
  count: number;
  color: string;
  max: number;
}) {
  const width = max > 0 ? (count / max) * 100 : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium">{count}</span>
      </div>
      <div className="mt-1 h-2 w-full rounded-full bg-gray-100">
        <div
          className={`h-2 rounded-full ${color}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function formatTaskType(type: string): string {
  const labels: Record<string, string> = {
    a2p_registration: "A2P Registration",
    gmb_access_request: "GMB Access",
    website_generation: "Website Build",
    ghl_snapshot_deploy: "GHL Snapshot",
    ghl_sub_account_provision: "GHL Sub-Account",
  };
  return labels[type] || type;
}
