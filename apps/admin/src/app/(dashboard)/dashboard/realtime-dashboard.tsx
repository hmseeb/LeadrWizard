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
          color="sky"
        />
        <KPICard
          label="Open Escalations"
          value={counts.openEscalationCount}
          color={counts.openEscalationCount > 0 ? "rose" : "zinc"}
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
          color="amber"
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
          color="sky"
          small
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Recent Escalations - live updated */}
        <div className="rounded-xl border border-zinc-800 bg-surface p-5">
          <h2 className="font-display text-lg font-semibold text-zinc-50">Recent Escalations</h2>
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
                    className="flex items-start justify-between rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium text-zinc-100">
                        {esc.reason.substring(0, 60)}
                        {esc.reason.length > 60 ? "..." : ""}
                      </p>
                      <p className="mt-0.5 text-zinc-500">
                        {client?.name} — {client?.business_name || "N/A"}
                      </p>
                    </div>
                    <span
                      className={`ml-2 flex-shrink-0 ${
                        esc.status === "open"
                          ? "badge-danger"
                          : esc.status === "assigned"
                            ? "badge-warning"
                            : "badge-success"
                      }`}
                    >
                      {esc.status}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-zinc-500">
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
  const borderMap: Record<string, string> = {
    green: "border-l-emerald-500",
    brand: "border-l-brand-500",
    sky: "border-l-sky-500",
    rose: "border-l-rose-500",
    amber: "border-l-amber-500",
    zinc: "border-l-zinc-600",
  };

  return (
    <div className={`rounded-xl border border-zinc-800 bg-surface p-4 border-l-2 ${borderMap[color] || "border-l-zinc-600"}`}>
      <p className="text-sm text-zinc-400">{label}</p>
      <p
        className={`mt-1 font-bold text-zinc-50 ${
          small ? "text-xl" : "text-3xl"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
