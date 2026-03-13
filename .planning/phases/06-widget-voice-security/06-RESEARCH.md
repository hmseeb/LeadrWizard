# Phase 6: Widget Voice + Security - Research

**Researched:** 2026-03-14
**Domain:** ElevenLabs voice integration, voice/form hybrid session state, embedded widget origin validation
**Confidence:** HIGH

## Summary

Phase 6 adds two capabilities to the existing widget: (1) voice/form hybrid mode where clients can switch between ElevenLabs voice and form-based data collection mid-session without losing progress, and (2) origin validation via an `allowedOrigins` parameter in `init()` that prevents the widget from loading on unauthorized domains.

The codebase is well-positioned for this work. `VoiceBot.tsx` already implements a working ElevenLabs Conversational AI integration via raw WebSocket: it handles signed URL acquisition, microphone capture, PCM16 audio streaming, agent audio playback, transcript display, and client tool calls (`recordAnswer`, `advanceToNextItem`, `requestCallback`). `VoiceBotToggle.tsx` provides a clean voice/visual mode switcher. `useWizardSession.ts` already tracks `mode: "voice" | "visual"` in its state and exposes a `setMode` function. The `submitResponse` function already accepts `answeredVia: "click" | "voice"`. Phase 5 deliberately hid these components but preserved them for Phase 6.

The main work is: (a) re-enabling the VoiceBotToggle and VoiceBot in WizardWidget, (b) wiring VoiceBot's `onAnswer` callback to call `submitResponse` so voice answers persist through the same API pipeline as form answers, (c) ensuring the session auto-reloads after voice answers so the form view stays in sync, and (d) adding origin validation at the `init()` entry point. The existing `VoiceBot.tsx` has one known issue: it uses the deprecated `createScriptProcessor` API for audio capture, which should be noted but is not a blocker since all browsers still support it.

**Primary recommendation:** Re-enable existing VoiceBot/VoiceBotToggle components in WizardWidget, wire voice answers to `submitResponse`, and add `allowedOrigins` validation in `init()` using `window.location.ancestorOrigins` + `document.referrer` fallback. Use the existing raw WebSocket implementation rather than switching to `@elevenlabs/react` SDK to avoid adding a dependency and rewriting working code.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WIDG-02 | Widget supports voice + form hybrid: ElevenLabs voice AND form-based data collection in same session, client can switch mode mid-flow | VoiceBot.tsx already integrates ElevenLabs WebSocket API with client tools. VoiceBotToggle.tsx provides mode switcher. useWizardSession already tracks mode state. Main gap: wiring VoiceBot.onAnswer to submitResponse, syncing session state on voice answer, and re-enabling these components in WizardWidget. |
| WIDG-06 | Widget supports optional `allowedOrigins` parameter in `init()` to prevent embedding on unauthorized domains | No origin validation exists currently. Need to add `allowedOrigins?: string[]` to LeadrWizardConfig in main.tsx. Validate using `window.location.ancestorOrigins` (preferred, Chromium) with `document.referrer` fallback (Firefox). Refuse to render and log warning if origin not in list. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.0.0 | UI rendering | Already installed in widget |
| Vite | ^6.0.0 | Build toolchain, IIFE bundle | Already configured |
| @leadrwizard/shared | workspace:* | Shared types (AgentDecision, DataFieldDefinition, etc.) | Already used |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vite-plugin-css-injected-by-js | ^3.5.0 | CSS bundled into JS for single-file widget | Already configured |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw WebSocket (current VoiceBot.tsx) | @elevenlabs/react useConversation hook | Would add ~20KB+ to widget bundle. Current raw WS implementation already works correctly. useConversation abstracts WebRTC/WS but VoiceBot.tsx only needs WS. Not worth the rewrite. |
| Raw WebSocket (current VoiceBot.tsx) | @11labs/client Conversation.startSession | Same tradeoff as above. The raw implementation handles audio capture, playback, and client tools already. Adding SDK adds dependency + bundle size for marginal benefit. |
| Web Speech API for STT | ElevenLabs built-in STT | ElevenLabs already handles speech-to-text via its WebSocket. Web Speech API would be redundant and has limited browser support (Chromium-only). |
| Custom origin validation | iframe sandbox/CSP | Widget loads as a script tag, not an iframe. CSP is set by the host page, not the widget. Must use runtime JS validation. |

