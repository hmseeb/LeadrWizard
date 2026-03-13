# Phase 8: Realtime Dashboard - Research

**Researched:** 2026-03-14
**Domain:** Supabase Realtime (Postgres Changes) + Next.js 15 App Router
**Confidence:** HIGH

## Summary

This phase wires Supabase Realtime Postgres Changes into the admin dashboard so that `onboarding_sessions` and `escalations` tables push live updates to authenticated admin users without page refresh. The `@supabase/supabase-js@2.99.1` already installed includes full realtime support. No new packages needed.

The main architectural challenge is that the `escalations` table lacks a direct `org_id` column (it only has `client_id`), so Postgres Changes filters cannot directly scope escalation events by org. The recommended approach is to add an `org_id` column to `escalations` via migration, which enables direct channel filtering and is consistent with how `onboarding_sessions` already works. RLS on the existing policies provides a second layer of isolation, but client-side channel filtering via `org_id=eq.{uuid}` is the primary scoping mechanism.

The current dashboard page (`page.tsx`) is a pure server component. The pattern is to keep initial data fetching in a server component wrapper, then pass data as props to a `"use client"` child that subscribes to realtime channels and merges incoming payloads into local state.

**Primary recommendation:** Add `org_id` to `escalations` table, add both tables to `supabase_realtime` publication, split dashboard/onboardings/escalations pages into server wrapper + client component with `postgres_changes` subscriptions filtered by `org_id=eq.{uuid}`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OBS-03 | Dashboard updates in realtime via Supabase subscriptions for onboarding_sessions and escalations | Postgres Changes on both tables with org_id filters, browser client subscriptions in client components, publication setup migration |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @supabase/supabase-js | 2.99.1 | Realtime client (Postgres Changes) | Already installed, includes realtime-js |
| @supabase/ssr | 0.5.2 | Browser client creation (createBrowserClient) | Already installed, used in login/setup pages |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react (useEffect, useState, useMemo) | 19.0.0 | Subscription lifecycle management | Every realtime client component |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Postgres Changes | Broadcast via DB triggers | More setup (write trigger functions), but scales better for 100+ concurrent admins. Overkill for this use case. |
| Postgres Changes | Polling with setInterval | Simpler but violates <2s requirement and wastes bandwidth |
| Client-side Supabase | Server-Sent Events API route | Custom infra, no built-in auth. Unnecessary when Supabase provides it. |

**Installation:**
```bash
# No installation needed - all packages already present
```

## Architecture Patterns

### Recommended Project Structure
```
apps/admin/src/
  app/(dashboard)/
    dashboard/
      page.tsx                    # Server component - initial data fetch
      realtime-dashboard.tsx      # "use client" - receives props + subscribes to realtime
    onboardings/
      page.tsx                    # Server component - initial data fetch
      realtime-sessions.tsx       # "use client" - sessions table with realtime
    escalations/
      page.tsx                    # Server component - initial data fetch
      realtime-escalations.tsx    # "use client" - escalations list with realtime
  hooks/
    use-realtime-table.ts         # Shared hook for postgres_changes subscription
  lib/
    supabase-browser.ts           # Already exists - createBrowserClient from @supabase/ssr
```

### Pattern 1: Server Wrapper + Client Subscriber
**What:** Server component fetches initial data, passes to client component that subscribes to realtime
**When to use:** Every page that needs live updates

```typescript
// page.tsx (server component)
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { RealtimeSessions } from "./realtime-sessions";

export default async function OnboardingsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const orgData = user ? await getUserOrg(supabase, user.id) : null;

  const { data: sessions } = await supabase
    .from("onboarding_sessions")
    .select("*, client:clients(name, email, business_name, phone)")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <RealtimeSessions
      initialSessions={sessions ?? []}
      orgId={orgData?.org.id ?? ""}
    />
  );
}
```

