"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { deleteClient } from "./actions";

interface DeleteClientPanelProps {
  clientId: string;
  clientName: string;
  businessName: string | null;
  clientEmail: string | null;
}

/**
 * "Danger Zone" delete panel rendered at the bottom of the client detail
 * page. Requires Greg to type the client's exact email address before the
 * Delete button unlocks — the same guard is enforced again on the server
 * in `deleteClient`, so a stale client-side state or a manually-crafted
 * request can't bypass it.
 *
 * On success we redirect to /clients and let Next.js re-fetch the list.
 * On failure we surface the server-returned error inline and keep the
 * modal open so Greg can correct the input or dismiss it.
 *
 * Deliberately does NOT attempt to clean up external resources (GHL,
 * Twilio, Vercel). Those belong to the client, not the agency, and
 * silently tearing them down on a delete would be much worse than
 * leaving a few orphaned external rows that Greg can clean up manually.
 */
export function DeleteClientPanel({
  clientId,
  clientName,
  businessName,
  clientEmail,
}: DeleteClientPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);

  const expected = (clientEmail || "").trim().toLowerCase();
  const matches = expected.length > 0 && confirmation.trim().toLowerCase() === expected;
  const canDelete = matches && !isPending;

  function handleOpen() {
    setOpen(true);
    setConfirmation("");
    setError(null);
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
  }

  function handleDelete() {
    if (!canDelete) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteClient(clientId, confirmation);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Hard redirect to the clients list — the current page is about to
      // 404 since the row we're on was just deleted.
      router.replace("/clients");
      router.refresh();
    });
  }

  return (
    <>
      <section className="mt-12 rounded-xl border border-rose-900/40 bg-rose-950/10 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-rose-300">
              <AlertTriangle className="h-4 w-4" />
              Danger Zone
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Permanently delete this client and all associated data —
              onboarding sessions, services, interactions, escalations, and
              outreach queue entries. External systems like GHL, Twilio,
              and any deployed websites are not touched.
            </p>
            <p className="mt-1.5 text-xs text-rose-400">
              This cannot be undone.
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpen}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-rose-700/50 bg-rose-900/30 px-3 py-1.5 text-xs font-medium text-rose-300 hover:border-rose-500/60 hover:bg-rose-900/50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete client
          </button>
        </div>
      </section>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={handleClose}
        >
          <div
            className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-50">
                <AlertTriangle className="h-4 w-4 text-rose-400" />
                Delete {businessName || clientName}?
              </h3>
              <button
                type="button"
                onClick={handleClose}
                disabled={isPending}
                className="text-zinc-500 hover:text-zinc-300 disabled:opacity-40"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-2 text-sm text-zinc-300">
              <p>
                This will permanently delete{" "}
                <span className="font-medium text-zinc-100">
                  {businessName || clientName}
                </span>{" "}
                and every row linked to it — services, sessions,
                interactions, escalations, and outreach queue entries.
              </p>
              <p className="text-xs text-zinc-500">
                External systems (GHL subaccount, Twilio number, deployed
                websites) will not be touched.
              </p>
            </div>

            <div className="mt-5">
              <label
                htmlFor="delete-confirm-email"
                className="block text-xs font-medium uppercase tracking-wider text-zinc-500"
              >
                Type{" "}
                <span className="font-mono text-zinc-300">{clientEmail}</span>{" "}
                to confirm
              </label>
              <input
                id="delete-confirm-email"
                type="email"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                disabled={isPending}
                autoComplete="off"
                autoFocus
                placeholder={clientEmail || ""}
                className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500/50 focus:outline-none focus:ring-1 focus:ring-rose-500/30"
              />
              {!expected && (
                <p className="mt-2 text-xs text-amber-400">
                  This client has no email on file — deletion is blocked.
                  Contact support if you need to force-remove it.
                </p>
              )}
            </div>

            {error && (
              <div className="mt-4 rounded-md border border-rose-500/30 bg-rose-600/10 p-3 text-xs text-rose-300">
                {error}
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={isPending}
                className="rounded-md border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!canDelete}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-600/60 bg-rose-700/40 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:border-rose-500/70 hover:bg-rose-700/60 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isPending ? "Deleting…" : "Delete client permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