**Installation:**
No new packages needed. The widget already has everything required. The ElevenLabs integration uses direct WebSocket, not an SDK dependency.

## Architecture Patterns

### Current Widget Architecture (preserved from Phase 5, with voice re-enabled)
```
apps/widget/src/
  main.tsx              # Entry point, LeadrWizard.init(), Shadow DOM, origin validation
  hooks/
    useWizardSession.ts # Session state, mode tracking, response submission
  components/
    WizardWidget.tsx    # Main orchestrator: form or voice based on mode
    ProgressBar.tsx     # Visual progress per service
    StepRenderer.tsx    # Form-mode question rendering
    VoiceBot.tsx        # ElevenLabs voice mode (WebSocket + audio)
    VoiceBotToggle.tsx  # Voice/Visual mode switcher
  styles/
    widget.css          # All widget styles (injected into Shadow DOM)
```

### Pattern 1: Voice/Form Hybrid Session State
**What:** Both voice and form modes share the same `useWizardSession` hook state. Voice answers go through `submitResponse` the same as form answers. Switching modes preserves all collected data because the source of truth is the server (session_responses table).
**When to use:** Always. This is the core architecture for WIDG-02.

```typescript
// In WizardWidget.tsx
const { mode, setMode, submitResponse, currentQuestion, services } = useWizardSession(sessionId, apiBaseUrl);

// Voice mode: VoiceBot.onAnswer calls submitResponse
<VoiceBot
  sessionId={sessionId}
  isActive={mode === "voice"}
  agentId={elevenlabsAgentId}
  onAnswer={(fieldKey, value) => {
    // Find the matching service for the current question
    const serviceMatch = services.find(
      (s) => s.missingFields.some((f) => f.key === fieldKey)
    );
    submitResponse(fieldKey, value, serviceMatch?.clientServiceId || null, "voice");
  }}
/>

// Form mode: StepRenderer.onSubmit calls submitResponse
<StepRenderer onSubmit={(value) => submitResponse(fieldKey, value, csId, "click")} />
```

**Key insight:** The session reloads from the server after every `submitResponse` call (both form and voice). This means switching from voice to form mode automatically shows the correct next question because `loadSession()` is called after submission. No manual sync needed.

### Pattern 2: Origin Validation at init()
**What:** Before mounting the React app, validate that the widget is embedded on an allowed domain. If `allowedOrigins` is provided and the current origin is not in the list, render nothing and log a console error.
**When to use:** When `allowedOrigins` is provided in the config. If omitted, skip validation (backwards compatible).

```typescript
// In main.tsx init()
function validateOrigin(allowedOrigins?: string[]): boolean {
  if (!allowedOrigins || allowedOrigins.length === 0) return true;

  // Method 1: window.location.ancestorOrigins (Chromium-based browsers)
  // This is the most reliable for detecting embedding context
  if (window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0) {
    const parentOrigin = window.location.ancestorOrigins[0];
    return allowedOrigins.some((o) => parentOrigin === o);
  }

  // Method 2: document.referrer fallback (Firefox, Safari)
  if (document.referrer) {
    try {
      const referrerOrigin = new URL(document.referrer).origin;
      return allowedOrigins.some((o) => referrerOrigin === o);
    } catch {
      return false;
    }
  }

  // Method 3: window.location.origin (direct page load, not embedded)
  // If the widget script is loaded directly (not in iframe), check the page origin
  return allowedOrigins.some((o) => window.location.origin === o);
}
```

**Important distinction:** The widget loads as a `<script>` tag injected into the host page, NOT in an iframe. It executes in the host page's JS context. So `window.location.origin` IS the host page's origin when loaded directly. For iframe embedding scenarios, `ancestorOrigins` or `referrer` is needed.

