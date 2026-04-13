import { createSupabaseServiceClient } from "@/lib/supabase-server";
import { notFound } from "next/navigation";
import { CopyOnboardingLink } from "./copy-onboarding-link";
import { GhlSubaccountPanel } from "./ghl-subaccount-panel";
import { MarkDeliveredButton } from "./mark-delivered-button";
import { StartWebsiteBuildButton } from "./start-website-build-button";

function serviceStatusBadgeClass(status: string, optedOut: boolean): string {
  if (optedOut) return "bg-gray-100 text-gray-500";
  switch (status) {
    case "delivered":
      return "bg-green-100 text-green-700";
    case "ready_to_deliver":
      return "bg-emerald-100 text-emerald-700";
    case "in_progress":
      return "bg-blue-100 text-blue-700";
    case "pending_onboarding":
      return "bg-yellow-100 text-yellow-700";
    case "paused":
      return "bg-gray-100 text-gray-600";
    default:
      return "bg-blue-100 text-blue-700";
  }
}

function serviceStatusLabel(status: string, optedOut: boolean): string {
  if (optedOut) return "Opted Out";
  switch (status) {
    case "ready_to_deliver":
      return "Ready to deliver";
    case "in_progress":
      return "In progress";
    case "pending_onboarding":
      return "Pending onboarding";
    default:
      return status;
  }
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createSupabaseServiceClient();

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (!client) notFound();

  const [
    { data: sessions },
    { data: services },
    { data: interactions },
    { data: escalations },
  ] = await Promise.all([
    supabase
      .from("onboarding_sessions")
      .select("*")
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("client_services")
      .select("*, service:service_definitions(name, slug)")
      .eq("client_id", id),
    supabase
      .from("interaction_log")
      .select("*")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("escalations")
      .select("*")
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{client.name}</h1>
          <p className="mt-1 text-gray-500">
            {client.business_name || "No business name"} — {client.email}
            {client.phone && ` — ${client.phone}`}
          </p>
        </div>
        {client.ghl_sub_account_id && (
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
            GHL Active
          </span>
        )}
      </div>

      {/* Onboarding Link — show for any non-completed session so agency can manually share it */}
      {sessions && sessions.length > 0 && sessions[0].status !== "completed" && (
        <section className="mt-6">
          <CopyOnboardingLink sessionId={sessions[0].id} />
        </section>
      )}

      {/* GHL Subaccount linking / details */}
      <section className="mt-6">
        <GhlSubaccountPanel
          clientId={id}
          currentLocationId={client.ghl_sub_account_id ?? null}
        />
      </section>

      {/* Services Status */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Services</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {services?.map((cs) => {
            const service = cs.service as { name: string; slug: string } | null;
            // Mark Delivered is the universal manual fallback. It's shown
            // for any non-delivered, non-opted-out service — including
            // `pending_onboarding` — so Greg is never stranded when the
            // automated state transition doesn't fire (e.g. onboarding
            // field-key mismatch, stuck state, etc.).
            const canMarkDelivered = !cs.opted_out && cs.status !== "delivered";
            // Start Website Build is shown for the website-build service
            // in any pre-delivered state. The server action itself will
            // tell us which required onboarding fields are missing if
            // data isn't ready, so the button is safe to surface early.
            const canStartWebsiteBuild =
              !cs.opted_out &&
              service?.slug === "website-build" &&
              cs.status !== "delivered";
            return (
              <div key={cs.id} className="rounded-lg border bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">
                    {service?.name || "Unknown"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${serviceStatusBadgeClass(cs.status, cs.opted_out)}`}
                  >
                    {serviceStatusLabel(cs.status, cs.opted_out)}
                  </span>
                </div>
                {(canStartWebsiteBuild || canMarkDelivered) && (
                  <div className="mt-3 flex items-start justify-end gap-3">
                    {canStartWebsiteBuild && (
                      <StartWebsiteBuildButton
                        clientId={id}
                        clientServiceId={cs.id}
                      />
                    )}
                    {canMarkDelivered && (
                      <MarkDeliveredButton
                        clientId={id}
                        clientServiceId={cs.id}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Interaction Timeline */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          Interaction History ({interactions?.length || 0})
        </h2>
        <div className="mt-3 space-y-2">
          {interactions?.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-3 rounded border bg-white p-3 text-sm"
            >
              <span
                className={`mt-0.5 rounded px-1.5 py-0.5 text-xs font-medium ${
                  log.direction === "inbound"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {log.direction === "inbound" ? "IN" : "OUT"}
              </span>
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                {log.channel}
              </span>
              <span className="flex-1">{log.content}</span>
              <span className="text-xs text-gray-400">
                {new Date(log.created_at).toLocaleString()}
              </span>
            </div>
          ))}
          {(!interactions || interactions.length === 0) && (
            <p className="text-sm text-gray-400">No interactions recorded yet.</p>
          )}
        </div>
      </section>

      {/* Escalations */}
      {escalations && escalations.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Escalations</h2>
          <div className="mt-3 space-y-2">
            {escalations.map((esc) => (
              <div
                key={esc.id}
                className="rounded border border-yellow-200 bg-yellow-50 p-3 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{esc.reason}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      esc.status === "resolved"
                        ? "bg-green-100 text-green-700"
                        : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {esc.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {new Date(esc.created_at).toLocaleString()}
                  {esc.assigned_to && ` — Assigned to: ${esc.assigned_to}`}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
