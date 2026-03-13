# Phase 3: Admin CRUD: Content - Research

**Researched:** 2026-03-14
**Domain:** Admin CRUD UI with Next.js 15 App Router, Supabase, Server Actions
**Confidence:** HIGH

## Summary

Phase 3 adds full CRUD operations for the three content types that drive onboarding: service definitions, packages (bundles of services), and message templates. The database schema for services and packages already exists (tables `service_definitions`, `service_packages`, `package_services`). The admin pages for all three already exist as read-only list views with placeholder "Add" buttons. The work is: (1) add server actions for mutations, (2) build form UIs (modals or inline) for create/edit flows, (3) create a new `message_templates` DB table (does NOT exist yet), and (4) add missing RLS policies for `package_services` writes.

The codebase currently has zero `"use server"` directives anywhere. All mutations go through API routes (`apps/admin/src/app/api/`). For admin CRUD, server actions are the natural fit since these are authenticated admin-only operations within the same Next.js app. This is a straightforward pattern choice that aligns with Next.js 15 App Router conventions.

**Primary recommendation:** Use Next.js server actions (not API routes) for all CRUD mutations. Build forms as client components that call server actions. Keep the existing RSC pattern for list pages. Create a new migration for the `message_templates` table and `package_services` write policies.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CRUD-01 | Admin can create, edit, and soft-delete service definitions with required_data_fields and setup_steps | Table `service_definitions` exists with `is_active` boolean for soft-delete. RLS policies exist for select and modify (owner/admin only). Types `ServiceDefinition`, `DataFieldDefinition`, `SetupStepDefinition` fully defined. Read-only list page exists at `/services`. |
| CRUD-02 | Admin can create, edit, and delete packages with assigned services and pricing metadata | Table `service_packages` exists. Join table `package_services` exists. RLS: select policy exists for both, modify policy exists for `service_packages` but NOT for `package_services` (gap). Read-only list page exists at `/packages`. |
| CRUD-03 | Admin can create, edit, and delete message templates with variable interpolation preview per channel (SMS, email, voice) | NO `message_templates` table exists in the database. Current templates are hardcoded JS functions in `packages/shared/src/comms/message-templates.ts`. The `/templates` page currently shows `niche_templates` (website templates), NOT message templates. Need new migration, new types, new page. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 15.1.0 | App Router, RSC, Server Actions | Already in use. Server actions are the canonical mutation pattern for App Router |
| React | 19.0.0 | UI framework | Already in use |
| @supabase/ssr | 0.5.0 | Server-side Supabase client | Already in use for all server data fetching |
| @supabase/supabase-js | 2.49.0 | Supabase client SDK | Already in use |
| Tailwind CSS | 3.4.0 | Styling | Already in use, no component library (raw Tailwind) |
| lucide-react | 0.468.0 | Icons | Already in use in sidebar and dashboard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | - | - | No new dependencies required for this phase |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Server Actions | API routes | API routes are already used for webhooks/external endpoints, but server actions are simpler for same-app form mutations (no fetch boilerplate, automatic revalidation) |
| Raw forms | shadcn/ui or react-hook-form | The codebase has no component library. Adding one now is scope creep. Raw Tailwind forms match existing patterns |
| Dialog/modal for forms | Separate pages (/services/new) | Modals keep context visible (list in background). But separate pages are simpler for complex forms like service definitions with dynamic field arrays. Recommend separate pages for create/edit, dialog for delete confirmation |

## Architecture Patterns

### Recommended Project Structure
```
apps/admin/src/
├── app/(dashboard)/
│   ├── services/
│   │   ├── page.tsx              # List (RSC, existing - enhance)
│   │   ├── new/page.tsx          # Create form (client component)
│   │   ├── [id]/edit/page.tsx    # Edit form (RSC loads data, client form)
│   │   └── actions.ts            # Server actions (create, update, soft-delete)
│   ├── packages/
│   │   ├── page.tsx              # List (RSC, existing - enhance)
│   │   ├── new/page.tsx          # Create form
│   │   ├── [id]/edit/page.tsx    # Edit form
│   │   └── actions.ts            # Server actions
│   └── templates/
│       ├── page.tsx              # List (RSC - REPLACE current niche_templates view)
│       ├── new/page.tsx          # Create form
│       ├── [id]/edit/page.tsx    # Edit form
│       ├── [id]/preview/page.tsx # Template preview with variable substitution
│       └── actions.ts            # Server actions
├── components/
│   ├── sidebar.tsx               # Existing
│   ├── data-field-builder.tsx    # Dynamic field array for required_data_fields
│   ├── setup-step-builder.tsx    # Dynamic field array for setup_steps
│   ├── template-preview.tsx     # Variable interpolation preview
│   └── delete-dialog.tsx         # Reusable delete confirmation
└── lib/
    ├── supabase-server.ts        # Existing
    └── supabase-browser.ts       # Existing
```