### Pattern 3: ElevenLabs Agent ID Resolution
**What:** The ElevenLabs agent ID can come from multiple sources. The per-org `elevenlabs_agent_id` is stored in the database (Phase 4 added this). The widget needs to receive it somehow.
**When to use:** When voice mode is enabled.

Resolution order:
1. `agentId` passed explicitly in `init()` config (highest priority)
2. Session API response includes org's `elevenlabs_agent_id` (add to session endpoint response)
3. Meta tag `<meta name="leadrwizard:elevenlabs-agent-id">` in host page (existing fallback in VoiceBot.tsx)

**Recommendation:** Extend the session API endpoint to include the org's `elevenlabs_agent_id` in the response. This is the cleanest approach because: (a) the widget already fetches session data from the API, (b) the org's ElevenLabs agent ID is stored in the database (Phase 4), and (c) it avoids requiring embedders to pass an extra config parameter.

```typescript
// Extend GET /api/widget/session/[sessionId] to include:
// 1. Load org for the session
// 2. Return elevenlabs_agent_id in response

return NextResponse.json({
  session: { ... },
  client: { ... },
  services: [ ... ],
  currentQuestion,
  completionPct,
  voiceConfig: {
    elevenlabsAgentId: org.elevenlabs_agent_id || null,
  },
});
```

### Anti-Patterns to Avoid
- **Separate state for voice and form answers:** Both modes MUST use the same `submitResponse` pipeline. Do NOT maintain a parallel "voice answers" list. The server is the single source of truth.
- **Polling for voice answer confirmation:** After `onAnswer` fires, `submitResponse` calls the API and `loadSession()` reloads state. Do not poll.
- **Blocking the main thread with ScriptProcessor:** The current `VoiceBot.tsx` uses `createScriptProcessor` which runs audio processing on the main thread. This is deprecated but still functional. Do NOT add AudioWorklet for Phase 6, as it adds significant complexity (separate worklet file, module loading) for minimal real-world benefit in this use case.
- **Wildcard in allowedOrigins:** Never auto-allow `*`. If `allowedOrigins` is an empty array, treat it as "no restrictions" only if not provided. If provided as empty array `[]`, block all origins.
- **Client-side only origin check:** The `init()` origin check prevents rendering but a determined attacker could bypass JS checks. Server-side `Origin` header validation on the API endpoints provides defense in depth. This is a future enhancement, not Phase 6 scope.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio capture + streaming | Custom MediaRecorder/AudioWorklet pipeline | Existing `startAudioCapture()` in VoiceBot.tsx | Already works. Uses ScriptProcessor (deprecated but functional). Switching to AudioWorklet is unnecessary complexity for Phase 6. |
| Audio playback from PCM16 base64 | Custom audio player | Existing `playAudioChunk()` in VoiceBot.tsx | Already decodes base64 PCM16 to Float32 and plays via AudioContext BufferSource. |
| ElevenLabs tool call handling | Custom protocol parser | Existing `handleToolCall()` in VoiceBot.tsx | Already handles `recordAnswer`, `advanceToNextItem`, `requestCallback` with correct WebSocket response format. |
| Signed URL acquisition | Custom auth flow | Existing fetch to `api.elevenlabs.io/v1/convai/conversation/get_signed_url` in VoiceBot.tsx | Already implemented. 15-minute expiry. |
| Origin validation | npm package for origin detection | Simple `window.location.ancestorOrigins` + `document.referrer` check | Two APIs, ~15 lines of code. No library needed. |
| Mode persistence across page loads | localStorage/cookie | Don't persist. Default to "visual" on each page load | Voice mode requires active microphone session. Cannot "resume" a voice session. Default to form mode. |

**Key insight:** VoiceBot.tsx is a fully working ElevenLabs integration. The work is NOT building voice support. It's wiring the existing voice component into the shared session state so voice answers flow through the same pipeline as form answers.

## Common Pitfalls

