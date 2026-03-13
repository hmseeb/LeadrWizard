"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

interface DashboardCounts {
  activeSessionCount: number;
  completedSessionCount: number;
  totalClientCount: number;
  openEscalationCount: number;
  pendingOutreachCount: number;
  deliveredServiceCount: number;
  avgCompletion: number;
  todayInteractionsCount: number;
}

interface RecentEscalation {
  id: string;
  reason: string;
  status: string;
  created_at: string;
  assigned_to: string | null;
  client: { name: string; business_name: string | null } | null;
}

interface Props {
  initialCounts: DashboardCounts;
  initialRecentEscalations: RecentEscalation[];
  orgId: string;
  children: React.ReactNode;
}

export function RealtimeDashboard({
  initialCounts,
  initialRecentEscalations,
  orgId,
  children,
}: Props) {
  const [counts, setCounts] = useState(initialCounts);
  const [recentEscalations, setRecentEscalations] = useState(initialRecentEscalations);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const refetchLiveData = useCallback(async () => {
    const [
      { count: active },
      { count: completed },
      { count: clients },
      { count: openEsc },
      { count: pendingOut },
      { count: delivered },
      { data: recentEsc },
    ] = await Promise.all([
      supabase
        .from("onboarding_sessions")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "active"),
      supabase
        .from("onboarding_sessions")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "completed"),
      supabase
        .from("clients")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId),
      supabase
        .from("escalations")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "open"),
      supabase
        .from("outreach_queue")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("client_services")
        .select("*", { count: "exact", head: true })
        .eq("status", "delivered"),
      supabase
        .from("escalations")
        .select("*, client:clients(name, business_name)")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    // Refetch avg completion from active sessions
    const { data: activeSessions } = await supabase
      .from("onboarding_sessions")
      .select("completion_pct")
      .eq("org_id", orgId)
      .eq("status", "active");

    const avgCompletion = activeSessions?.length
      ? Math.round(
          activeSessions.reduce((sum, s) => sum + (s.completion_pct || 0), 0) /
            activeSessions.length
        )
      : 0;

    setCounts((prev) => ({
      ...prev,
      activeSessionCount: active ?? 0,
      completedSessionCount: completed ?? 0,
      totalClientCount: clients ?? 0,
      openEscalationCount: openEsc ?? 0,
      pendingOutreachCount: pendingOut ?? 0,
      deliveredServiceCount: delivered ?? 0,
      avgCompletion,
    }));

    if (recentEsc) {
      setRecentEscalations(recentEsc as RecentEscalation[]);
    }
  }, [supabase, orgId]);

  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel("dashboard-kpi")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "onboarding_sessions",
          filter: `org_id=eq.${orgId}`,
        },
        () => {
          refetchLiveData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "escalations",
          filter: `org_id=eq.${orgId}`,
        },
        () => {
          refetchLiveData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, orgId, refetchLiveData]);

  return (
    <>
      {/* Primary KPI Cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard
          label="Active Onboardings"
          value={counts.activeSessionCount}
          color="green"
        />
        <KPICard
          label="Completed"
          value={counts.completedSessionCount}
          color="brand"
        />
        <KPICard
          label="Total Clients"
          value={counts.totalClientCount}
          color="blue"
        />
        <KPICard
          label="Open Escalations"
          value={counts.openEscalationCount}
          color={counts.openEscalationCount > 0 ? "red" : "gray"}
        />
      </div>

      {/* Secondary metrics */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard
          label="Avg Completion"
          value={`${counts.avgCompletion}%`}
          color="brand"
          small
        />
        <KPICard
          label="Pending Outreach"
          value={counts.pendingOutreachCount}
          color="yellow"
          small
        />
        <KPICard
          label="Services Delivered"
          value={counts.deliveredServiceCount}
          color="green"
          small
        />
        <KPICard
          label="Today's Interactions"
          value={counts.todayInteractionsCount}
          color="blue"
          small
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Recent Escalations - live updated */}
        <div className="rounded-lg border bg-white p-6">
          <h2 className="text-lg font-semibold">Recent Escalations</h2>
          <div className="mt-4 space-y-3">
            {recentEscalations.length > 0 ? (
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

        {/* Static sections passed as children */}
        {children}
      </div>
    </>
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