### Pattern 1: Server Actions for CRUD
**What:** Server actions in a co-located `actions.ts` file, called from client component forms
**When to use:** All admin CRUD mutations (create, update, delete)
**Example:**
```typescript
// apps/admin/src/app/(dashboard)/services/actions.ts
"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createService(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Get user's org
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .single();

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    throw new Error("Insufficient permissions");
  }

  const name = formData.get("name") as string;
  const slug = formData.get("slug") as string;
  // ... extract other fields

  const { error } = await supabase.from("service_definitions").insert({
    org_id: membership.org_id,
    name,
    slug,
    description: formData.get("description") as string,
    required_data_fields: JSON.parse(formData.get("required_data_fields") as string || "[]"),
    setup_steps: JSON.parse(formData.get("setup_steps") as string || "[]"),
  });

  if (error) throw new Error(error.message);

  revalidatePath("/services");
  redirect("/services");
}
```

### Pattern 2: RSC Data Loading + Client Form
**What:** Server Component loads existing data for edit, passes to Client Component form
**When to use:** Edit pages where you need to pre-populate form with current data
**Example:**
```typescript
// apps/admin/src/app/(dashboard)/services/[id]/edit/page.tsx
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { notFound } from "next/navigation";
import { ServiceForm } from "./service-form";

export default async function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: service } = await supabase
    .from("service_definitions")
    .select("*")
    .eq("id", id)
    .single();

  if (!service) notFound();

  return <ServiceForm mode="edit" initialData={service} />;
}
```

### Pattern 3: Dynamic Field Array Builder
**What:** Client component that lets admin add/remove/reorder items in a JSONB array (required_data_fields, setup_steps)
**When to use:** Service definition forms where the admin builds an array of field definitions or steps
**Example:**
```typescript
// A "data field builder" renders a list of DataFieldDefinition items
// Each row has: key, label, type (select), required (checkbox), options (if type=select)
// Admin can add new rows, remove rows, drag to reorder
// The final array is serialized as JSON into a hidden form field
```

### Pattern 4: Template Variable Interpolation Preview
**What:** Client-side preview that takes template body text with `{{variable}}` placeholders and renders with sample data
**When to use:** Message template create/edit forms (CRUD-03)
**Example:**
```typescript
// Template body: "Hey {{name}}, your {{packageName}} setup is ready: {{onboardingUrl}}"
// Preview renders: "Hey Jane Doe, your Pro Bundle setup is ready: https://app.example.com/onboard?s=abc"
// Use regex replace: body.replace(/\{\{(\w+)\}\}/g, (_, key) => sampleData[key] || `{{${key}}}`)
```

### Anti-Patterns to Avoid
- **Mixing server actions with API routes for the same entity:** Pick one pattern per entity. Server actions for admin CRUD, API routes for external/webhook endpoints
- **Fetching data in client components:** Use RSC for reads, client components only for interactive forms
- **Building custom form validation from scratch:** Use native HTML5 validation (required, pattern, minLength) as the primary layer. Server-side validation in the action as the authoritative layer
- **Storing templates as JS functions in DB:** The existing hardcoded templates use JS template literals. DB-stored templates should use `{{variable}}` mustache-style interpolation, not executable code

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Slug generation | Custom slug function | `name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-\|-+$/g, '')` | Already used in org-manager.ts, copy the pattern |
| Confirmation dialogs | Custom modal system | Native `confirm()` for MVP or a simple React portal dialog | No component library in the project |
| Toast notifications | Custom toast system | `redirect()` with search params for success messages (e.g., `?created=true`) | The codebase has no toast infrastructure |
| Form state management | Custom state reducer | `useState` for dynamic arrays, `formData` for simple fields | No form library in the project |
| Template variable extraction | Custom parser | Regex `\{\{(\w+)\}\}` to find variables in template body | Simple and battle-tested |

