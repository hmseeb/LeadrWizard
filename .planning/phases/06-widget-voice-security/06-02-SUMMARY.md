---
phase: 06-widget-voice-security
plan: 02
subsystem: ui
tags: [widget, security, origin-validation, iframe, shadow-dom]

# Dependency graph
requires:
  - phase: 05-widget-core-flow
    provides: widget init() with Shadow DOM mounting and WizardWidget component
provides:
  - validateOrigin() function with 3-tier origin detection (ancestorOrigins, referrer, location)
  - allowedOrigins config option for domain restriction
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [origin-validation-before-mount, backwards-compatible-optional-security]

key-files:
  created: []
  modified:
    - apps/widget/src/main.tsx

key-decisions:
  - "Three-tier origin detection: ancestorOrigins (Chromium) > document.referrer (Firefox) > window.location.origin (direct script tag)"
  - "Validation runs before any DOM manipulation or React mounting to prevent flash of content on unauthorized domains"

patterns-established:
  - "Origin validation gate: security checks run before any rendering, fail-closed with console error"
  - "Backwards-compatible optional security: omitting allowedOrigins skips validation entirely"

requirements-completed: [WIDG-06]

# Metrics
duration: 1min
completed: 2026-03-14
---

# Phase 6 Plan 2: Widget Origin Validation Summary

**Client-side origin validation gate in widget init() using ancestorOrigins/referrer/location fallback chain with allowedOrigins config**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-13T21:59:06Z
- **Completed:** 2026-03-13T22:00:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `allowedOrigins?: string[]` to LeadrWizardConfig interface
- Implemented `validateOrigin()` with three-tier origin detection (ancestorOrigins, referrer, location.origin)
- Origin validation runs before any DOM manipulation or React mounting in init()
- Unauthorized domains get console error with detected origin for debugging, container cleared, no React mount
- Full backwards compatibility: omitting allowedOrigins skips validation entirely

## Task Commits

Each task was committed atomically:

1. **Task 1: Add allowedOrigins validation to widget init()** - `b918ffc` (feat)

## Files Created/Modified
- `apps/widget/src/main.tsx` - Added validateOrigin function and allowedOrigins config, gate before React mount

## Decisions Made
- Three-tier origin detection order: ancestorOrigins (Chrome/Edge/Safari) > document.referrer (Firefox fallback) > window.location.origin (direct script tag). Covers all major browsers.
- validateOrigin runs before ANY DOM manipulation. Not just before React mount, but before even accessing the container element for shadow DOM. Unauthorized domains see zero widget artifacts.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Widget now supports optional domain restriction via allowedOrigins
- Embedders can restrict widget rendering to specific domains
- All existing embeddings continue working without changes (no allowedOrigins = no validation)

## Self-Check: PASSED

- FOUND: apps/widget/src/main.tsx
- FOUND: 06-02-SUMMARY.md
- FOUND: commit b918ffc
- FOUND: validateOrigin in main.tsx
- FOUND: allowedOrigins in main.tsx

---
*Phase: 06-widget-voice-security*
*Completed: 2026-03-14*