```typescript
// realtime-sessions.tsx (client component)
"use client";

import { useEffect, useState, useMemo } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export function RealtimeSessions({ initialSessions, orgId }: Props) {
  const [sessions, setSessions] = useState(initialSessions);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  useEffect(() => {
    const channel = supabase
      .channel("sessions-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "onboarding_sessions",
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setSessions((prev) => [payload.new as Session, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setSessions((prev) =>
              prev.map((s) => (s.id === payload.new.id ? { ...s, ...payload.new } : s))
            );
          } else if (payload.eventType === "DELETE") {
            setSessions((prev) => prev.filter((s) => s.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, orgId]);

  // ... render sessions table
}
```

### Pattern 2: Shared Realtime Hook
**What:** Reusable hook for postgres_changes subscription with merge logic
**When to use:** DRY across multiple realtime pages

```typescript
// hooks/use-realtime-table.ts
"use client";

import { useEffect, useState, useMemo } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

export function useRealtimeTable<T extends { id: string }>({
  table,
  filter,
  initialData,
  channelName,
}: {
  table: string;
  filter: string;
  initialData: T[];
  channelName: string;
}) {
  const [data, setData] = useState<T[]>(initialData);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  useEffect(() => {
    // Reset when initialData changes (e.g. navigation)
    setData(initialData);
  }, [initialData]);

  useEffect(() => {
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter,
        },
        (payload: RealtimePostgresChangesPayload<T>) => {
          if (payload.eventType === "INSERT") {
            setData((prev) => [payload.new as T, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setData((prev) =>
              prev.map((item) =>
                item.id === (payload.new as T).id ? { ...item, ...payload.new } : item
              )
            );
          } else if (payload.eventType === "DELETE") {
            setData((prev) =>
              prev.filter((item) => item.id !== (payload.old as { id: string }).id)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, table, filter, channelName]);

  return data;
}
```

### Pattern 3: Multiple Subscriptions on One Channel
**What:** Chain .on() calls for dashboard KPI cards that need updates from multiple tables
**When to use:** Dashboard overview page watching sessions + escalations

```typescript
const channel = supabase
  .channel("dashboard-realtime")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "onboarding_sessions",
      filter: `org_id=eq.${orgId}`,
    },
    handleSessionChange
  )
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "escalations",
      filter: `org_id=eq.${orgId}`,
    },
    handleEscalationChange
  )
  .subscribe();
```

### Anti-Patterns to Avoid
- **Subscribing in server components:** Realtime uses WebSockets, which only work in the browser. Always use `"use client"` components.
- **Creating a new Supabase client on every render:** Use `useMemo` to create the client once. The existing codebase pattern (`useMemo(() => createSupabaseBrowserClient(), [])`) is correct.
- **Forgetting channel cleanup:** Always call `supabase.removeChannel(channel)` in the useEffect cleanup. React 19 strict mode will double-mount, creating duplicate subscriptions without cleanup.
- **Using channel name 'realtime':** This is a reserved name. Use any other string.
- **Filtering DELETE events:** You cannot filter DELETE events with Postgres Changes. RLS handles org scoping for DELETEs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket connection management | Custom WebSocket code | supabase.channel().subscribe() | Handles reconnection, auth token refresh, heartbeats |
| Org-scoped filtering | Client-side filter after receiving all events | Postgres Changes `filter` parameter | Server-side filtering reduces bandwidth and prevents data leaks |
| Publication setup | Manual WAL configuration | `alter publication supabase_realtime add table X` | Supabase manages the logical replication slot |
| Auth token refresh for realtime | Manual JWT refresh logic | @supabase/ssr handles cookie-based auth | Browser client auto-sends auth state |

**Key insight:** Supabase Realtime handles WebSocket lifecycle (connect, reconnect, heartbeat, auth refresh) internally. The developer surface is just `channel.on().subscribe()` and cleanup.

## Common Pitfalls

### Pitfall 1: Missing supabase_realtime Publication
**What goes wrong:** Subscriptions connect but never receive any events
**Why it happens:** Tables must be explicitly added to the `supabase_realtime` publication before Postgres Changes work
**How to avoid:** Run `alter publication supabase_realtime add table onboarding_sessions, escalations;` in a migration
**Warning signs:** Channel status shows SUBSCRIBED but no payloads arrive on database changes

