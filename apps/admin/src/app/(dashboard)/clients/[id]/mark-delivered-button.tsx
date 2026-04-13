"use client";

import { useTransition, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { markClientServiceDelivered } from "./actions";

interface MarkDeliveredButtonProps {
  clientId: string;
  clientServiceId: string;
}

/**
 * Small button used on the client detail services card. Lets Greg manually
 * mark a service as delivered when its automation path is blocked (e.g. GHL
 * sub-account creation on our current subscription).
 */
export function MarkDeliveredButton({
  clientId,
  clientServiceId,
}: MarkDeliveredButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        await markClientServiceDelivered(clientId, clientServiceId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded-md border border-emerald-700/50 bg-emerald-900/20 px-2 py-1 text-xs font-medium text-emerald-300 hover:border-emerald-500/50 hover:bg-emerald-900/40 disabled:opacity-50"
      >
        <CheckCircle2 className="h-3 w-3" />
        {isPending ? "Marking…" : "Mark delivered"}
      </button>
      {error && <p className="mt-1 text-[10px] text-rose-400">{error}</p>}
    </div>
  );
}