**Key insight:** The codebase is intentionally minimal. No component library, no form library, no state management library. Keep CRUD forms equally simple: native HTML forms, Tailwind styling, server actions.

## Common Pitfalls

### Pitfall 1: Missing RLS for package_services Writes
**What goes wrong:** Admin creates a package and tries to assign services. Insert into `package_services` fails silently or throws permission error because there is NO insert/update/delete RLS policy on `package_services`.
**Why it happens:** The initial schema only created a SELECT policy for `package_services`. The modify policies were added for `service_definitions` and `service_packages` but not for the join table.
**How to avoid:** Create a migration adding insert/update/delete policies for `package_services` scoped to org admins/owners (via the related `service_packages.org_id`).
**Warning signs:** Package creation succeeds but services array is always empty.

### Pitfall 2: No message_templates Table
**What goes wrong:** Attempting to build CRUD-03 without a database table. The current `/templates` page shows `niche_templates` (website templates by industry), not message templates.
**Why it happens:** Message templates are currently hardcoded in `packages/shared/src/comms/message-templates.ts` as JS functions. CRUD-03 requires moving to database-stored templates with admin management.
**How to avoid:** Create a new `message_templates` table in a migration. Keep the existing hardcoded templates as seed data / fallbacks. The new table should have: id, org_id, name, slug, channel (sms/email/voice), subject (for email), body (with {{variable}} placeholders), is_active, created_at, updated_at.
**Warning signs:** Confusion between `niche_templates` (website templates) and message templates (outreach SMS/email/voice).

### Pitfall 3: Soft-Delete vs Hard-Delete Confusion
**What goes wrong:** Using `DELETE` SQL for service definitions breaks FK references in `client_services` and `package_services`.
**Why it happens:** Service definitions are referenced by `package_services.service_id` and `client_services.service_id`. Hard-deleting a service cascades or fails.
**How to avoid:** Service definitions use soft-delete: set `is_active = false`. The success criteria explicitly states "soft-deleted services no longer appear in package assignment but their FKs are preserved." Packages and message templates can use hard-delete since the requirements say "delete" not "soft-delete."
**Warning signs:** Cascade deleting client_services when admin removes a service definition.

### Pitfall 4: Stale Data After Mutations
**What goes wrong:** After creating/editing a service, the list page still shows old data because Next.js cached the RSC output.
**Why it happens:** Next.js 15 caches RSC renders. Without `revalidatePath()` or `revalidateTag()`, the list page serves stale data.
**How to avoid:** Call `revalidatePath("/services")` (or `/packages`, `/templates`) at the end of every server action before `redirect()`.
**Warning signs:** "I just created it but it doesn't show up." Note: the dashboard layout already has `export const dynamic = "force-dynamic"` which helps, but explicit revalidation is still best practice.

### Pitfall 5: JSONB Field Editing Complexity
**What goes wrong:** The `required_data_fields` and `setup_steps` are JSONB arrays that need a dynamic form builder. Attempting to use a single textarea for JSON input is unusable for non-technical admins.
**Why it happens:** These fields store arrays of structured objects (`DataFieldDefinition[]`, `SetupStepDefinition[]`). A proper UX requires add/remove/edit individual items in the array.
**How to avoid:** Build a dedicated "field builder" client component with add/remove buttons per row. Each row renders inputs for the object properties (key, label, type, required, etc.). Serialize the array to a hidden form field on submit.
**Warning signs:** Admin has to write raw JSON.

### Pitfall 6: Template Page Scope Mismatch
**What goes wrong:** The existing `/templates` page reads from `niche_templates` (website templates). CRUD-03 is about MESSAGE templates (SMS/email/voice). Building CRUD on the wrong table.
**Why it happens:** The sidebar nav says "Templates" and links to `/templates`. The current page shows niche templates. The requirements say message templates.
**How to avoid:** Two options: (A) Rename the existing `/templates` route to `/niche-templates` or `/website-templates` and use `/templates` for message templates, or (B) Add a new route like `/message-templates`. Recommend option A: repurpose `/templates` for message templates since that is what CRUD-03 needs, and move niche templates to a sub-section or separate route. The sidebar "Templates" label aligns better with message templates for the admin workflow.
**Warning signs:** Building message template CRUD but pointing at the wrong database table.

