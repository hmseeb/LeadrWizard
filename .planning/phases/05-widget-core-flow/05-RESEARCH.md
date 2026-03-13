# Phase 5: Widget Core Flow - Research

**Researched:** 2026-03-14
**Domain:** Embeddable React widget, step-by-step form flow, cross-origin API communication
**Confidence:** HIGH

## Summary

The widget codebase is already 70-80% built. All the components exist: `WizardWidget.tsx`, `ProgressBar.tsx`, `StepRenderer.tsx`, `VoiceBot.tsx`, `VoiceBotToggle.tsx`. The `useWizardSession.ts` hook loads sessions, calculates progress, determines the next question, and submits responses via the authenticated API route (`POST /api/widget/response`). The widget builds as a single IIFE bundle via Vite with CSS injected by JS, rendered inside a Shadow DOM for style isolation.

**What's missing is specific and identifiable.** The current widget reads session data directly from Supabase using the anon client (which now has its RLS policies removed per Phase 1's SEC-03), so the load path is broken. It needs a new server-side API endpoint (`GET /api/widget/session/[sessionId]`) that returns session + questions + responses in one payload. The widget also lacks: (1) retry logic with exponential backoff on submission failures (WIDG-05), (2) a proper completion screen with next-steps messaging (WIDG-04, current one is a minimal banner), (3) submitting state/loading indicators per step (WIDG-03), and (4) the step-by-step flow needs the session load to go through the API, not direct Supabase reads.

**Primary recommendation:** Create a session-loading API endpoint, refactor `useWizardSession` to use fetch-based reads instead of Supabase client reads, add retry logic with exponential backoff, and enhance the completion screen. The existing component structure is solid and should be preserved.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WIDG-01 | Widget loads session by sessionId, fetches questions from API, and renders step-by-step form with progress indicator | Need new GET /api/widget/session/[sessionId] endpoint. Current Supabase-direct read path is broken due to SEC-03 RLS removal. ProgressBar and StepRenderer components already exist. |
| WIDG-03 | Widget submits responses per step via authenticated API route, advances to next step on success | submitResponse in useWizardSession already calls POST /api/widget/response. Need loading/submitting state per step, and auto-advance after successful response. |
| WIDG-04 | Widget shows completion state with next-steps messaging after all required fields collected | StepRenderer handles action=complete but shows minimal "All Done!" message. Need richer completion screen with next-steps messaging. The banner in WizardWidget is also minimal. |
| WIDG-05 | Widget handles errors per step with retry (3 attempts, exponential backoff) and fallback message if all fail | No retry logic exists. submitResponse throws on failure. Need retry wrapper with exponential backoff (delays: 1s, 2s, 4s) and UI error state with fallback message. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.0.0 | UI rendering | Already installed in widget |
| Vite | ^6.0.0 | Build toolchain | Already configured, IIFE bundle output |
| @supabase/supabase-js | ^2.49.0 | Will be REMOVED from widget read path | Phase 1 removed anon RLS policies, so direct reads are broken |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vite-plugin-css-injected-by-js | ^3.5.0 | CSS bundled into JS for single-file widget | Already configured |
| @leadrwizard/shared | workspace:* | Shared types (AgentDecision, DataFieldDefinition, etc.) | Already used for type imports |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom retry logic | p-retry or retry-axios | Overkill for 3 retries with simple exponential backoff. 15 lines of custom code vs adding a dependency to the widget bundle |
| Custom fetch wrapper | tanstack-query | Would add ~13KB to the widget bundle. Not worth it for 2 API calls total |

**Installation:**
No new packages needed. The widget already has everything required.

## Architecture Patterns

### Current Widget Architecture (preserve this)
```
apps/widget/src/
  main.tsx              # Entry point, LeadrWizard.init(), Shadow DOM setup
  hooks/
    useWizardSession.ts # Session state, question flow, response submission
  components/
    WizardWidget.tsx    # Main orchestrator component
    ProgressBar.tsx     # Visual progress indicator per service
    StepRenderer.tsx    # Renders current question (text input or multi-choice)
    VoiceBot.tsx        # ElevenLabs voice integration (Phase 6 scope)
    VoiceBotToggle.tsx  # Voice/Visual mode switcher (Phase 6 scope)
  styles/
    widget.css          # All widget styles (injected into Shadow DOM)
```

### Pattern 1: Fetch-Based Session Loading (replaces Supabase reads)
**What:** New API endpoint returns all session data in one request. Widget uses `fetch()` not Supabase client.
**When to use:** Always. The Supabase anon client can no longer read session data due to RLS hardening (SEC-03).
**Why:** The widget runs on third-party domains. Exposing Supabase URL/anon key to third parties is a security risk even if RLS would block reads. The fetch-based write path (submitResponse) already works this way, so reads should match.