### Pitfall 1: Voice Answers Not Persisting Through API
**What goes wrong:** VoiceBot's `onAnswer` callback fires with `(fieldKey, value)` but nothing calls `submitResponse`. The voice answer is shown in transcript but never saved to the database.
**Why it happens:** VoiceBot currently calls `onAnswer` prop when `recordAnswer` tool fires, but the existing VoiceBot has never been wired to the shared `submitResponse` pipeline.
**How to avoid:** Wire VoiceBot's `onAnswer` prop in WizardWidget to call `submitResponse` with `answeredVia: "voice"`. This ensures voice answers go through the same API route with retry logic and session reload.
**Warning signs:** User answers questions via voice, switches to form mode, and sees the same questions again.

### Pitfall 2: Session State Stale After Voice Answer
**What goes wrong:** User answers via voice, VoiceBot's transcript shows the answer, but `currentQuestion` still shows the same question. When user switches to form mode, they see a question they already answered.
**Why it happens:** `submitResponse` calls `loadSession()` which reloads all state from the server. But if `submitResponse` is not called (see Pitfall 1), or if the voice answer callback doesn't trigger a session reload, state goes stale.
**How to avoid:** Ensure `onAnswer` calls `submitResponse` which already calls `loadSession()` at the end. The auto-reload mechanism is already built into the hook.
**Warning signs:** Form mode shows previously answered questions after voice interaction.

### Pitfall 3: Race Condition Between Voice and Form Submissions
**What goes wrong:** User is in voice mode, agent fires `recordAnswer`, but user simultaneously switches to form mode and submits a form answer. Two `submitResponse` calls race.
**Why it happens:** The voice WebSocket operates independently from the form UI. Both can trigger `submitResponse` at the same time.
**How to avoid:** The existing `submitting` guard in `useWizardSession` prevents double-submission. When voice calls `submitResponse`, the guard is set. If the user switches to form and tries to submit while `submitting === true`, the form submission is blocked. This is already handled.
**Warning signs:** Duplicate responses in session_responses table.

