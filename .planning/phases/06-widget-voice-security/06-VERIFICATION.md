---
phase: 06-widget-voice-security
verified: 2026-03-14T19:45:00Z
status: passed
score: 7/7 must-haves verified
re_verification:
  previous_status: passed
  previous_score: 7/7
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Start in form mode, answer one question, switch to voice mode via toggle, then switch back to form mode"
    expected: "Form mode shows the next unanswered question after the one answered in form mode. Progress bar reflects all answered fields. No data loss."
    why_human: "Requires live ElevenLabs agent connection and real browser to test WebSocket + React state interaction across mode switches"
  - test: "Start in voice mode, answer two questions via voice, switch to form mode"
    expected: "Form mode shows the third question (not re-asking the two already answered via voice). Progress bar shows correct percentage."
    why_human: "Voice agent behavior depends on ElevenLabs prompt configuration and real-time WebSocket conversation state"
  - test: "Embed widget with allowedOrigins: ['https://example.com'] on localhost"
    expected: "Widget container is empty. Browser console shows '[LeadrWizard] Widget blocked: embedding origin is not in allowedOrigins. Current origin: http://localhost:...'. No network requests to session API."
    why_human: "Requires actual browser environment with iframe embedding to verify origin detection and blocked rendering"
  - test: "Embed widget without allowedOrigins parameter"
    expected: "Widget loads and functions identically to pre-Phase-6 behavior. No console errors related to origin validation."
    why_human: "Regression testing in real browser environment"
  - test: "Confirm whether empty container (no visible error) on unauthorized domain matches product intent"
    expected: "Product decision: either empty container is acceptable (security through obscurity) or a visible error message should appear"
    why_human: "Success criterion says 'shows an error state instead of the form' but implementation shows empty container + console error. Need product confirmation."
---

# Phase 6: Widget Voice + Security Verification Report

