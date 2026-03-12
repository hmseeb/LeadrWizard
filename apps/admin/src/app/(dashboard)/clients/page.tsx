import { createSupabaseServerClient } from "@/lib/supabase-server";
import Link from "next/link";

export default async function ClientsPage() {
  const supabase = await createSupabaseServerClient();
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
      <h1 className="text-2xl font-bold">Clients</h1>
      <p className="mt-1 text-gray-500">
        All clients across onboarding stages
      </p>

      <div className="mt-6">
        <table className="w-full">
          <thead>
            <tr className="border-b text-left text-sm text-gray-500">
              <th className="pb-3 font-medium">Name</th>
              <th className="pb-3 font-medium">Business</th>
              <th className="pb-3 font-medium">Email</th>
              <th className="pb-3 font-medium">Services</th>
              <th className="pb-3 font-medium">Onboarding</th>
              <th className="pb-3 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y">
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
                <tr key={client.id} className="text-sm">
                  <td className="py-3">
                    <Link
                      href={`/clients/${client.id}`}
                      className="font-medium text-brand-600 hover:text-brand-700"
                    >
                      {client.name}
                    </Link>
                  </td>
                  <td className="py-3">{client.business_name || "—"}</td>
                  <td className="py-3 text-gray-500">{client.email}</td>
                  <td className="py-3 text-gray-500">
                    {deliveredCount}/{activeServices.length} delivered
                  </td>
                  <td className="py-3">
                    {activeSession ? (
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 rounded-full bg-gray-200">
                          <div
                            className="h-2 rounded-full bg-brand-500"
                            style={{
                              width: `${activeSession.completion_pct}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">
                          {activeSession.completion_pct}%
                        </span>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-3 text-gray-500">
                    {new Date(client.created_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
            {(!clients || clients.length === 0) && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400">
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