### Pitfall 4: Microphone Permission Denied Silently
**What goes wrong:** User clicks voice mode toggle. VoiceBot starts but microphone permission is denied. No visible error.
**Why it happens:** `navigator.mediaDevices.getUserMedia` throws `NotAllowedError` which VoiceBot already catches and shows an error message.
**How to avoid:** VoiceBot already handles this. The `catch` block checks for `DOMException` with `name === "NotAllowedError"` and shows a specific message. Verify this error is visible in the widget UI (it's inside `.lw-voice-error` CSS class which exists in the stylesheet).
**Warning signs:** User sees "Start Voice Onboarding" button, clicks it, nothing happens.

### Pitfall 5: allowedOrigins Bypassed by Direct Script Load
**What goes wrong:** Widget checks `window.location.origin` but attacker loads `widget.js` directly in their page (not iframe). Since it's a script tag, `window.location.origin` IS the attacker's origin.
**Why it happens:** Script tag execution happens in the host page's context. The `window.location.origin` check works correctly here: it will check the host page's origin against `allowedOrigins`. If the attacker's domain is not in `allowedOrigins`, the check blocks rendering.
**How to avoid:** This is actually the correct behavior. The check works for both direct script inclusion and iframe embedding. For direct script inclusion, `window.location.origin` IS the host origin. For iframes, `ancestorOrigins` or `referrer` gives the parent origin.
**Warning signs:** None. This works correctly.

### Pitfall 6: Origin Validation Breaking Dev Mode
**What goes wrong:** Developer running locally at `http://localhost:5173` has `allowedOrigins: ["https://client-site.com"]`. Widget refuses to render in dev.
**Why it happens:** Localhost origin doesn't match allowed origins.
**How to avoid:** When `allowedOrigins` is not provided (undefined), skip validation entirely. In the dev HTML file (`apps/widget/index.html`), don't pass `allowedOrigins`. Only production embedders set it. Additionally, consider treating `localhost` origins as always allowed when `NODE_ENV !== "production"`, but this is risky. Better approach: just don't pass `allowedOrigins` in dev.
**Warning signs:** Widget shows "Unauthorized domain" error in dev mode.

### Pitfall 7: VoiceBot ElevenLabs API Key Exposure
**What goes wrong:** VoiceBot directly calls the ElevenLabs signed URL API: `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=X`. This endpoint is public and does not require an API key for public agents. For private agents, the signed URL must be obtained server-side.
**Why it happens:** The current VoiceBot.tsx fetches the signed URL directly from the client. This works for public ElevenLabs agents but not for private ones.
**How to avoid:** For Phase 6, keep the direct fetch for public agents. If the org has a private agent, add a server-side proxy endpoint that generates the signed URL using the org's API key. This is a future enhancement unless the org's agent is private.
**Warning signs:** 401 errors from ElevenLabs signed URL endpoint.

## Code Examples

### Re-enabling Voice Mode in WizardWidget.tsx

```typescript
// WizardWidget.tsx - key changes from Phase 5 version
import { VoiceBotToggle } from "./VoiceBotToggle";
import { VoiceBot } from "./VoiceBot";

export function WizardWidget({ sessionId, apiBaseUrl }: WizardWidgetProps) {
  const {
    loading, error, client, session, services,
    currentQuestion, completionPct, mode, setMode,
    submitResponse, submitting, stepError, clearStepError,
    voiceConfig, // NEW: from session API response
  } = useWizardSession(sessionId, apiBaseUrl);

  // ... loading/error states unchanged ...

  // Determine if voice is available (org has ElevenLabs agent configured)
  const voiceAvailable = !!voiceConfig?.elevenlabsAgentId;

  return (
    <div className="lw-widget">
      {/* Header */}
      {/* ... unchanged ... */}

      {/* Progress */}
      <ProgressBar completionPct={completionPct} services={services} />

      {/* Mode Toggle (only shown when voice is available and session not complete) */}
      {voiceAvailable && currentQuestion?.action !== "complete" && (
        <VoiceBotToggle mode={mode} onToggle={setMode} />
      )}

      {/* Voice Mode */}
      {mode === "voice" && voiceAvailable && (
        <VoiceBot
          sessionId={sessionId}
          isActive={true}
          agentId={voiceConfig.elevenlabsAgentId!}
          onAnswer={(fieldKey, value) => {
            const serviceMatch = services.find(
              (s) => s.missingFields.some((f) => f.key === fieldKey)
            );
            submitResponse(
              fieldKey,
              value,
              serviceMatch?.clientServiceId || null,
              "voice"
            );
          }}
        />
      )}

      {/* Form Mode (or fallback when voice not available) */}
      {mode === "visual" && currentQuestion && (
        <StepRenderer
          question={currentQuestion}
          submitting={submitting}
          stepError={stepError}
          onSubmit={(value) => {
            if (currentQuestion.field_key) {
              const serviceMatch = services.find(
                (s) => s.serviceId === currentQuestion.service_id
              );
              submitResponse(
                currentQuestion.field_key,
                value,
                serviceMatch?.clientServiceId || null,
                "click"
              );
            }
          }}
          onRetry={clearStepError}
        />
      )}
    </div>
  );
}
```

### Origin Validation in init()

```typescript
// main.tsx - updated init function
export interface LeadrWizardConfig {
  sessionId: string;
  containerId: string;
  apiBaseUrl: string;
  allowedOrigins?: string[];  // NEW: optional origin whitelist
  theme?: {
    primaryColor?: string;
    borderRadius?: string;
    fontFamily?: string;
  };
}

function validateOrigin(allowedOrigins?: string[]): boolean {
  // If not provided, allow all (backwards compatible)
  if (!allowedOrigins || allowedOrigins.length === 0) return true;

  // Determine the embedding origin
  let embeddingOrigin: string | null = null;

  // Prefer ancestorOrigins (Chrome, Edge, Safari)
  if (
    typeof window !== "undefined" &&
    window.location.ancestorOrigins &&
    window.location.ancestorOrigins.length > 0
  ) {
    embeddingOrigin = window.location.ancestorOrigins[0];
  }
  // Fallback to referrer (Firefox)
  else if (document.referrer) {
    try {
      embeddingOrigin = new URL(document.referrer).origin;
    } catch {
      // Invalid referrer URL
    }
  }
  // Direct page load: use window.location.origin
  else {
    embeddingOrigin = window.location.origin;
  }

  if (!embeddingOrigin) return false;

  return allowedOrigins.includes(embeddingOrigin);
}

function init(config: LeadrWizardConfig) {
  // Origin validation BEFORE any DOM manipulation
  if (!validateOrigin(config.allowedOrigins)) {
    console.error(
      `[LeadrWizard] Widget blocked: current origin is not in allowedOrigins.`
    );
    const container = document.getElementById(config.containerId);
    if (container) {
      container.innerHTML = "";  // Clear container
    }
    return;
  }

  const container = document.getElementById(config.containerId);
  if (!container) {
    console.error(`[LeadrWizard] Container #${config.containerId} not found`);
    return;
  }

  // ... rest of Shadow DOM setup unchanged ...
}
```

### Extending Session API for Voice Config

```typescript
// In GET /api/widget/session/[sessionId]/route.ts
// After loading session, also load the org's ElevenLabs agent ID

