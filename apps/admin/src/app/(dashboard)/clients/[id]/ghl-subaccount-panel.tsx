"use client";

import { useState, useTransition, useEffect } from "react";
import { Link2, CheckCircle2, AlertCircle, X } from "lucide-react";
import { linkGhlSubaccount, unlinkGhlSubaccount } from "./actions";

interface GhlLocationDetails {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  website: string | null;
  timezone: string | null;
}

interface GhlSubaccountPanelProps {
  clientId: string;
  currentLocationId: string | null;
}

/**
 * Paste-a-location-ID-and-verify UI for linking a GHL subaccount to a client.
 *
 * This is a workaround for the fact that our current GHL subscription doesn't
 * permit API-driven sub-account creation. Greg manually creates the sub-account
 * in GHL, pastes the location ID here, we hit /api/ghl/locations/[id] to
 * verify + show the details, and on confirm we write the ID to clients.
 */
export function GhlSubaccountPanel({
  clientId,
  currentLocationId,
}: GhlSubaccountPanelProps) {
  const [pendingLocationId, setPendingLocationId] = useState("");
  const [details, setDetails] = useState<GhlLocationDetails | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLinking, startLinking] = useTransition();
  const [isUnlinking, startUnlinking] = useTransition();
  const [linkedDetails, setLinkedDetails] = useState<GhlLocationDetails | null>(null);
  const [linkedLoading, setLinkedLoading] = useState(false);

  // Load the currently-linked location's details on mount so we can render
  // the subaccount name/phone/email instead of just the raw ID.
  useEffect(() => {
    if (!currentLocationId) return;
    let cancelled = false;
    setLinkedLoading(true);
    fetch(`/api/ghl/locations/${encodeURIComponent(currentLocationId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.location) setLinkedDetails(data.location);
      })
      .catch(() => {
        // Silent — fall back to showing the raw ID.
      })
      .finally(() => {
        if (!cancelled) setLinkedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentLocationId]);

  async function handleVerify() {
    setError(null);
    setDetails(null);
    const trimmed = pendingLocationId.trim();
    if (!trimmed) {
      setError("Paste a GHL location ID first.");
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch(`/api/ghl/locations/${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not verify location");
        return;
      }
      setDetails(data.location as GhlLocationDetails);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setVerifying(false);
    }
  }

  function handleLink() {
    if (!details) return;
    startLinking(async () => {
      try {
        await linkGhlSubaccount(clientId, details.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to link");
      }
    });
  }

  function handleUnlink() {
    startUnlinking(async () => {
      try {
        await unlinkGhlSubaccount(clientId);
        setLinkedDetails(null);
        setDetails(null);
        setPendingLocationId("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to unlink");
      }
    });
  }

  // --- Linked state: show the details, with an unlink button ---
  if (currentLocationId) {
    return (
      <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <p className="text-xs font-medium uppercase tracking-wider text-emerald-300">
                GHL Subaccount Linked
              </p>
            </div>
            {linkedLoading ? (
              <p className="mt-2 text-sm text-zinc-400">Loading details…</p>
            ) : linkedDetails ? (
              <div className="mt-2">
                <p className="text-base font-semibold text-zinc-100">
                  {linkedDetails.name || "(unnamed location)"}
                </p>
                <p className="mt-1 font-mono text-xs text-zinc-500">
                  {linkedDetails.id}
                </p>
                <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-zinc-400 sm:grid-cols-2">
                  {linkedDetails.phone && (
                    <div>
                      <dt className="inline text-zinc-500">Phone: </dt>
                      <dd className="inline text-zinc-300">{linkedDetails.phone}</dd>
                    </div>
                  )}
                  {linkedDetails.email && (
                    <div>
                      <dt className="inline text-zinc-500">Email: </dt>
                      <dd className="inline text-zinc-300">{linkedDetails.email}</dd>
                    </div>
                  )}
                  {(linkedDetails.city || linkedDetails.state) && (
                    <div>
                      <dt className="inline text-zinc-500">Location: </dt>
                      <dd className="inline text-zinc-300">
                        {[linkedDetails.city, linkedDetails.state]
                          .filter(Boolean)
                          .join(", ")}
                      </dd>
                    </div>
                  )}
                  {linkedDetails.timezone && (
                    <div>
                      <dt className="inline text-zinc-500">Timezone: </dt>
                      <dd className="inline text-zinc-300">{linkedDetails.timezone}</dd>
                    </div>
                  )}
                </dl>
              </div>
            ) : (
              <p className="mt-2 font-mono text-xs text-zinc-400">
                {currentLocationId}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleUnlink}
            disabled={isUnlinking}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-rose-500/50 hover:text-rose-400 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            {isUnlinking ? "Unlinking…" : "Unlink"}
          </button>
        </div>
        {error && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-rose-400">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </p>
        )}
      </div>
    );
  }

  // --- Unlinked state: paste ID, verify, link ---
  return (
    <div className="rounded-xl border border-zinc-800 bg-surface p-4">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-zinc-400" />
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          Link GHL Subaccount
        </p>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Create the sub-account manually in GHL, then paste its Location ID here
        to verify and link it to this client.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={pendingLocationId}
          onChange={(e) => setPendingLocationId(e.target.value)}
          placeholder="e.g., ABC123xyz..."
          disabled={verifying || isLinking}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
        />
        <button
          type="button"
          onClick={handleVerify}
          disabled={verifying || isLinking || !pendingLocationId.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/60 px-4 py-2 text-xs font-medium text-zinc-300 hover:border-brand-500/50 hover:text-brand-400 disabled:opacity-50"
        >
          {verifying ? "Verifying…" : "Verify"}
        </button>
      </div>

      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-rose-400">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </p>
      )}

      {details && (
        <div className="mt-4 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <p className="text-xs font-medium text-emerald-300">
              Found: {details.name || "(unnamed location)"}
            </p>
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-zinc-400 sm:grid-cols-2">
            {details.phone && (
              <div>
                <dt className="inline text-zinc-500">Phone: </dt>
                <dd className="inline text-zinc-300">{details.phone}</dd>
              </div>
            )}
            {details.email && (
              <div>
                <dt className="inline text-zinc-500">Email: </dt>
                <dd className="inline text-zinc-300">{details.email}</dd>
              </div>
            )}
            {(details.city || details.state) && (
              <div>
                <dt className="inline text-zinc-500">Location: </dt>
                <dd className="inline text-zinc-300">
                  {[details.city, details.state].filter(Boolean).join(", ")}
                </dd>
              </div>
            )}
          </dl>
          <button
            type="button"
            onClick={handleLink}
            disabled={isLinking}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-emerald-700/50 bg-emerald-900/30 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:border-emerald-500/50 hover:bg-emerald-900/50 disabled:opacity-50"
          >
            <Link2 className="h-3.5 w-3.5" />
            {isLinking ? "Linking…" : "Link to this client"}
          </button>
        </div>
      )}
    </div>
  );
}
