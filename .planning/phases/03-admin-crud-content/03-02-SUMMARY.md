---
phase: 03-admin-crud-content
plan: "02"
status: complete
started: 2026-03-13T20:26:31Z
completed: 2026-03-13T20:31:02Z
duration: 271s
tasks_completed: 2
tasks_total: 2
subsystem: admin-crud, components
tags: [crud, services, forms, dynamic-builders, soft-delete]
dependency_graph:
  requires: [ServiceDefinition type, DataFieldDefinition type, SetupStepDefinition type, getUserOrg, createSupabaseServerClient]
  provides: [createService action, updateService action, softDeleteService action, DeleteDialog component, DataFieldBuilder component, SetupStepBuilder component, ServiceForm component]
  affects: [03-03 package CRUD (reuses DeleteDialog), 03-04 message template CRUD (reuses DeleteDialog)]
tech_stack:
  added: []
  patterns: [useActionState for form error handling, native dialog element for modals, hidden JSON input for JSONB arrays, updateService.bind for bound server actions]
key_files:
  created:
    - apps/admin/src/app/(dashboard)/services/actions.ts
    - apps/admin/src/components/delete-dialog.tsx
    - apps/admin/src/components/data-field-builder.tsx
    - apps/admin/src/components/setup-step-builder.tsx
    - apps/admin/src/components/service-form.tsx
    - apps/admin/src/app/(dashboard)/services/new/page.tsx
    - apps/admin/src/app/(dashboard)/services/[id]/edit/page.tsx
    - apps/admin/src/app/(dashboard)/services/service-actions.tsx
  modified:
    - apps/admin/src/app/(dashboard)/services/page.tsx
key_decisions:
  - "Slug auto-generated from name on create, NOT updated on edit to preserve existing references"
  - "softDeleteService sets is_active=false rather than deleting rows to preserve FK references in package_services and client_services"
  - "DeleteDialog uses native <dialog> element with showModal() instead of custom modal, providing focus trapping and Escape-to-close for free"
  - "DataFieldBuilder and SetupStepBuilder serialize arrays as JSON into hidden inputs so server actions receive them via FormData"
  - "ServiceForm uses useActionState (React 19) for error handling and pending state"
  - "Label says 'Deactivate' not 'Delete' since it is a soft-delete that can be reversed"
---

# Phase 3 Plan 02: Service Definition CRUD Summary

Complete CRUD for service definitions with server actions, dynamic JSONB array builders, form components, and page routes for create/edit/soft-delete.

## What was done

- Created server actions (createService, updateService, softDeleteService) with auth + admin role validation via getAuthedOrg helper
- Created reusable DeleteDialog component using native `<dialog>` element with showModal(), usable by Plans 03-03 and 03-04
- Created DataFieldBuilder component for dynamic DataFieldDefinition[] arrays (key, label, type, required, options, placeholder, help_text)
- Created SetupStepBuilder component for dynamic SetupStepDefinition[] arrays (key, label, description, automated, task_type)
- Created ServiceForm component integrating both builders with useActionState error handling
- Created /services/new page rendering ServiceForm in create mode
- Created /services/[id]/edit page loading existing service via RSC and rendering ServiceForm in edit mode with bound updateService action
- Created ServiceActions client component with three-dot dropdown menu (Edit link + Deactivate button with DeleteDialog confirmation)
- Updated services list page to filter by is_active=true, link "Add Service" to /services/new, and show per-service action menus

## Files changed

| File | Action | Description |
|------|--------|-------------|
| `apps/admin/src/app/(dashboard)/services/actions.ts` | Created | Server actions: createService, updateService, softDeleteService |
| `apps/admin/src/components/delete-dialog.tsx` | Created | Reusable confirmation dialog (native dialog element) |
| `apps/admin/src/components/data-field-builder.tsx` | Created | Dynamic JSONB builder for DataFieldDefinition[] |
| `apps/admin/src/components/setup-step-builder.tsx` | Created | Dynamic JSONB builder for SetupStepDefinition[] |
| `apps/admin/src/components/service-form.tsx` | Created | Service create/edit form with builder integration |
| `apps/admin/src/app/(dashboard)/services/new/page.tsx` | Created | Create service page |
| `apps/admin/src/app/(dashboard)/services/[id]/edit/page.tsx` | Created | Edit service page with RSC data loading |
| `apps/admin/src/app/(dashboard)/services/service-actions.tsx` | Created | Client component for edit/deactivate dropdown |
| `apps/admin/src/app/(dashboard)/services/page.tsx` | Modified | Filters active only, links to /services/new, has ServiceActions |

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 11ebf80 | feat(03-02): add service CRUD server actions and reusable builder components |
| 2 | 2cbbc29 | feat(03-02): add ServiceForm component, page routes, and updated services list |

## Decisions made

- **Slug immutable on edit**: Auto-generated from name on create but never updated on edit. Changing slugs would break existing references in package_services and client_services.
- **Soft-delete as is_active=false**: Preserves FK references. Label says "Deactivate" in UI to reflect reversibility.
- **Native dialog element**: DeleteDialog uses `<dialog>` with `showModal()` instead of a custom modal system. Provides backdrop, focus trapping, and Escape-to-close natively.
- **JSON hidden inputs**: DataFieldBuilder and SetupStepBuilder serialize their arrays as JSON into hidden `<input>` elements so server actions receive them via standard FormData.
- **useActionState over useFormState**: React 19 pattern for form error handling with pending state.
- **"Deactivate" label**: Since soft-delete can be reversed, using "Delete" would be misleading.

## Verification

- Server actions exist (createService, updateService, softDeleteService): PASS
- All actions validate auth via getAuthedOrg: PASS
- service-form.tsx exists with ServiceForm: PASS
- data-field-builder.tsx exists with DataFieldBuilder: PASS
- setup-step-builder.tsx exists with SetupStepBuilder: PASS
- delete-dialog.tsx exists with DeleteDialog: PASS
- /services/new page exists: PASS
- /services/[id]/edit page exists: PASS
- List page links to /services/new: PASS
- List page filters by is_active=true: PASS
- TypeScript type check: PASS

## Deviations from Plan

None. Plan executed exactly as written.

## Self-Check: PASSED

- All 10 files verified present on disk
- Commit 11ebf80: FOUND
- Commit 2cbbc29: FOUND
