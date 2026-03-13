---
phase: 06-widget-voice-security
plan: 01
subsystem: ui
tags: [elevenlabs, voice, widget, react, hybrid-mode]

# Dependency graph
requires:
  - phase: 05-widget-core-flow
    provides: "WizardWidget, useWizardSession, VoiceBot, VoiceBotToggle components"
provides:
  - "Voice + form hybrid mode in widget with shared session state"
  - "Session API voiceConfig.elevenlabsAgentId from org record"
  - "VoiceBot onAnswer wired to submitResponse pipeline"
affects: [06-widget-voice-security]

# Tech tracking
tech-stack:
  added: []
  patterns: ["voiceConfig pattern: API returns org voice config, hook stores it, component conditionally renders"]

key-files:
  created: []
  modified:
    - apps/admin/src/app/api/widget/session/[sessionId]/route.ts
    - apps/widget/src/hooks/useWizardSession.ts
    - apps/widget/src/components/WizardWidget.tsx

key-decisions:
  - "VoiceBot onAnswer scans missingFields to find matching service for clientServiceId resolution"
  - "Completion screen shows in voice mode via StepRenderer fallthrough (no mode-switch forced)"

patterns-established:
  - "Voice config pattern: org-level config queried server-side, returned as nested object, consumed by hook, drives conditional rendering"

requirements-completed: [WIDG-02]

# Metrics
duration: 2min
completed: 2026-03-14
---

# Phase 6 Plan 01: Widget Voice + Form Hybrid Summary

**Voice/form hybrid wiring: session API returns org ElevenLabs agent ID, widget renders VoiceBot/VoiceBotToggle conditionally with submitResponse pipeline**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-13T21:59:02Z
- **Completed:** 2026-03-13T22:01:02Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Session API now queries org's elevenlabs_agent_id and returns it as voiceConfig in the response
- useWizardSession tracks voiceConfig in state and exposes it to consuming components
- WizardWidget conditionally renders VoiceBotToggle and VoiceBot when org has ElevenLabs agent configured
- VoiceBot onAnswer callback wired to submitResponse with answeredVia="voice", sharing the same retry and session-reload pipeline as form answers

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend session API to return voiceConfig and update useWizardSession** - `808bd76` (feat)
2. **Task 2: Re-enable VoiceBot and VoiceBotToggle in WizardWidget** - `a170e42` (feat)

## Files Created/Modified
- `apps/admin/src/app/api/widget/session/[sessionId]/route.ts` - Added org query for elevenlabs_agent_id, included voiceConfig in response
- `apps/widget/src/hooks/useWizardSession.ts` - Added voiceConfig to state interface, initial state, and loadSession parser
- `apps/widget/src/components/WizardWidget.tsx` - Re-enabled VoiceBot and VoiceBotToggle rendering with conditional logic and submitResponse wiring

## Decisions Made
- VoiceBot onAnswer scans services' missingFields to resolve clientServiceId for the given fieldKey, rather than relying on currentQuestion (which may not match the voice agent's current topic)
- Completion screen renders in voice mode via StepRenderer fallthrough rather than forcing a mode switch to visual

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Voice/form hybrid wiring complete, ready for Phase 6 Plan 02 (security hardening)
- ElevenLabs agent ID must be configured in org's organizations record for voice to activate

## Self-Check: PASSED

All files verified present. Both task commits verified in git log.

---
*Phase: 06-widget-voice-security*
*Completed: 2026-03-14*