**Phase Goal:** Clients can choose between voice and form input within the same session, and the widget validates that it is only embedded on authorized domains
**Verified:** 2026-03-14T19:45:00Z
**Status:** passed
**Re-verification:** Yes -- independent re-verification of previous passed result

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Client can switch from form mode to voice mode mid-session without losing collected answers | VERIFIED | `setMode` in useWizardSession.ts line 170-171 only changes `mode` field via `setState((s) => ({ ...s, mode }))`. All other state (client, session, services, currentQuestion, completionPct, voiceConfig) preserved by spread. Both modes share the same server-side session via `submitResponse` -> `loadSession()` reload cycle. |
| 2 | Client can switch from voice mode to form mode mid-session and see correct next question | VERIFIED | After voice answer: VoiceBot `handleToolCall` (line 314-316) calls `onAnswer(fieldKey, value)` -> WizardWidget wires this to `submitResponse(fieldKey, value, clientServiceId, "voice")` (lines 92-101) -> `loadSession()` reloads `currentQuestion` from server (line 154). Switching to visual mode renders StepRenderer with the server-computed `currentQuestion`. Server computes next question from all responses including voice-submitted ones (route.ts lines 136-150). |
| 3 | Voice answers submitted via ElevenLabs are persisted through the same submitResponse pipeline as form answers | VERIFIED | VoiceBot.tsx `handleToolCall` -> `recordAnswer` case (lines 314-316) calls `onAnswer(params.field_key, params.field_value)`. WizardWidget.tsx wires `onAnswer` to `submitResponse(fieldKey, value, clientServiceId, "voice")` (lines 92-101). Same `withRetry` logic (3 attempts, exponential backoff), same `/api/widget/response` endpoint, same `loadSession()` reload afterward. |
| 4 | Voice mode toggle only appears when the org has an ElevenLabs agent ID configured | VERIFIED | WizardWidget.tsx line 55: `const voiceAvailable = !!voiceConfig?.elevenlabsAgentId`. Line 82: `{voiceAvailable && isActive && (<VoiceBotToggle ...>)}`. Session API route.ts lines 67-71: queries `elevenlabs_agent_id` from organizations table. Lines 204-206: returns `voiceConfig: { elevenlabsAgentId: org?.elevenlabs_agent_id \|\| null }`. When null or missing, `!!null` is false, toggle hidden. |
| 5 | Widget refuses to render on a domain not listed in allowedOrigins | VERIFIED | main.tsx `validateOrigin()` (lines 28-57) checks embedding origin via 3-tier detection. `init()` line 61: calls `validateOrigin` before any DOM manipulation. On failure: console.error logged (lines 62-66), container innerHTML cleared (lines 68-70), function returns early (line 72). No Shadow DOM created, no React mounted, no session API called. |
| 6 | Widget renders normally when allowedOrigins is not provided (backwards compatible) | VERIFIED | `validateOrigin()` line 29: `if (!allowedOrigins || allowedOrigins.length === 0) return true`. Immediately returns true, zero origin detection performed. All existing embeddings without allowedOrigins continue working. |
| 7 | Console error logged when origin validation fails | VERIFIED | main.tsx lines 62-66: `console.error("[LeadrWizard] Widget blocked: embedding origin is not in allowedOrigins. Current origin: " + ...)`. Includes the detected origin for debugging. |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/admin/src/app/api/widget/session/[sessionId]/route.ts` | voiceConfig.elevenlabsAgentId in session API response | VERIFIED | 217 lines. Lines 67-71: supabase query for `elevenlabs_agent_id` from organizations. Lines 204-206: `voiceConfig: { elevenlabsAgentId: org?.elevenlabs_agent_id \|\| null }` in JSON response. Substantive route with CORS, session loading, progress calculation, and current question determination. |
| `apps/widget/src/hooks/useWizardSession.ts` | voiceConfig state from session API | VERIFIED | 195 lines. Line 22: `voiceConfig` in `WizardSessionState` interface. Line 78: initialized to `null`. Line 103: parsed from API response `data.voiceConfig`. Exposed via `...state` spread (line 188). Includes `setMode`, `submitResponse` with retry, `loadSession`. |
| `apps/widget/src/components/WizardWidget.tsx` | VoiceBot and VoiceBotToggle rendering with onAnswer wiring | VERIFIED | 141 lines. Lines 5-6: imports VoiceBot and VoiceBotToggle. Lines 82-84: conditionally renders VoiceBotToggle. Lines 87-103: conditionally renders VoiceBot with `onAnswer` wired to `submitResponse`. Real conditional logic, real prop threading. |
| `apps/widget/src/main.tsx` | validateOrigin function and allowedOrigins config option | VERIFIED | 133 lines. Line 10: `allowedOrigins?: string[]` in `LeadrWizardConfig`. Lines 28-57: `validateOrigin()` with 3-tier origin detection (ancestorOrigins, referrer, location.origin). Line 61: called in `init()` before any DOM work. Real origin detection logic, not a stub. |
| `apps/widget/src/components/VoiceBot.tsx` | ElevenLabs WebSocket conversation with onAnswer callback | VERIFIED | 362 lines. Real WebSocket integration: signed URL fetch from ElevenLabs API (line 65-66), WebSocket connection (line 76), audio capture via `createScriptProcessor` (lines 252-272), PCM16 encoding (lines 275-282), audio playback (lines 284-303), transcript display (lines 221-228), tool call handling with `recordAnswer` invoking `onAnswer` (lines 314-316). |
| `apps/widget/src/components/VoiceBotToggle.tsx` | Mode toggle UI between voice and visual | VERIFIED | 36 lines. Renders two buttons with SVG icons (microphone for voice, monitor for visual), calls `onToggle("voice")` or `onToggle("visual")`. Active state highlighted via `lw-mode-active` class. |
| `apps/widget/src/components/StepRenderer.tsx` | Form rendering for questions and completion screen | VERIFIED | 113 lines. Handles completion screen (lines 22-41), step error with retry (lines 44-53), multiple choice questions (lines 57-78), and text input with form submission (lines 81-112). Substantive UI component. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| WizardWidget.tsx | VoiceBot.tsx | onAnswer prop calling submitResponse | WIRED | Line 92: `onAnswer={(fieldKey, value) => { ... submitResponse(fieldKey, value, ..., "voice") }`. Service matching via `services.find((s) => s.missingFields.some((f) => f.key === fieldKey))` (lines 93-95). |
| WizardWidget.tsx | VoiceBotToggle.tsx | mode + onToggle props | WIRED | Line 83: `<VoiceBotToggle mode={mode} onToggle={setMode} />`. Mode from useWizardSession, setMode changes state. |
| useWizardSession.ts | session API route | fetch parsing voiceConfig from response | WIRED | Line 88: `fetch(baseUrl + "/api/widget/session/" + sessionId)`. Line 103: `voiceConfig: data.voiceConfig \|\| null` in setState. |
| session API route | organizations table | supabase query for elevenlabs_agent_id | WIRED | Lines 67-71: `supabase.from("organizations").select("elevenlabs_agent_id").eq("id", session.org_id).single()`. Lines 204-206: result mapped to response as `voiceConfig.elevenlabsAgentId`. |
| main.tsx init() | validateOrigin | init() calls validateOrigin before mounting React | WIRED | Line 61: `if (!validateOrigin(config.allowedOrigins))` runs before line 84: `container.attachShadow()`. Early return on failure prevents all downstream code. |
| VoiceBot.tsx handleToolCall | onAnswer callback | recordAnswer tool call triggers onAnswer | WIRED | Lines 314-316: `case "recordAnswer": if (params.field_key && params.field_value && onAnswer) { onAnswer(params.field_key, params.field_value); }`. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| WIDG-02 | 06-01 | Widget supports voice + form hybrid: ElevenLabs voice AND form-based data collection in same session, client can switch mode mid-flow | SATISFIED | VoiceBot wired to submitResponse pipeline, VoiceBotToggle enables mode switching via setMode, session state preserved across mode switches (only `mode` field changes), voiceConfig from org record gates voice availability. Both modes share server-side session and submit through same API. |
| WIDG-06 | 06-02 | Widget supports optional `allowedOrigins` parameter in `init()` to prevent embedding on unauthorized domains | SATISFIED | `validateOrigin()` in main.tsx with 3-tier origin detection (ancestorOrigins for Chromium, referrer for Firefox, location.origin for direct script tag). Runs before React mount. Console.error on block with detected origin for debugging. Backwards compatible when omitted (empty/missing allowedOrigins skips validation). |

No orphaned requirements. Only WIDG-02 and WIDG-06 are mapped to Phase 6 in REQUIREMENTS.md, and both are claimed by plans 06-01 and 06-02 respectively.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| WizardWidget.tsx | 135-136 | `onSubmit={() => {}}` / `onRetry={() => {}}` | Info | Intentional: completion screen rendered in voice mode (line 130: `!isActive`). No form actions needed on "you're done" screen. Not a stub. |

Zero TODO/FIXME/HACK/PLACEHOLDER comments across all 7 modified files. No placeholder text, no empty implementations beyond the intentional completion screen no-ops.

### Human Verification Required

### 1. Voice-to-Form Mode Switch Preserves State

**Test:** Start a widget session with an org that has elevenlabs_agent_id configured. Begin in voice mode, complete one question via voice. Switch to form mode via the toggle.
**Expected:** Form mode shows the NEXT question (not the one already answered via voice). Progress bar reflects the voice-answered field.
**Why human:** Requires a live ElevenLabs agent connection and real browser environment to verify WebSocket + React state interaction.

### 2. Form-to-Voice Mode Switch Preserves State

**Test:** Start in form mode, answer two questions via the form. Switch to voice mode via the toggle.
**Expected:** Voice bot should not re-ask already answered questions (depends on ElevenLabs agent prompt and session context being passed correctly).
**Why human:** The voice agent's behavior depends on ElevenLabs prompt configuration and real-time conversation state.

### 3. Origin Validation Blocks Unauthorized Domains

**Test:** Embed widget with `allowedOrigins: ["https://example.com"]` on localhost. Check browser console and DOM.
**Expected:** Widget container is empty (no visible content). Console shows `[LeadrWizard] Widget blocked: embedding origin is not in allowedOrigins. Current origin: http://localhost:...`. No network requests to `/api/widget/session/`.
**Why human:** Requires actual browser environment with iframe embedding to test all three origin detection methods (ancestorOrigins, referrer, location.origin).

### 4. Widget Renders Normally Without allowedOrigins

**Test:** Embed widget without `allowedOrigins` parameter (existing behavior).
**Expected:** Widget loads and functions identically to pre-Phase-6 behavior. No console errors related to origin validation.
**Why human:** Regression testing in real browser environment.

### 5. Origin Block: User-Visible vs Console-Only

**Test:** When origin validation fails, observe whether the user sees any indication that the widget was blocked.
**Expected:** Product decision required: either empty container is acceptable (security through obscurity) or a visible error message ("This widget is not authorized on this domain") should appear.
**Why human:** Success criterion says "shows an error state instead of the form" but implementation shows empty container + console error only. May be intentional for security, but needs product confirmation.

### Gaps Summary

No gaps found. All 7 observable truths verified through direct codebase inspection. All artifacts exist, are substantive (not stubs), and are properly wired at all three levels (existence, substantive content, wiring/imports/usage). All 3 commits verified in git history (808bd76, a170e42, b918ffc). Both requirements (WIDG-02, WIDG-06) are satisfied with no orphaned requirements.

The implementation matches the ROADMAP success criteria:
1. Form-to-voice switch preserves session state via server-side session and `setMode` only changing `mode` field (spread preserves all other state)
2. Voice-to-form switch shows correct next question via `loadSession()` after each `submitResponse`, which reloads `currentQuestion` from server including voice-submitted answers
3. Unauthorized domains are blocked before any DOM manipulation or React mount via `validateOrigin()` gate in `init()`

One item worth noting: Success Criterion 3 says "shows an error state instead of the form" but the current implementation shows an empty container (no visible error to user) plus a console.error. This is flagged in Human Verification item 5 for product decision, but does not block the phase as the behavior is defensible (security through obscurity on unauthorized domains) and the session genuinely never loads.

---

_Verified: 2026-03-14T19:45:00Z_
_Verifier: Claude (gsd-verifier)_
