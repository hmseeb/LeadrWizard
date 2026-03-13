"use client";

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

export function RealtimeSessions({ initialSessions, orgId }: Props) {
  const sessions = useRealtimeTable<Session>({
    table: "onboarding_sessions",
    orgId,
    initialData: initialSessions,
    channelName: "sessions-realtime",
  });

  const activeCount = sessions.filter((s) => s.status === "active").length;
  const completedCount = sessions.filter((s) => s.status === "completed").length;
  const pausedCount = sessions.filter((s) => s.status === "paused").length;

  return (
    <div>
      <h1 className="text-2xl font-bold">Active Onboardings</h1>
      <p className="mt-1 text-gray-500">
        Real-time status of all client onboarding sessions
      </p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-500">Active</p>
          <p className="mt-1 text-3xl font-bold text-green-600">
            {activeCount}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-500">Paused / Waiting</p>
          <p className="mt-1 text-3xl font-bold text-yellow-600">
            {pausedCount}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-500">Completed</p>
          <p className="mt-1 text-3xl font-bold text-brand-600">
            {completedCount}
          </p>
        </div>
      </div>

      <div className="mt-8">
        <table className="w-full">
          <thead>
            <tr className="border-b text-left text-sm text-gray-500">
              <th className="pb-3 font-medium">Client</th>
              <th className="pb-3 font-medium">Business</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Progress</th>
              <th className="pb-3 font-medium">Channel</th>
              <th className="pb-3 font-medium">Last Activity</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sessions.map((session) => (
              <tr key={session.id} className="text-sm">
                <td className="py-3">
                  <div className="font-medium">
                    {(session.client as Record<string, string>)?.name ?? "Unknown"}
                  </div>
                  <div className="text-gray-500">
                    {(session.client as Record<string, string>)?.email}
                  </div>
                </td>
                <td className="py-3">
                  {(session.client as Record<string, string>)?.business_name || "\u2014"}
                </td>
                <td className="py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      session.status === "active"
                        ? "bg-green-100 text-green-700"
                        : session.status === "completed"
                          ? "bg-brand-100 text-brand-700"
                          : session.status === "paused"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {session.status}
                  </span>
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 rounded-full bg-gray-200">
                      <div
                        className="h-2 rounded-full bg-brand-500"
                        style={{
                          width: `${session.completion_pct}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">
                      {session.completion_pct}%
                    </span>
                  </div>
                </td>
                <td className="py-3 text-gray-500">
                  {session.current_channel || "\u2014"}
                </td>
                <td className="py-3 text-gray-500">
                  {session.last_interaction_at
                    ? new Date(session.last_interaction_at).toLocaleString()
                    : "\u2014"}
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400">
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