## Code Examples

### Server Action Pattern (from existing codebase conventions)
```typescript
// apps/admin/src/app/(dashboard)/services/actions.ts
"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getUserOrg } from "@leadrwizard/shared/tenant";

export async function createService(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const orgData = await getUserOrg(supabase, user.id);
  if (!orgData || !["owner", "admin"].includes(orgData.role)) {
    throw new Error("Insufficient permissions");
  }

  const name = formData.get("name") as string;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const { error } = await supabase.from("service_definitions").insert({
    org_id: orgData.org.id,
    name,
    slug,
    description: formData.get("description") as string || null,
    required_data_fields: JSON.parse(formData.get("required_data_fields") as string || "[]"),
    setup_steps: JSON.parse(formData.get("setup_steps") as string || "[]"),
  });

  if (error) throw new Error(error.message);

  revalidatePath("/services");
  redirect("/services");
}

export async function softDeleteService(serviceId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // RLS will enforce org scoping + admin role check
  const { error } = await supabase
    .from("service_definitions")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", serviceId);

  if (error) throw new Error(error.message);

  revalidatePath("/services");
}
```

### Package Create with Service Assignment
```typescript
// Packages need a two-step insert: package row + package_services rows
export async function createPackage(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  // ... auth check ...

  // 1. Insert the package
  const { data: pkg, error: pkgError } = await supabase
    .from("service_packages")
    .insert({
      org_id: orgData.org.id,
      name: formData.get("name") as string,
      description: formData.get("description") as string || null,
      price_cents: parseInt(formData.get("price_cents") as string) || null,
    })
    .select("id")
    .single();

  if (pkgError) throw new Error(pkgError.message);

  // 2. Insert service assignments
  const serviceIds = JSON.parse(formData.get("service_ids") as string || "[]") as string[];
  if (serviceIds.length > 0) {
    const { error: svcError } = await supabase
      .from("package_services")
      .insert(serviceIds.map((sid) => ({
        package_id: pkg.id,
        service_id: sid,
      })));

    if (svcError) throw new Error(svcError.message);
  }

  revalidatePath("/packages");
  redirect("/packages");
}
```

### Message Template Preview
```typescript
// Template variable interpolation for preview
const sampleData: Record<string, string> = {
  name: "Jane Doe",
  businessName: "Jane's Bakery",
  packageName: "Pro Bundle",
  onboardingUrl: "https://app.example.com/onboard?session=abc123",
  itemsRemaining: "3",
};

function renderPreview(body: string): string {
  return body.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return sampleData[key] || match;
  });
}
```

