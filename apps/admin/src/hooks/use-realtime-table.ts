"use client";

import { useEffect, useState, useMemo } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

export function useRealtimeTable<T extends { id: string }>({
  table,
  orgId,
  initialData,
  channelName,
}: {
  table: string;
  orgId: string;
  initialData: T[];
  channelName: string;
}) {
  const [data, setData] = useState<T[]>(initialData);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  // Reset data when initialData changes (e.g. client-side navigation)
  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `org_id=eq.${orgId}`,
        },
        (payload: RealtimePostgresChangesPayload<T>) => {
          if (payload.eventType === "INSERT") {
            setData((prev) => [payload.new as T, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setData((prev) =>
              prev.map((item) =>
                item.id === (payload.new as T).id
                  ? { ...item, ...payload.new }
                  : item
              )
            );
          } else if (payload.eventType === "DELETE") {
            // DELETE payloads only contain old.id (column data is gone)
            // Client-side org_id check for safety (DELETE events can't be server-filtered)
            const oldRow = payload.old as { id: string; org_id?: string };
            if (oldRow.org_id && oldRow.org_id !== orgId) return;
            setData((prev) =>
              prev.filter((item) => item.id !== oldRow.id)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, table, orgId, channelName]);

  return data;
}
