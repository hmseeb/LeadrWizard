import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { redirect } from "next/navigation";
import { retryDLQEntry, dismissDLQEntry } from "./actions";
import { AlertOctagon, RotateCcw, X } from "lucide-react";
import type { DeadLetterQueueItem } from "@leadrwizard/shared/types";

export default async function DeadLetterQueuePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const orgData = user ? await getUserOrg(supabase, user.id) : null;
  if (!orgData) {
    return (
      <div>
        <div className="flex items-center gap-3">
          <AlertOctagon className="h-6 w-6 text-rose-400" />
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">Dead Letter Queue</h1>
        </div>
        <p className="mt-4 text-zinc-400">Unable to load organization data. Please try refreshing the page.</p>
      </div>
    );
  }

  // Fetch active DLQ entries (not retried or dismissed)
  const { data: activeEntries } = await supabase
    .from("dead_letter_queue")
    .select("*")
    .eq("org_id", orgData.org.id)
    .is("retried_at", null)
    .is("dismissed_at", null)
    .order("created_at", { ascending: false });

  // Fetch resolved entries (retried or dismissed)
  const { data: resolvedEntries } = await supabase
    .from("dead_letter_queue")
    .select("*")
    .eq("org_id", orgData.org.id)
    .or("retried_at.not.is.null,dismissed_at.not.is.null")
    .order("created_at", { ascending: false })
    .limit(20);

  const active = (activeEntries || []) as DeadLetterQueueItem[];
  const resolved = (resolvedEntries || []) as DeadLetterQueueItem[];

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <AlertOctagon className="h-6 w-6 text-rose-400" />
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">Dead Letter Queue</h1>
          <p className="mt-1 text-zinc-400">
            Service tasks that failed 5+ times. Retry or dismiss each entry.
          </p>
        </div>
      </div>

      {/* Active Entries */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-zinc-200">
          Active ({active.length})
        </h2>

        {active.length === 0 ? (
          <div className="mt-4 rounded-xl border border-zinc-800 bg-surface p-8 text-center text-zinc-500">
            No failed tasks in the queue. Everything is running smoothly.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {active.map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border-l-4 border-l-rose-500 border border-zinc-800 bg-surface p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded border border-rose-500/20 bg-rose-600/10 px-2 py-0.5 text-xs font-medium text-rose-400">
                        {entry.task_type || "unknown"}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {entry.attempt_count} attempts
                      </span>
                      <span className="text-xs text-zinc-500">
                        {formatDate(entry.created_at)}
                      </span>
                    </div>
                    {entry.last_error && (
                      <p className="mt-2 text-sm text-rose-400">
                        {entry.last_error}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-zinc-500">
                      Original: {entry.original_table}/{entry.original_id.slice(0, 8)}...
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <form
                      action={async () => {
                        "use server";
                        await retryDLQEntry(entry.id);
                      }}
                    >
                      <button
                        type="submit"
                        className="flex items-center gap-1 rounded-lg border border-blue-500/20 bg-blue-600/10 px-3 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-600/20 transition-all"
                        title="Retry this task"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Retry
                      </button>
                    </form>
                    <form
                      action={async () => {
                        "use server";
                        await dismissDLQEntry(entry.id);
                      }}
                    >
                      <button
                        type="submit"
                        className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-700 transition-all"
                        title="Dismiss this entry"
                      >
                        <X className="h-3.5 w-3.5" />
                        Dismiss
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resolved Entries */}
      {resolved.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-200">
            Resolved (last 20)
          </h2>
          <div className="mt-4 space-y-2">
            {resolved.map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border-l-4 border-l-zinc-700 border border-zinc-800 bg-zinc-900/40 p-3 opacity-60"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
                    {entry.task_type || "unknown"}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {entry.retried_at ? "Retried" : "Dismissed"}{" "}
                    {formatDate(entry.retried_at || entry.dismissed_at || entry.created_at)}
                  </span>
                  {entry.last_error && (
                    <span className="text-xs text-zinc-600 truncate max-w-md">
                      {entry.last_error}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