### New Migration: message_templates table + package_services policies
```sql
-- Migration: 00007_message_templates_and_rls.sql

-- ============================================================
-- Message Templates (per-org, per-channel outreach templates)
-- ============================================================
create table public.message_templates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  channel text not null check (channel in ('sms', 'email', 'voice')),
  subject text,  -- email only
  body text not null,  -- uses {{variable}} placeholders
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, slug)
);

create index idx_message_templates_org on public.message_templates(org_id);
create index idx_message_templates_channel on public.message_templates(org_id, channel);

-- RLS
alter table public.message_templates enable row level security;

create policy "message_templates_select" on public.message_templates
  for select using (
    org_id in (select org_id from public.org_members where user_id = auth.uid())
  );

create policy "message_templates_modify" on public.message_templates
  for all using (
    org_id in (select org_id from public.org_members where user_id = auth.uid() and role in ('owner', 'admin'))
  );

-- ============================================================
-- Missing: package_services write policy
-- ============================================================
create policy "package_services_modify" on public.package_services
  for all using (
    package_id in (
      select id from public.service_packages
      where org_id in (
        select org_id from public.org_members
        where user_id = auth.uid() and role in ('owner', 'admin')
      )
    )
  );
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| API routes for all mutations | Server actions for same-app mutations | Next.js 14+ (stable) | Simpler code, automatic form handling, built-in revalidation |
| `getServerSideProps` / `getStaticProps` | RSC with async components | Next.js 13+ App Router | Data fetching in component body, no prop drilling |
| Client-side data fetching (SWR/React Query) | RSC for reads, server actions for writes | Next.js 15 | Simpler mental model, no client-side cache management |

**Deprecated/outdated:**
- `pages/` directory: This project uses App Router (`app/`), not Pages Router
- `getServerSideProps`: Replaced by RSC async components
- `useFormState`: Renamed to `useActionState` in React 19

## Open Questions

1. **Template page routing: repurpose or add new?**
   - What we know: `/templates` currently shows `niche_templates` (website templates). CRUD-03 needs message templates.
   - What's unclear: Does the user want both template types accessible? Should niche templates be preserved somewhere?
   - Recommendation: Repurpose `/templates` for message templates (CRUD-03). Move niche template content to `/niche-templates` or defer it. The sidebar "Templates" label maps better to message templates for the admin workflow.

2. **Transition from hardcoded to DB-stored templates**
   - What we know: `packages/shared/src/comms/message-templates.ts` has hardcoded templates as JS functions. The `outreach_queue.message_template` column stores template slugs (e.g., "reminder_1"). The `resolveTemplate()` function maps slugs to template functions.
   - What's unclear: Should the outreach processor be updated to read from DB instead of hardcoded templates, or should that be deferred?
   - Recommendation: For Phase 3, build the CRUD UI and DB table. Seed the table with equivalents of the existing hardcoded templates. Defer updating `resolveTemplate()` to read from DB to Phase 4 or later. This keeps Phase 3 scoped to admin-facing CRUD.

3. **Available template variables**
   - What we know: Existing hardcoded templates use `name`, `businessName`, `packageName`, `onboardingUrl`, `itemsRemaining` (defined in `TemplateParams` interface).
   - What's unclear: Should the admin be shown the list of available variables when editing a template?
   - Recommendation: Yes. Display available variables as a reference panel in the template editor. Use the `TemplateParams` interface keys as the canonical variable list.

## Schema Summary

### Existing Tables (Phase 3 reads/writes)

**service_definitions** - fully exists, soft-delete via `is_active`
- Columns: id, org_id, name, slug, description, required_data_fields (jsonb), setup_steps (jsonb), is_active, created_at, updated_at
- RLS: select (any org member), modify (owner/admin) - both exist
- Unique: (org_id, slug)

**service_packages** - fully exists
- Columns: id, org_id, name, description, price_cents, is_active, created_at, updated_at
- RLS: select (any org member), modify (owner/admin) - both exist

**package_services** - join table, exists but missing write RLS
- Columns: id, package_id, service_id
- RLS: select exists, modify DOES NOT EXIST (must add)
- Unique: (package_id, service_id)

### New Table Required

**message_templates** - must be created
- Columns: id, org_id, name, slug, channel, subject, body, is_active, created_at, updated_at
- RLS: select + modify needed
- Unique: (org_id, slug)

### Type Definitions (already exist in packages/shared/src/types/index.ts)
- `ServiceDefinition` - complete
- `DataFieldDefinition` - complete (key, label, type, required, options, placeholder, help_text)
- `SetupStepDefinition` - complete (key, label, description, automated, task_type)
- `ServicePackage` - complete
- `PackageService` - complete

### New Type Required
```typescript
export interface MessageTemplate {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  channel: "sms" | "email" | "voice";
  subject: string | null;
  body: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

## Sources

### Primary (HIGH confidence)
- Codebase analysis: All migration files (00001 through 00006), types/index.ts, existing page components, RLS policies
- Codebase analysis: Existing admin pages at `/services`, `/packages`, `/templates` examined directly
- Codebase analysis: `packages/shared/src/comms/message-templates.ts` for current template implementation

### Secondary (MEDIUM confidence)
- Next.js 15 server actions pattern: Based on App Router conventions (well-established since Next.js 14)
- `revalidatePath` usage: Standard Next.js cache invalidation pattern

### Tertiary (LOW confidence)
- None. All findings are from direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using only existing dependencies, no new libraries needed
- Architecture: HIGH - Patterns derived from existing codebase conventions (RSC pages, API route mutations, Tailwind styling)
- Pitfalls: HIGH - All identified from direct codebase analysis (missing RLS, missing table, soft-delete semantics)
- Schema: HIGH - All tables examined directly from migration SQL files

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable stack, no fast-moving dependencies)