### Pitfall 2: Escalations Table Lacks org_id
**What goes wrong:** Cannot use `filter: 'org_id=eq.{uuid}'` on escalations because the column does not exist
**Why it happens:** Original schema used `client_id` with join-based RLS instead of denormalized org_id
**How to avoid:** Add `org_id` column to escalations via migration, backfill from clients table, and add NOT NULL constraint
**Warning signs:** Filter on non-existent column silently receives no events

### Pitfall 3: RLS Policy Cache on Realtime
**What goes wrong:** User changes org membership but still sees old org's data via realtime
**Why it happens:** Supabase caches RLS policy evaluation per connection. Cache updates only when: (a) client first subscribes, (b) new JWT is sent via access_token message
**How to avoid:** Not a practical concern for this app (users don't switch orgs), but be aware that RLS is not re-evaluated per message
**Warning signs:** Stale data after permission changes

### Pitfall 4: DELETE Events Ignore Filters
**What goes wrong:** DELETE events arrive even when they don't match the filter
**Why it happens:** Postgres Changes cannot filter DELETE events because the row data is gone by the time the event is processed
**How to avoid:** For DELETE events, validate `payload.old.org_id` client-side before removing from state. Alternatively, rely on RLS (which does apply to the subscription overall) to prevent cross-org events.
**Warning signs:** Cross-org delete events appearing (unlikely with RLS, but possible in edge cases)

### Pitfall 5: React Strict Mode Double Subscriptions
**What goes wrong:** Two subscriptions created on mount, duplicate events
**Why it happens:** React 19 strict mode remounts components in development
**How to avoid:** Always return cleanup function from useEffect that calls `supabase.removeChannel(channel)`
**Warning signs:** Every event fires twice in dev mode

### Pitfall 6: Stale Closure in Event Handler
**What goes wrong:** Event handler references stale state
**Why it happens:** The callback passed to `.on()` captures the closure at subscription time
**How to avoid:** Use functional state updates (`setData(prev => ...)`) instead of referencing state directly
**Warning signs:** Data resets or ignores previously received events

## Code Examples

### Migration: Add org_id to Escalations + Publication Setup

```sql
-- Migration: 00009_realtime_setup.sql

-- 1. Add org_id to escalations for direct channel filtering
alter table public.escalations
  add column org_id uuid references public.organizations(id) on delete cascade;

-- 2. Backfill org_id from the client's org
update public.escalations e
set org_id = c.org_id
from public.clients c
where e.client_id = c.id;

-- 3. Make it NOT NULL after backfill
alter table public.escalations
  alter column org_id set not null;

-- 4. Add index for realtime filter performance
create index idx_escalations_org on public.escalations(org_id);

-- 5. Add tables to the supabase_realtime publication
-- The publication may already exist (Supabase creates it by default)
-- Use IF NOT EXISTS pattern for safety
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.onboarding_sessions;
alter publication supabase_realtime add table public.escalations;
```

### Browser Client for Realtime (Already Exists)

```typescript
// apps/admin/src/lib/supabase-browser.ts (no changes needed)
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

### Realtime Dashboard KPI Cards

```typescript
"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

interface DashboardCounts {
  activeSessions: number;
  completedSessions: number;
  openEscalations: number;
}

export function RealtimeDashboard({
  initialCounts,
  orgId,
  children,
}: {
  initialCounts: DashboardCounts;
  orgId: string;
  children: React.ReactNode; // Static sections that don't need realtime
}) {
  const [counts, setCounts] = useState(initialCounts);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-kpi")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "onboarding_sessions",
          filter: `org_id=eq.${orgId}`,
        },
        () => {
          // Re-fetch counts on any session change
          // Simpler than trying to compute deltas from payloads
          refetchCounts();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "escalations",
          filter: `org_id=eq.${orgId}`,
        },
        () => {
          refetchCounts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, orgId]);

  const refetchCounts = useCallback(async () => {
    const [
      { count: active },
      { count: completed },
      { count: openEsc },
    ] = await Promise.all([
      supabase
        .from("onboarding_sessions")
        .select("*", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("onboarding_sessions")
        .select("*", { count: "exact", head: true })
        .eq("status", "completed"),
      supabase
        .from("escalations")
        .select("*", { count: "exact", head: true })
        .eq("status", "open"),
    ]);

    setCounts({
      activeSessions: active ?? 0,
      completedSessions: completed ?? 0,
      openEscalations: openEsc ?? 0,
    });
  }, [supabase]);

  // ... render KPI cards with counts
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| supabase.from().on() (v1 API) | supabase.channel().on('postgres_changes', ...) | supabase-js v2 | Completely different API surface |
| Auth Helpers (@supabase/auth-helpers-nextjs) | @supabase/ssr | 2024 | SSR package is the recommended approach |
| Broadcast-only realtime | Postgres Changes with RLS | 2023-2024 | RLS policies enforced on realtime subscriptions |
| Manual publication setup | Supabase dashboard toggle | Recent | Can still use SQL, but dashboard has a toggle too |

**Deprecated/outdated:**
- `@supabase/auth-helpers-nextjs`: Replaced by `@supabase/ssr`. This project already uses `@supabase/ssr`.
- `supabase.from('table').on('*', callback)`: v1 realtime API. Use `supabase.channel().on('postgres_changes', ...)` instead.

## Open Questions

1. **Supabase project realtime enabled?**
   - What we know: Realtime is enabled by default on all Supabase projects
   - What's unclear: Whether this specific project has it enabled in the dashboard settings
   - Recommendation: Verify in Supabase dashboard under Project Settings > API > Realtime. If disabled, enable it.

2. **INSERT event for escalations includes client join data?**
   - What we know: Postgres Changes payload contains the raw row, not joined data. The `payload.new` for an escalation INSERT will have `client_id` but not `client.name`.
   - What's unclear: Whether to re-fetch with join on each INSERT or maintain a local client cache
   - Recommendation: On INSERT, do a quick `supabase.from('escalations').select('*, client:clients(name, business_name)').eq('id', payload.new.id).single()` to get the joined data. This is a single small query per event, acceptable at this scale.

3. **Dashboard page KPI recalculation strategy**
   - What we know: The dashboard has ~6 KPI counts derived from aggregates across multiple tables
   - What's unclear: Whether to try computing deltas from individual events or just re-fetch counts
   - Recommendation: Re-fetch the specific counts on any relevant table change. At admin dashboard scale (few concurrent users, small queries), this is simpler and more reliable than delta computation.

## Sources

### Primary (HIGH confidence)
- [Supabase Postgres Changes docs](https://supabase.com/docs/guides/realtime/postgres-changes) - Filter API, event types, RLS behavior, DELETE limitations
- [Supabase Realtime Authorization docs](https://supabase.com/docs/guides/realtime/authorization) - RLS policy caching, JWT handling, private channels
- [Supabase Subscribing to Database Changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes) - Publication setup SQL commands
- [Supabase SSR Client Creation](https://supabase.com/docs/guides/auth/server-side/creating-a-client) - createBrowserClient for realtime

### Secondary (MEDIUM confidence)
- [Supabase Realtime RLS blog post](https://supabase.com/blog/realtime-row-level-security-in-postgresql) - RLS enforcement details
- [Next.js 15 Supabase Realtime guide (dev.to)](https://dev.to/lra8dev/building-real-time-magic-supabase-subscriptions-in-nextjs-15-2kmp) - useEffect cleanup, App Router patterns

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - @supabase/supabase-js and @supabase/ssr already installed with exact versions verified in lockfile
- Architecture: HIGH - Server wrapper + client subscriber is the documented pattern for Next.js App Router + Supabase Realtime. Verified against official docs and community guides.
- Pitfalls: HIGH - DELETE filter limitation, publication requirement, and RLS caching behavior all confirmed in official Supabase docs
- Escalations org_id gap: HIGH - Confirmed by reading the actual migration SQL. The column does not exist.

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable APIs, supabase-js v2 is mature)
