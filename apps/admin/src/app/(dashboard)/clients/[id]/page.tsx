import { createSupabaseServiceClient } from "@/lib/supabase-server";
import { notFound } from "next/navigation";
import { CopyOnboardingLink } from "./copy-onboarding-link";
import { GhlSubaccountPanel } from "./ghl-subaccount-panel";
import { MarkDeliveredButton } from "./mark-delivered-button";
import { StartWebsiteBuildButton } from "./start-website-build-button";
import { DeleteClientPanel } from "./delete-client-panel";

function serviceStatusBadgeClass(status: string, optedOut: boolean): string {
  if (optedOut) return "bg-zinc-800/80 text-zinc-400 border border-zinc-700";
  switch (status) {
    case "delivered":
      return "bg-green-900/40 text-green-300 border border-green-800/60";
    case "ready_to_deliver":
      return "bg-emerald-900/40 text-emerald-300 border border-emerald-800/60";
    case "in_progress":
      return "bg-blue-900/40 text-blue-300 border border-blue-800/60";
    case "pending_onboarding":
      return "bg-amber-900/40 text-amber-300 border border-amber-800/60";
    case "paused":
      return "bg-zinc-800/80 text-zinc-400 border border-zinc-700";
    default:
      return "bg-blue-900/40 text-blue-300 border border-blue-800/60";
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
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">
            {client.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {client.business_name || "No business name"}
            <span className="mx-2 text-zinc-600">·</span>
            <span className="text-zinc-300">{client.email}</span>
            {client.phone && (
              <>
                <span className="mx-2 text-zinc-600">·</span>
                <span className="text-zinc-300">{client.phone}</span>
              </>
            )}
          </p>
        </div>
        {client.ghl_sub_account_id && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-800/60 bg-emerald-900/40 px-3 py-1 text-xs font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
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
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Services
        </h2>
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
              <div
                key={cs.id}
                className="rounded-xl border border-zinc-800 bg-surface p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-zinc-100">
                    {service?.name || "Unknown"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${serviceStatusBadgeClass(cs.status, cs.opted_out)}`}
                  >
                    {serviceStatusLabel(cs.status, cs.opted_out)}
                  </span>
                </div>
                {(canStartWebsiteBuild || canMarkDelivered) && (
                  <div className="mt-3 space-y-2">
                    {canStartWebsiteBuild && (
                      <StartWebsiteBuildButton
                        clientId={id}
                        clientServiceId={cs.id}
                      />
                    )}
                    {canMarkDelivered && (
                      <div className="flex justify-end">
                        <MarkDeliveredButton
                          clientId={id}
                          clientServiceId={cs.id}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {(!services || services.length === 0) && (
            <p className="text-sm text-zinc-500">No services assigned.</p>
          )}
        </div>
      </section>

      {/* Interaction Timeline */}
      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Interaction History ({interactions?.length || 0})
        </h2>
        <div className="mt-3 space-y-2">
          {interactions?.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-surface p-3 text-sm"
            >
              <span
                className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                  log.direction === "inbound"
                    ? "bg-blue-900/40 text-blue-300 border border-blue-800/60"
                    : "bg-zinc-800/80 text-zinc-400 border border-zinc-700"
                }`}
              >
                {log.direction === "inbound" ? "IN" : "OUT"}
              </span>
              <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400 border border-zinc-700">
                {log.channel}
              </span>
              <span className="flex-1 text-zinc-200">{log.content}</span>
              <span className="shrink-0 text-xs text-zinc-500">
                {new Date(log.created_at).toLocaleString()}
              </span>
            </div>
          ))}
          {(!interactions || interactions.length === 0) && (
            <p className="text-sm text-zinc-500">No interactions recorded yet.</p>
          )}
        </div>
      </section>

      {/* Escalations */}
      {escalations && escalations.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Escalations
          </h2>
          <div className="mt-3 space-y-2">
            {escalations.map((esc) => (
              <div
                key={esc.id}
                className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-zinc-100">{esc.reason}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                      esc.status === "resolved"
                        ? "bg-green-900/40 text-green-300 border border-green-800/60"
                        : "bg-amber-900/40 text-amber-300 border border-amber-800/60"
                    }`}
                  >
                    {esc.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {new Date(esc.created_at).toLocaleString()}
                  {esc.assigned_to && ` — Assigned to: ${esc.assigned_to}`}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Danger Zone — hard-delete the client + cascading related rows */}
      <DeleteClientPanel
        clientId={id}
        clientName={client.name}
        businessName={client.business_name ?? null}
        clientEmail={client.email ?? null}
      />
    </div>
  );
}
