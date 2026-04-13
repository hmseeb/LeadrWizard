"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useRealtimeTable } from "@/hooks/use-realtime-table";

interface Session {
  id: string;
  client_id: string;
  org_id: string;
  status: string;
  current_channel: string | null;
  completion_pct: number;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
  client: {
    name: string;
    email: string;
    business_name: string | null;
    phone: string | null;
  } | null;
}

interface Props {
  initialSessions: Session[];
  orgId: string;
}

function buildOnboardingUrl(sessionId: string): string {
  const configured = process.env.NEXT_PUBLIC_WIDGET_URL;
  if (configured) {
    // Env var points at the hosted /onboard page (e.g. https://app.leadrwizard.com/onboard)
    return `${configured}?session=${sessionId}`;
  }
  if (typeof window !== "undefined") {
    return `${window.location.origin}/onboard?session=${sessionId}`;
  }
  return `/onboard?session=${sessionId}`;
}

export function RealtimeSessions({ initialSessions, orgId }: Props) {
  const sessions = useRealtimeTable<Session>({
    table: "onboarding_sessions",
    orgId,
    initialData: initialSessions,
    channelName: "sessions-realtime",
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function handleCopy(sessionId: string) {
    const url = buildOnboardingUrl(sessionId);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(sessionId);
      setTimeout(() => setCopiedId((prev) => (prev === sessionId ? null : prev)), 1500);
    } catch {
      window.prompt("Copy this onboarding link:", url);
    }
  }

  const activeCount = sessions.filter((s) => s.status === "active").length;
  const completedCount = sessions.filter((s) => s.status === "completed").length;
  const pausedCount = sessions.filter((s) => s.status === "paused").length;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">Active Onboardings</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Real-time status of all client onboarding sessions
      </p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-zinc-800 border-l-2 border-l-emerald-500 bg-surface p-5">
          <p className="text-sm text-zinc-400">Active</p>
          <p className="mt-1 text-3xl font-bold text-emerald-400">
            {activeCount}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 border-l-2 border-l-amber-500 bg-surface p-5">
          <p className="text-sm text-zinc-400">Paused / Waiting</p>
          <p className="mt-1 text-3xl font-bold text-amber-400">
            {pausedCount}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 border-l-2 border-l-brand-500 bg-surface p-5">
          <p className="text-sm text-zinc-400">Completed</p>
          <p className="mt-1 text-3xl font-bold text-brand-400">
            {completedCount}
          </p>
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-zinc-800 bg-surface overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800/60">
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Client</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Business</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Status</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Progress</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Channel</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Last Activity</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Link</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {sessions.map((session) => (
              <tr key={session.id}>
                <td className="px-5 py-3.5 text-sm">
                  <div className="font-medium text-zinc-50">
                    {(session.client as Record<string, string>)?.name ?? "Unknown"}
                  </div>
                  <div className="text-zinc-500">
                    {(session.client as Record<string, string>)?.email}
                  </div>
                </td>
                <td className="px-5 py-3.5 text-sm text-zinc-300">
                  {(session.client as Record<string, string>)?.business_name || "\u2014"}
                </td>
                <td className="px-5 py-3.5 text-sm">
                  <span
                    className={
                      session.status === "active"
                        ? "badge-success"
                        : session.status === "completed"
                          ? "badge-brand"
                          : session.status === "paused"
                            ? "badge-warning"
                            : "badge-neutral"
                    }
                  >
                    {session.status}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 rounded-full bg-zinc-800">
                      <div
                        className="h-1.5 rounded-full bg-brand-500"
                        style={{
                          width: `${session.completion_pct}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-zinc-500">
                      {session.completion_pct}%
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-sm text-zinc-400">
                  {session.current_channel || "\u2014"}
                </td>
                <td className="px-5 py-3.5 text-sm text-zinc-500">
                  {session.last_interaction_at
                    ? new Date(session.last_interaction_at).toLocaleString()
                    : "\u2014"}
                </td>
                <td className="px-5 py-3.5 text-sm">
                  <button
                    type="button"
                    onClick={() => handleCopy(session.id)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:border-brand-500/50 hover:text-brand-400"
                    title="Copy onboarding link"
                  >
                    {copiedId === session.id ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy link
                      </>
                    )}
                  </button>
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-zinc-500">
                  No onboarding sessions yet. They will appear here once clients
                  start paying.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