```typescript
// New: GET /api/widget/session/[sessionId]/route.ts
// Returns: { session, client, services: ServiceWithProgress[], completionPct }
// Uses service role client (createServerClient) to bypass RLS

// Widget side: useWizardSession refactored
const loadSession = async () => {
  const res = await fetch(`${apiBaseUrl}/api/widget/session/${sessionId}`);
  if (!res.ok) throw new Error("Session not found");
  const data = await res.json();
  // data contains: session, client, services (with definitions + responses + missingFields), completionPct, currentQuestion
};
```

### Pattern 2: Step-by-Step Question Flow
**What:** The widget shows one question at a time. Questions are derived from `required_data_fields` across all services for the client.
**How it works today:**
1. Load session -> get client_services -> join with service_definitions
2. For each service, get `required_data_fields` where `required: true`
3. Cross-reference with `session_responses` to find answered fields
4. `missingFields` = required fields not yet answered
5. `currentQuestion` = first missing field from first service with missing fields
6. After submission, reload session -> next missing field becomes current question
7. When no missing fields remain, `currentQuestion.action = "complete"`

**This flow is correct and already implemented in `useWizardSession`.** The only change needed is moving the data assembly from client-side Supabase queries to a server-side API endpoint.

### Pattern 3: Retry with Exponential Backoff
**What:** Wrap `submitResponse` with retry logic. 3 attempts, delays of 1s, 2s, 4s.
**When to use:** Every step submission.

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}
```

### Anti-Patterns to Avoid
- **Direct Supabase reads from widget:** The anon RLS policies were removed in Phase 1. The widget cannot read from Supabase directly. All reads must go through the admin app's API routes.
- **Storing Supabase credentials in the widget:** The `supabaseUrl` and `supabaseKey` props should be removed from the widget config for the read path. They were only needed when the widget did direct reads.
- **Polling for next question:** After submission, reload the session data from the API. Do not poll. The loadSession callback already handles this.
- **Client-side completion detection without server validation:** The completion percentage should be calculated server-side in the session endpoint to be authoritative.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Progress calculation | Custom widget-side logic | Server-side calculation in API endpoint (reuse `checkCompletion` from `@leadrwizard/shared/agent`) | The `completion-checker.ts` already exists and is tested. Use it server-side, return results to widget. |
| Question ordering | Custom ordering algorithm | Existing pattern: iterate services, find first with missing fields, return first missing field | Already implemented correctly in `useWizardSession`. Just move to server-side. |
| Shadow DOM styling | Manual style injection | `vite-plugin-css-injected-by-js` + `getWidgetStyles()` in main.tsx | Already working, handles theme variables |
| CORS handling | Custom middleware | Existing pattern in `POST /api/widget/response/route.ts` | Copy the same CORS headers pattern for the new GET endpoint |

**Key insight:** Most of the logic already exists. The work is (1) creating a server-side session endpoint, (2) refactoring the hook to use fetch reads, (3) adding retry logic, and (4) enhancing the completion UI. This is a wiring/refactoring phase, not a build-from-scratch phase.

## Common Pitfalls

### Pitfall 1: Supabase Anon Client Reads Will Silently Fail
**What goes wrong:** The widget tries to read from Supabase with the anon key. RLS policies for anon inserts/updates were dropped in migration 00005. Select policies require `auth.uid()` matching org_members. The anon client has no auth.uid(). Result: empty data, no error.
**Why it happens:** The original widget was built before Phase 1 security hardening.
**How to avoid:** Remove all Supabase `.from().select()` calls from the widget hook. Replace with fetch calls to API endpoints.
**Warning signs:** `session` is null, `services` is empty, no error thrown.

### Pitfall 2: CORS Missing on GET Endpoint
**What goes wrong:** Widget makes fetch request from third-party domain to admin app API. Browser blocks it with CORS error.
**Why it happens:** Next.js API routes don't have CORS headers by default. The POST route has them, but a new GET route won't unless explicitly added.
**How to avoid:** Copy the exact CORS pattern from the existing POST route. Include OPTIONS handler.
**Warning signs:** Network tab shows "CORS error", widget shows generic error.

### Pitfall 3: Race Condition on Rapid Submissions
**What goes wrong:** User clicks "Next" rapidly. Multiple submissions fire. Session state becomes inconsistent.
**Why it happens:** `submitResponse` is async. No debounce or submission-in-progress guard.
**How to avoid:** Add `submitting` state to the hook. Disable submit button while submitting. The `StepRenderer` already has a disabled state on the button.
**Warning signs:** Duplicate responses in session_responses table.

### Pitfall 4: Widget Bundle Size Creep
**What goes wrong:** Adding @supabase/supabase-js to widget for reads when it's only needed for one fetch call. The Supabase client is ~50KB gzipped.
**Why it happens:** Path of least resistance is to keep using the existing Supabase client.
**How to avoid:** Remove @supabase/supabase-js dependency from widget entirely (it's only used in useWizardSession for reads). Use plain fetch for both reads and writes. This shrinks the widget bundle significantly.
**Warning signs:** `widget.js` over 100KB gzipped.

### Pitfall 5: Completion State Not Updating session.status
**What goes wrong:** Widget shows completion UI but the session remains "active" in the database.
**Why it happens:** Nothing in the current flow updates `onboarding_sessions.status` to "completed".
**How to avoid:** When the API detects all required fields are collected, update session status to "completed" and set `completion_pct` to 100. Do this in the response submission handler or in the session-load endpoint (detect and update).
**Warning signs:** Dashboard shows session as "active" even after client sees completion screen.

## Code Examples

### Current Data Flow (what exists)
```typescript
// useWizardSession.ts loads via Supabase client (BROKEN, needs refactor)
// 1. supabase.from("onboarding_sessions").select("*").eq("id", sessionId)
// 2. supabase.from("clients").select("*").eq("id", session.client_id)
// 3. supabase.from("client_services").select("*, service:service_definitions(*)").eq("client_id", session.client_id)
// 4. supabase.from("session_responses").select("*").eq("session_id", sessionId)
// 5. Calculates missingFields, currentQuestion, completionPct client-side