const { data: org } = await supabase
  .from("organizations")
  .select("elevenlabs_agent_id")
  .eq("id", session.org_id)
  .single();

return NextResponse.json({
  session: { ... },
  client: { ... },
  services: [ ... ],
  currentQuestion,
  completionPct,
  voiceConfig: {
    elevenlabsAgentId: org?.elevenlabs_agent_id || null,
  },
}, { headers: corsHeaders });
```

### Extending useWizardSession for Voice Config

```typescript
// In useWizardSession.ts
export interface WizardSessionState {
  // ... existing fields ...
  voiceConfig: { elevenlabsAgentId: string | null } | null;
}

// In loadSession callback:
setState((s) => ({
  ...s,
  // ... existing fields ...
  voiceConfig: data.voiceConfig || null,
}));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `createScriptProcessor` for audio capture | `AudioWorkletNode` (recommended) | Chrome 64+, 2018 | ScriptProcessor deprecated but still works. VoiceBot uses it. Not worth migrating for Phase 6. |
| Custom WebSocket handling for ElevenLabs | `@elevenlabs/react` useConversation hook | 2024-2025 | Official SDK exists (@elevenlabs/react@0.14.2 as of March 2026). But custom WS implementation already works. Migration adds dependency, no new capability. |
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` env var | Per-org `elevenlabs_agent_id` in database | Phase 4 (migration 00008) | Each org has its own ElevenLabs agent. Widget should get agent ID from session API, not env var. |
| No origin validation | `allowedOrigins` in init() | Phase 6 (this phase) | Prevents unauthorized embedding. Client-side check with server-side Origin header validation as future enhancement. |

**Deprecated/outdated:**
- `createScriptProcessor` in VoiceBot.tsx: Deprecated in spec, replaced by AudioWorkletNode. Still functional in all browsers. Not a blocker for Phase 6.
- `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` env var: Per-org agent IDs are now in the database. VoiceBot should get its agent ID from the session API response, not from env vars or meta tags.
- `getMetaContent("leadrwizard:elevenlabs-agent-id")` in VoiceBot.tsx: Fallback that reads from `<meta>` tag. Unnecessary when agent ID comes from session API.

## Open Questions

1. **Signed URL for private ElevenLabs agents**
   - What we know: VoiceBot.tsx fetches the signed URL directly from `api.elevenlabs.io` using just the agent_id. This works for public agents.
   - What's unclear: If an org configures a private ElevenLabs agent, the signed URL request will fail without an API key. Would need a server-side proxy.
   - Recommendation: For Phase 6, assume public agents. Document that private agents need a server-side proxy endpoint as a future enhancement. The `elevenlabs_agent_id` stored per-org does not include the API key (which is not stored in the database for ElevenLabs, unlike Vapi).

2. **VoiceBot conversation context sync**
   - What we know: VoiceBot sends a system prompt to ElevenLabs with the session ID. The agent asks questions and fires `recordAnswer` client tools. But the agent doesn't know which fields are already answered.
   - What's unclear: Should the system prompt include the list of already-answered fields and remaining questions?
   - Recommendation: Yes. When voice mode starts, build a system prompt that includes: (a) the current missing fields list, (b) the service context, and (c) which fields are already answered. This information is already available in `useWizardSession` state. Pass it to VoiceBot as a prop and include in the `conversation_config_override.agent.prompt`.

3. **AudioWorklet migration**
   - What we know: `createScriptProcessor` is deprecated. `AudioWorkletNode` is the replacement. VoiceBot uses ScriptProcessor.
   - What's unclear: When will browsers actually remove ScriptProcessor support?
   - Recommendation: Do NOT migrate in Phase 6. ScriptProcessor still works everywhere. Migration requires a separate worklet JS file, module loading within Shadow DOM, and testing. This is a tech debt task, not Phase 6 scope.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: VoiceBot.tsx, VoiceBotToggle.tsx, useWizardSession.ts, WizardWidget.tsx, StepRenderer.tsx, main.tsx, widget.css
- Direct codebase inspection: GET /api/widget/session/[sessionId]/route.ts, POST /api/widget/response/route.ts
- Direct codebase inspection: packages/shared/src/types/index.ts (Organization.elevenlabs_agent_id, OrgCredentials.elevenlabs)
- Direct codebase inspection: packages/shared/src/tenant/org-manager.ts (getOrgCredentials with elevenlabs support)
- [ElevenLabs WebSocket API docs](https://elevenlabs.io/docs/agents-platform/libraries/web-sockets) - WebSocket protocol, signed URLs
- [ElevenLabs React SDK](https://elevenlabs.io/docs/agents-platform/libraries/react) - useConversation hook API
- [ElevenLabs GitHub packages repo](https://github.com/elevenlabs/packages) - @elevenlabs/react@0.14.2 latest version
- [MDN ScriptProcessorNode](https://developer.mozilla.org/en-US/docs/Web/API/ScriptProcessorNode) - Deprecation status
- [MDN Window.postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) - Origin security patterns
- [MDN Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy) - Origin validation
- Phase 5 research (05-RESEARCH.md) - Widget architecture, session flow, API patterns

### Secondary (MEDIUM confidence)
- [ElevenLabs signed URL docs](https://elevenlabs.io/docs/agents-platform/api-reference/conversations/get-signed-url) - 15-minute expiry, public vs private agents
- [ElevenLabs client tools docs](https://elevenlabs.io/docs/conversational-ai/customization/tools/client-tools) - Client tool definition and response format
- [Can I Use: Speech Recognition](https://caniuse.com/speech-recognition) - Browser support (Chromium-only for SpeechRecognition)
- [Qrvey iframe security](https://qrvey.com/blog/iframe-security/) - 2026 iframe security patterns
- [Bindbee postMessage security guide](https://www.bindbee.dev/blog/secure-cross-window-communication) - Origin validation patterns
- [whatwg/html location.ancestorOrigins issue](https://github.com/whatwg/html/issues/1918) - ancestorOrigins behavior and referrer policy interaction

### Tertiary (LOW confidence)
- [Mozilla Bugzilla #1085214](https://bugzilla.mozilla.org/show_bug.cgi?id=1085214) - Firefox ancestorOrigins implementation status (may still be unimplemented in Firefox, needs runtime check)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies. Everything already installed and working.
- Architecture (voice hybrid): HIGH - VoiceBot.tsx is a complete implementation. Wiring to submitResponse is straightforward. useWizardSession already has mode state.
- Architecture (origin validation): HIGH - Simple JS origin check. Well-understood browser APIs. Clear implementation path.
- Pitfalls: HIGH - Identified from actual code inspection. Race conditions covered by existing submitting guard. ElevenLabs signed URL behavior documented.
- Code examples: HIGH - Based on actual existing codebase patterns, not hypothetical.

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable, no rapidly changing dependencies)
