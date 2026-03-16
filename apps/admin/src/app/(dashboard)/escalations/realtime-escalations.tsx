"use client";

import { useRealtimeTable } from "@/hooks/use-realtime-table";

interface EscalationRow {
  id: string;
  client_id: string;
  org_id: string;
  session_id: string | null;
  reason: string;
  context: Record<string, unknown>;
  channel: string;
  status: string;
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string;
  client: {
    name: string;
    email: string;
    business_name: string | null;
  } | null;
}

interface Props {
  initialEscalations: EscalationRow[];
  orgId: string;
}

export function RealtimeEscalations({ initialEscalations, orgId }: Props) {
  const escalations = useRealtimeTable<EscalationRow>({
    table: "escalations",
    orgId,
    initialData: initialEscalations,
    channelName: "escalations-realtime",
  });

  const openCount = escalations.filter((e) => e.status === "open").length;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">
        Escalations
        {openCount > 0 && (
          <span className="badge-danger ml-2 text-sm">
            {openCount} open
          </span>
        )}
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Cases where the bot needs human help
      </p>

      <div className="mt-6 space-y-3">
        {escalations.map((esc) => {
          const client = esc.client as {
            name: string;
            email: string;
            business_name: string | null;
          } | null;

          return (
            <div
              key={esc.id}
              className={`rounded-xl border border-zinc-800 bg-surface p-5 border-l-2 ${
                esc.status === "open"
                  ? "border-l-rose-500"
                  : esc.status === "assigned"
                    ? "border-l-amber-500"
                    : "border-l-emerald-500"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-zinc-50">{esc.reason}</p>
                  <p className="mt-1 text-sm text-zinc-400">
                    Client: {client?.name || "Unknown"} —{" "}
                    {client?.business_name || client?.email}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                    {esc.channel}
                  </span>
                  <span
                    className={
                      esc.status === "open"
                        ? "badge-danger"
                        : esc.status === "assigned"
                          ? "badge-warning"
                          : "badge-success"
                    }
                  >
                    {esc.status}
                  </span>
                </div>
              </div>
              <div className="mt-2 text-xs text-zinc-500">
                {new Date(esc.created_at).toLocaleString()}
                {esc.assigned_to && ` \u2014 Assigned to: ${esc.assigned_to}`}
              </div>
            </div>
          );
        })}
        {escalations.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-surface p-8 text-center text-zinc-500">
            No escalations. The bot is handling everything.
          </div>
        )}
      </div>
    </div>
  );
}
