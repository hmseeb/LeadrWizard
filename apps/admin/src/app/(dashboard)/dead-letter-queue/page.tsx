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

  const orgData = await getUserOrg(supabase, user.id);
  if (!orgData) redirect("/login");

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
        <AlertOctagon className="h-6 w-6 text-red-500" />
        <div>
          <h1 className="text-2xl font-bold">Dead Letter Queue</h1>
          <p className="mt-1 text-gray-500">
            Service tasks that failed 5+ times. Retry or dismiss each entry.
          </p>
        </div>
      </div>

      {/* Active Entries */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-gray-800">
          Active ({active.length})
        </h2>

        {active.length === 0 ? (
          <div className="mt-4 rounded-lg border bg-white p-8 text-center text-gray-500">
            No failed tasks in the queue. Everything is running smoothly.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {active.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-red-200 bg-white p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        {entry.task_type || "unknown"}
                      </span>
                      <span className="text-xs text-gray-500">
                        {entry.attempt_count} attempts
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatDate(entry.created_at)}
                      </span>
                    </div>
                    {entry.last_error && (
                      <p className="mt-2 text-sm text-red-600">
                        {entry.last_error}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-gray-400">
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
                        className="flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
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
                        className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
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
          <h2 className="text-lg font-semibold text-gray-800">
            Resolved (last 20)
          </h2>
          <div className="mt-4 space-y-2">
            {resolved.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border bg-gray-50 p-3 opacity-75"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                    {entry.task_type || "unknown"}
                  </span>
                  <span className="text-xs text-gray-500">
                    {entry.retried_at ? "Retried" : "Dismissed"}{" "}
                    {formatDate(entry.retried_at || entry.dismissed_at || entry.created_at)}
                  </span>
                  {entry.last_error && (
                    <span className="text-xs text-gray-400 truncate max-w-md">
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
