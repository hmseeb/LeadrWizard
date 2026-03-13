---
phase: 03-admin-crud-content
plan: "01"
status: complete
started: 2026-03-13T20:21:33Z
completed: 2026-03-13T20:23:11Z
duration: 98s
tasks_completed: 2
tasks_total: 2
subsystem: database, shared-types
tags: [migration, rls, types, message-templates]
dependency_graph:
  requires: [00001_initial_schema.sql]
  provides: [message_templates table, package_services_modify RLS, MessageTemplate type]
  affects: [03-03 message template CRUD, 03-02 package CRUD service assignment]
tech_stack:
  added: []
  patterns: [mustache-style template interpolation, per-org slug uniqueness]
key_files:
  created:
    - supabase/migrations/00007_message_templates_and_rls.sql
  modified:
    - packages/shared/src/types/index.ts
key_decisions:
  - "channel uses 'voice' not 'voice_call' because message templates describe content rendering, not interaction channels"
  - "package_services_modify uses 'for all using(...)' which covers insert/update/delete and acts as with check for inserts"
  - "TEMPLATE_VARIABLES defined as const tuple for type-safe iteration in template editor UI"
---

# Phase 3 Plan 01: Message Templates Migration & Types Summary

Database migration for message_templates table with per-org RLS, package_services write policy fix, and MessageTemplate TypeScript type with interpolation variable definitions.

## What was done

- Created migration `00007_message_templates_and_rls.sql` with `message_templates` table (10 columns: id, org_id, name, slug, channel, subject, body, is_active, created_at, updated_at)
- Added `unique(org_id, slug)` constraint and channel check constraint (`sms`, `email`, `voice`)
- Added RLS: `message_templates_select` (any org member) and `message_templates_modify` (owner/admin)
- Fixed missing `package_services_modify` RLS policy enabling admin write access to service-package assignments
- Added `MessageChannel` type (`"sms" | "email" | "voice"`) to shared types
- Added `MessageTemplate` interface matching table schema to shared types
- Added `TEMPLATE_VARIABLES` constant with 5 interpolation variable definitions (name, businessName, packageName, onboardingUrl, itemsRemaining)

## Files changed

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/00007_message_templates_and_rls.sql` | Created | message_templates table + RLS + package_services write fix |
| `packages/shared/src/types/index.ts` | Modified | Added MessageChannel, MessageTemplate, TEMPLATE_VARIABLES |

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 5ab0422 | feat(03-01): add message_templates table and package_services write RLS |
| 2 | 69495de | feat(03-01): add MessageTemplate type and TEMPLATE_VARIABLES constant |

## Decisions made

- **channel = 'voice' not 'voice_call'**: Message templates describe content rendering channels (how text is formatted), not interaction channels. The outreach system maps voice templates to voice_call interactions.
- **package_services_modify uses `for all using(...)`**: Covers insert, update, delete, and select. The `using` clause also acts as `with check` for inserts, keeping the policy concise.
- **TEMPLATE_VARIABLES as const tuple**: Enables type-safe iteration in the template editor UI and provides labels/examples for display.

## Verification

- Migration file exists: PASS
- message_templates table defined with all 10 columns: PASS
- channel check constraint ('sms', 'email', 'voice'): PASS
- unique(org_id, slug) constraint: PASS
- message_templates_select RLS (any org member): PASS
- message_templates_modify RLS (owner/admin): PASS
- package_services_modify RLS policy: PASS
- MessageTemplate interface exported: PASS
- MessageChannel type exported: PASS
- TEMPLATE_VARIABLES constant exported: PASS
- TypeScript type check: PASS

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- supabase/migrations/00007_message_templates_and_rls.sql: FOUND
- packages/shared/src/types/index.ts: FOUND
- .planning/phases/03-admin-crud-content/03-01-SUMMARY.md: FOUND
- Commit 5ab0422: FOUND
- Commit 69495de: FOUND
