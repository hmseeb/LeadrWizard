import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function EscalationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: escalations } = await supabase
    .from("escalations")
    .select(
      `
      *,
      client:clients(name, email, business_name)
    `
    )
    .order("created_at", { ascending: false })
    .limit(50);

  const openCount = escalations?.filter((e) => e.status === "open").length ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-bold">
        Escalations
        {openCount > 0 && (
          <span className="ml-2 rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-medium text-red-700">
            {openCount} open
          </span>
        )}
      </h1>
      <p className="mt-1 text-gray-500">
        Cases where the bot needs human help
      </p>

      <div className="mt-6 space-y-3">
        {escalations?.map((esc) => {
          const client = esc.client as {
            name: string;
            email: string;
            business_name: string | null;
          } | null;

          return (
            <div
              key={esc.id}
              className={`rounded-lg border p-4 ${
                esc.status === "open"
                  ? "border-red-200 bg-red-50"
                  : esc.status === "assigned"
                    ? "border-yellow-200 bg-yellow-50"
                    : "bg-white"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{esc.reason}</p>
                  <p className="mt-1 text-sm text-gray-500">
                    Client: {client?.name || "Unknown"} —{" "}
                    {client?.business_name || client?.email}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    {esc.channel}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
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
              </div>
              <div className="mt-2 text-xs text-gray-400">
                {new Date(esc.created_at).toLocaleString()}
                {esc.assigned_to && ` — Assigned to: ${esc.assigned_to}`}
              </div>
            </div>
          );
        })}
        {(!escalations || escalations.length === 0) && (
          <div className="rounded-lg border bg-white p-8 text-center text-gray-400">
            No escalations. The bot is handling everything.
          </div>
        )}
      </div>
    </div>
  );
}