// submitResponse works via fetch (CORRECT, keep as-is)
// fetch(`${apiBaseUrl}/api/widget/response`, { method: "POST", ... })
```

### New Session Load API Endpoint
```typescript
// apps/admin/src/app/api/widget/session/[sessionId]/route.ts

import { NextResponse } from "next/server";
import { createServerClient } from "@leadrwizard/shared/supabase";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const supabase = createServerClient();

  // Load session
  const { data: session } = await supabase
    .from("onboarding_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("status", "active")
    .maybeSingle();

  if (!session) {
    return NextResponse.json(
      { error: "Session not found or not active" },
      { status: 404, headers: corsHeaders }
    );
  }

  // Load client
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, email, business_name")
    .eq("id", session.client_id)
    .single();

  // Load client services with service definitions
  const { data: clientServices } = await supabase
    .from("client_services")
    .select("*, service:service_definitions(*)")
    .eq("client_id", session.client_id)
    .eq("opted_out", false);

  // Load existing responses
  const { data: responses } = await supabase
    .from("session_responses")
    .select("*")
    .eq("session_id", sessionId);

  // Calculate progress server-side (same logic as widget hook)
  // ... build services array with missingFields, pct
  // ... determine currentQuestion
  // ... calculate overall completionPct

  return NextResponse.json({
    session,
    client,
    services: /* processed services with progress */,
    currentQuestion,
    completionPct,
  }, { headers: corsHeaders });
}
```

### Refactored useWizardSession (fetch-based)
```typescript
// Key change: replace all supabase.from() reads with a single fetch call
const loadSession = useCallback(async () => {
  try {
    const res = await fetch(`${apiBaseUrl}/api/widget/session/${sessionId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Session not found" }));
      throw new Error(err.error || "Failed to load session");
    }
    const data = await res.json();
    setState({
      loading: false,
      error: null,
      client: data.client,
      session: data.session,
      services: data.services,
      currentQuestion: data.currentQuestion,
      completionPct: data.completionPct,
      mode: "visual", // Default to visual for Phase 5 (voice is Phase 6)
    });
  } catch (err) {
    setState(s => ({ ...s, loading: false, error: err.message }));
  }
}, [apiBaseUrl, sessionId]);
```

### Retry Wrapper for Submissions
```typescript
// In useWizardSession.ts
const submitResponse = useCallback(async (
  fieldKey: string,
  fieldValue: string,
  clientServiceId: string | null,
  answeredVia: "click" | "voice" = "click"
) => {
  setState(s => ({ ...s, submitting: true, stepError: null }));

  const submit = async () => {
    const res = await fetch(`${apiBaseUrl}/api/widget/response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, fieldKey, fieldValue, clientServiceId, answeredVia }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(err.error || "Failed to submit response");
    }
  };

  try {
    await withRetry(submit, 3, 1000);
    await loadSession(); // Reload to get next question
  } catch (err) {
    setState(s => ({
      ...s,
      submitting: false,
      stepError: "We couldn't save your response. Please try again or contact support.",
    }));
  }
}, [apiBaseUrl, sessionId, loadSession]);
```

### Enhanced Completion Screen
```typescript
// StepRenderer.tsx or new CompletionScreen.tsx
if (question.action === "complete") {
  return (
    <div className="lw-step lw-complete">
      <div className="lw-complete-icon">&#10003;</div>
      <h3 className="lw-step-title">You're all set!</h3>
      <p className="lw-step-message">
        We've collected everything we need. Your services are now being set up.
      </p>
      <div className="lw-next-steps">
        <h4>What happens next?</h4>
        <ul>
          <li>Our team will begin setting up your services</li>
          <li>You'll receive updates via email as each service is ready</li>
          <li>If we need anything else, we'll reach out</li>
        </ul>
      </div>
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Supabase anon reads from widget | API endpoint reads (service role) | Phase 1, migration 00005 | Widget can no longer read Supabase directly |
| Direct anon inserts for responses | POST /api/widget/response | Phase 1, SEC-05 | Already implemented, submitResponse uses fetch |
| Voice mode as default | Visual (form) mode default | Phase 5 | Voice is Phase 6 scope. Default to visual for now |

**Deprecated/outdated:**
- `supabaseUrl` and `supabaseKey` props on WizardWidget: No longer needed if all reads go through API
- Supabase client creation in useWizardSession: Can be removed entirely
- `@supabase/supabase-js` dependency in widget package.json: Can be removed (saves ~50KB in bundle)

## Key Data Model Relationships

Understanding how steps are derived from the database:

```
onboarding_sessions (1) --> client_id --> clients (1)
clients (1) --> client_services (many) --> service_definitions (1 each)
service_definitions.required_data_fields: DataFieldDefinition[]  <-- THESE ARE THE QUESTIONS
session_responses (many) --> field_key matches DataFieldDefinition.key

Steps = flatten(all service_definitions.required_data_fields where required=true)
       - filter out fields already answered in session_responses
       = remaining questions presented one at a time
```

DataFieldDefinition types determine the input UI:
- `text`, `email`, `phone`, `url`: text input
- `textarea`: textarea input
- `select`: multiple choice (options array)
- `file`: file upload (not implemented yet, can be deferred)

## Open Questions

1. **Session status update on completion**
   - What we know: Nothing currently updates `onboarding_sessions.status` to "completed" when all fields are collected
   - What's unclear: Should the API do this automatically, or should it be a separate admin action?
   - Recommendation: Auto-update in the response submission handler. When the last required field is submitted, set `status = "completed"` and `completion_pct = 100`. This is the natural place and avoids stale state.

2. **Removing Supabase dependency from widget**
   - What we know: The widget currently imports `@supabase/supabase-js` for reads. If we move reads to API, the dependency is unused.
   - What's unclear: Should we remove it now or keep it for potential Phase 6 realtime subscriptions?
   - Recommendation: Remove it now. Phase 6 (voice) doesn't need Supabase client either. If realtime is needed later, it can be re-added. Removing saves significant bundle size.

3. **Voice/Visual mode toggle in Phase 5**
   - What we know: Voice is Phase 6 scope. The toggle and VoiceBot components exist.
   - What's unclear: Should Phase 5 hide the voice toggle or leave it but non-functional?
   - Recommendation: Default to visual mode. Keep the voice toggle hidden or disabled until Phase 6. Don't remove the components, just don't render the toggle in Phase 5.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all widget source files
- Database schema from `supabase/migrations/00001_initial_schema.sql`
- RLS hardening from `supabase/migrations/00005_rls_hardening.sql`
- Existing API route `apps/admin/src/app/api/widget/response/route.ts`
- Shared types `packages/shared/src/types/index.ts`
- Completion checker `packages/shared/src/agent/completion-checker.ts`
- Widget Vite config `apps/widget/vite.config.ts`
- Widget package.json `apps/widget/package.json`

### Secondary (MEDIUM confidence)
- Next.js 15 dynamic route params pattern (params is a Promise in Next.js 15+, must be awaited)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - direct codebase inspection, everything already installed
- Architecture: HIGH - existing patterns are clear and well-structured
- Pitfalls: HIGH - identified from actual broken code paths (RLS removal, CORS requirements)
- Data model: HIGH - verified against SQL migrations and TypeScript types

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable, no rapidly changing dependencies)
