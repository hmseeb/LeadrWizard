import { createSupabaseServiceClient } from "@/lib/supabase-server";
import Link from "next/link";

export default async function ClientsPage() {
  const supabase = createSupabaseServiceClient();
  const { data: clients } = await supabase
    .from("clients")
    .select(
      `
      *,
      onboarding_sessions(status, completion_pct),
      client_services(status, opted_out)
    `
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">Clients</h1>
          <p className="mt-1 text-sm text-zinc-400">
            All clients across onboarding stages
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/clients/new"
            className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:border-brand-500/40 hover:text-brand-300 transition-all"
          >
            A2P Registration
          </Link>
          <Link
            href="/clients/provision"
            className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 transition-all shadow-sm"
          >
            + New Client
          </Link>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-zinc-800 bg-surface overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800/60">
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Name</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Business</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Email</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Services</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Onboarding</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {clients?.map((client) => {
              const sessions = (client.onboarding_sessions || []) as Array<{
                status: string;
                completion_pct: number;
              }>;
              const services = (client.client_services || []) as Array<{
                status: string;
                opted_out: boolean;
              }>;
              const activeSession = sessions[0];
              const activeServices = services.filter((s) => !s.opted_out);
              const deliveredCount = activeServices.filter(
                (s) => s.status === "delivered"
              ).length;

              return (
                <tr key={client.id}>
                  <td className="px-5 py-3.5 text-sm">
                    <Link
                      href={`/clients/${client.id}`}
                      className="font-medium text-brand-400 hover:text-brand-300"
                    >
                      {client.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-zinc-300">{client.business_name || "\u2014"}</td>
                  <td className="px-5 py-3.5 text-sm text-zinc-400">{client.email}</td>
                  <td className="px-5 py-3.5 text-sm text-zinc-400">
                    {deliveredCount}/{activeServices.length} delivered
                  </td>
                  <td className="px-5 py-3.5 text-sm">
                    {activeSession ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-zinc-800">
                          <div
                            className="h-1.5 rounded-full bg-brand-500"
                            style={{
                              width: `${activeSession.completion_pct}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-zinc-500">
                          {activeSession.completion_pct}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-zinc-500">{"\u2014"}</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-zinc-500">
                    {new Date(client.created_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
            {(!clients || clients.length === 0) && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-zinc-500">
                  No clients yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
