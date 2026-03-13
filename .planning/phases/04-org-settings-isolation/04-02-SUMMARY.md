---
phase: 04-org-settings-isolation
plan: "02"
subsystem: comms
tags: [twilio, ghl, vapi, per-org-credentials, multi-tenant, encryption, provisioner]

# Dependency graph
requires:
  - phase: 04-org-settings-isolation
    provides: "Encrypted credential columns, AES-256-GCM crypto module, OrgCredentials type"
provides:
  - "Per-org credential support in all communication adapters (Twilio, GHL, Vapi)"
  - "getOrgCredentials function for decrypting org credentials from DB"
  - "Twilio phone number provisioner (search + purchase via REST API)"
  - "Outreach processor resolves per-org credentials before each send"
affects: [04-org-settings-isolation, 05-widget-e2e]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Optional orgConfig parameter on adapter functions for per-org credential injection", "Env var fallback for backward compatibility when orgConfig is undefined"]

key-files:
  created:
    - "packages/shared/src/automations/twilio-provisioner.ts"
  modified:
    - "packages/shared/src/tenant/org-manager.ts"
    - "packages/shared/src/tenant/index.ts"
    - "packages/shared/src/automations/index.ts"
    - "packages/shared/src/comms/twilio-sms.ts"
    - "packages/shared/src/automations/ghl-adapter.ts"
    - "packages/shared/src/comms/ghl-email.ts"
    - "packages/shared/src/comms/vapi-calls.ts"
    - "packages/shared/src/comms/outreach-processor.ts"

key-decisions:
  - "Optional orgConfig parameter pattern: all adapters accept per-org creds as last optional param, fall back to env vars when absent"
  - "getOrgCredentials returns empty object when org has no credentials, enabling graceful fallback to env vars"
  - "Twilio provisioner uses raw REST API (no SDK) consistent with existing twilio-sms.ts pattern"
  - "Config functions (getTwilioConfig, getGHLConfig, getVapiConfig) exported for direct use by settings UI"

patterns-established:
  - "Per-org credential injection: adapter functions accept optional orgConfig, pass to getXConfig which prioritizes it over env vars"
  - "Credential resolution in processors: getOrgCredentials(supabase, orgId) called once, then individual service creds passed to each adapter"

requirements-completed: [ORG-01, ORG-02]

# Metrics
duration: 6min
completed: 2026-03-14
---

# Phase 4 Plan 02: Per-Org Credential Isolation Summary

**All communication adapters (Twilio, GHL, Vapi) refactored for per-org credential injection with env var fallback, plus Twilio phone number provisioner**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-13T21:06:53Z
- **Completed:** 2026-03-13T21:12:35Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- All four adapter getXConfig functions accept optional orgConfig and are exported for direct use
- Outreach processor resolves per-org credentials via getOrgCredentials before every send (SMS, voice, email)
- handleInboundSMSReply also resolves org creds for voice call initiation
- Twilio phone number provisioner created with search + purchase via REST API
- Both shared package and admin app pass TypeScript type check

## Task Commits

Each task was committed atomically:

1. **Task 1: Add getOrgCredentials + Twilio provisioner** - `4e72a63` (feat)
2. **Task 2: Refactor adapters + update outreach processor** - `6e38f70` (feat)

## Files Created/Modified
- `packages/shared/src/automations/twilio-provisioner.ts` - Twilio phone number search and purchase via REST API
- `packages/shared/src/tenant/org-manager.ts` - Added getOrgCredentials that fetches encrypted columns and decrypts them
- `packages/shared/src/tenant/index.ts` - Exported getOrgCredentials from barrel
- `packages/shared/src/automations/index.ts` - Exported provisionPhoneNumber from barrel
- `packages/shared/src/comms/twilio-sms.ts` - getTwilioConfig and sendSMS accept optional orgConfig
- `packages/shared/src/automations/ghl-adapter.ts` - getGHLConfig, provisionSubAccount, syncContactToGHL, deploySnapshot, customizeSnapshot accept optional orgConfig
- `packages/shared/src/comms/ghl-email.ts` - getGHLConfig and sendEmail accept optional orgConfig
- `packages/shared/src/comms/vapi-calls.ts` - getVapiConfig, initiateOutboundCall, getCallStatus accept optional orgConfig
- `packages/shared/src/comms/outreach-processor.ts` - Resolves org credentials before each send, passes to all adapters

## Decisions Made
- Optional orgConfig parameter pattern preserves backward compatibility. Callers without org context (cron jobs, migration scripts) continue using env vars
- getOrgCredentials returns empty object `{}` when org has no stored credentials. Each adapter's getXConfig falls back to env vars when orgConfig is undefined
- ghlRequest internal function accepts optional `config` parameter. Public functions resolve config via getGHLConfig(orgConfig) and pass it through
- Twilio provisioner uses raw fetch (no twilio SDK) consistent with twilio-sms.ts pattern

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Per-org credentials are stored encrypted in the organizations table and decrypted at runtime.

## Next Phase Readiness
- All adapters ready for per-org credential usage
- Org settings UI (04-03) can now save credentials that will be picked up by outreach
- Twilio provisioner ready for phone number management in settings page
- DLQ admin views (04-04) can build on existing dead_letter_queue table

## Self-Check: PASSED

All files exist. All commits verified (4e72a63, 6e38f70).

---
*Phase: 04-org-settings-isolation*
*Completed: 2026-03-14*
