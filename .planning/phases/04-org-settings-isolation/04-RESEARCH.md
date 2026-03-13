# Phase 4: Org Settings + Per-Org Isolation - Research

**Researched:** 2026-03-14
**Domain:** Multi-tenant credential isolation, per-org Twilio provisioning, dead letter queue
**Confidence:** HIGH

## Summary

Phase 4 transforms LeadrWizard from shared-credential operation to per-org isolation. Currently, all Twilio, GHL, and Vapi credentials live in environment variables and are shared across every organization. This is both a security risk (one compromise exposes all orgs) and a scaling limitation (single Twilio number for all orgs). The existing `organizations.settings` JSONB column already exists but only holds outreach cadence config and escalation webhook data. The settings page at `/settings` is a static placeholder with disabled inputs.

The work decomposes into four domains: (1) encrypted credential storage infrastructure (new columns or Vault integration), (2) settings UI that writes encrypted credentials, (3) refactoring all comms/automation adapters to fetch per-org credentials instead of env vars, and (4) dead letter queue for failed service tasks. The Twilio phone number provisioning at signup (ORG-01) is the most complex piece because it requires calling the Twilio API during org creation and storing the provisioned number alongside the org record.

**Primary recommendation:** Use application-level AES-256-GCM encryption via Node.js `crypto` module with a single `ENCRYPTION_KEY` environment variable. Store encrypted credentials in dedicated columns on the `organizations` table (not in the JSONB `settings` blob). Refactor all adapter `getXConfig()` functions to accept org-scoped credentials as parameters rather than reading env vars.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CRUD-04 | Admin can configure org settings: Twilio account SID/auth token, GHL API key, outreach cadence config | Settings UI rewrite with server actions pattern from Phase 3, org_update RLS policy needed |
| CRUD-05 | Org settings credentials stored encrypted per-org (not shared globally) | Application-level AES-256-GCM encryption, dedicated encrypted columns, encryption utility module |
| ORG-01 | Each org gets a dedicated Twilio phone number provisioned at signup | Twilio IncomingPhoneNumbers API, provision during handleNewOrgSignup, store number on org record |
| ORG-02 | Each org stores its own GHL API credentials (encrypted), used for CRM operations | Refactor ghl-adapter.ts and ghl-email.ts to accept per-org config, decrypt at runtime |
| ORG-04 | Failed service tasks (5+ failures) moved to dead letter queue table with admin UI to view and retry | New dead_letter_queue table, modify task-processor.ts failure handling, admin DLQ page |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `crypto` | Built-in | AES-256-GCM encryption/decryption | Zero dependencies, native performance, well-audited. Already available in Next.js server context |
| Supabase JS | ^2.49.0 | Database operations for credential storage | Already in use, service role client bypasses RLS for cron/webhook contexts |
| Next.js 15 Server Actions | ^15.1.0 | Settings form submission | Established pattern from Phase 3 (services, packages, templates CRUD) |
| Twilio REST API | Direct fetch | Phone number provisioning | No SDK needed, two API calls (search + buy), raw fetch matches existing Twilio adapter pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | ^0.468.0 | Icons for settings UI, DLQ page | Already in use for all admin pages |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| App-level encryption | Supabase Vault | Vault stores secrets in a separate table, making per-org credential lookup harder (UUID-based, not org_id-keyed). pgsodium is pending deprecation. App-level encryption is simpler and portable |
| App-level encryption | pgcrypto | DB-level encryption is transparent but requires SQL function calls for every read/write. App-level keeps encryption logic in TypeScript where it's testable and portable |
| Direct Twilio API | twilio SDK | SDK adds 50MB+ to node_modules. Existing pattern uses raw fetch for Twilio. Two API calls don't justify a full SDK |

## Architecture Patterns

### Recommended Project Structure
```
packages/shared/src/
  crypto/
    index.ts              # encrypt(), decrypt(), encryptOrgCredentials(), decryptOrgCredentials()
  tenant/
    org-manager.ts        # updateOrgSettings() already exists, add updateOrgCredentials()
  comms/
    twilio-sms.ts         # Refactor: getTwilioConfig() accepts org credentials param
    ghl-email.ts          # Refactor: getGHLConfig() accepts org credentials param
    outreach-processor.ts # Fetch org credentials before processing each item
  automations/
    ghl-adapter.ts        # Refactor: getGHLConfig() accepts org credentials param
    task-processor.ts     # Add DLQ check at 5+ failures
    twilio-provisioner.ts # NEW: search + buy Twilio phone number

apps/admin/src/app/(dashboard)/
  settings/
    page.tsx              # Rewrite: server component fetching org settings
    actions.ts            # NEW: server actions for credential save, cadence update
    credentials-form.tsx  # NEW: client component for Twilio/GHL/Vapi credential entry
    cadence-form.tsx      # NEW: client component for outreach cadence config
  dead-letter-queue/
    page.tsx              # NEW: list DLQ entries with retry action
    actions.ts            # NEW: server actions for retry, dismiss

supabase/migrations/
  00008_org_credentials_and_dlq.sql  # encrypted columns, DLQ table, org update RLS
```

### Pattern 1: Application-Level Encryption
**What:** Encrypt sensitive credentials (API keys, auth tokens) before storing in the database. Decrypt on read. Single ENCRYPTION_KEY env var shared across the app.
**When to use:** Whenever writing or reading org credentials.
**Example:**
```typescript
// packages/shared/src/crypto/index.ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("Missing ENCRYPTION_KEY environment variable");
  // Key must be 32 bytes (256 bits). Accept hex-encoded or base64.
  return Buffer.from(key, "hex");
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Format: iv:tag:ciphertext (all base64)
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decrypt(encoded: string): string {
  const key = getEncryptionKey();
  const [ivB64, tagB64, dataB64] = encoded.split(":");

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]).toString("utf8");
}
```

### Pattern 2: Per-Org Credential Resolution
**What:** Adapter functions accept an optional config parameter. When provided, use it. When absent, fall back to env vars (backward compatible during migration).
**When to use:** Every adapter that currently reads from env vars.
**Example:**
```typescript
// Refactored getTwilioConfig in twilio-sms.ts
export function getTwilioConfig(
  orgConfig?: { accountSid: string; authToken: string; phoneNumber: string }
): TwilioConfig {
  if (orgConfig) {
    return {
      accountSid: orgConfig.accountSid,
      authToken: orgConfig.authToken,
      fromNumber: orgConfig.phoneNumber,
    };
  }
  // Fallback to env vars (backward compat for cron jobs without org context)
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("Missing Twilio config");
  }
  return { accountSid, authToken, fromNumber };
}
```

### Pattern 3: Outreach Processor Org Resolution
**What:** When processing outreach queue items, resolve the org's credentials before sending. Each outreach item already has a `client_id`. Resolve org_id via client, then fetch + decrypt org credentials.
**When to use:** In processOutreachItem and processServiceTasks.
**Example:**
```typescript
// In outreach-processor.ts processOutreachItem():
// 1. Fetch client (already done)
// 2. Resolve org_id from client.org_id (client table has org_id column)
// 3. Fetch org record with encrypted credential columns
// 4. Decrypt credentials
// 5. Pass decrypted config to sendSMS/sendEmail/initiateOutboundCall
```

### Pattern 4: Dead Letter Queue
**What:** After 5 failed attempts, move the task to a DLQ table with full error context. Create an escalation automatically.
**When to use:** In task-processor.ts when attempt_count reaches 5.
**Example:**
```typescript
// In task-processor.ts, after incrementing attempt_count:
if (task.attempt_count >= 5) {
  // Insert into dead_letter_queue
  await supabase.from("dead_letter_queue").insert({
    original_table: "service_tasks",
    original_id: task.id,
    task_type: task.task_type,
    client_service_id: task.client_service_id,
    last_error: error.message,
    attempt_count: task.attempt_count,
    payload: task.last_result,
  });
  // Mark original task as failed
  await supabase.from("service_tasks").update({
    status: "failed",
    last_result: { ...task.last_result, moved_to_dlq: true },
  }).eq("id", task.id);
}
```

### Anti-Patterns to Avoid
- **Storing plaintext credentials in JSONB `settings`:** The existing `settings` column is queryable by any RLS-permitted user. Credentials must go in separate encrypted columns.
- **Encrypting the entire settings blob:** Makes it impossible to read non-sensitive settings (outreach cadence) without decryption. Only encrypt actual secrets.
- **Using Supabase Vault for per-org secrets:** Vault is designed for global secrets (one API key for the whole app), not per-row secrets keyed by org_id. Forces UUID-based lookups and breaks the natural data model.
- **Provisioning Twilio numbers synchronously in the settings form:** Phone number provisioning should happen async or at signup. If done in the settings form, network failures make the UX fragile.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Encryption | Custom cipher construction | Node.js `crypto` with AES-256-GCM | Crypto is hard. Standard library handles IV generation, auth tags, padding correctly |
| Key derivation | Custom key stretching | Pre-generated 32-byte hex key in env var | ENCRYPTION_KEY should be generated once (openssl rand -hex 32) and stored in Vercel env vars |
| Twilio phone search | Custom phone number validation | Twilio AvailablePhoneNumbers API | Twilio handles number availability, regulatory compliance, E.164 formatting |
| Form state management | Custom form reducer | useActionState (React 19) | Already established in Phase 3 service/package/template forms |

**Key insight:** The encryption layer is thin (two functions: encrypt/decrypt). The real complexity is in the plumbing: every adapter that reads env vars needs refactoring, and the outreach/task processors need org context threaded through their execution paths.

## Common Pitfalls

### Pitfall 1: Missing RLS Update Policy on Organizations
**What goes wrong:** There is no RLS policy for UPDATE on the `organizations` table. Only a SELECT policy exists (`org_members_read_org`). Server actions using the anon-key SSR client (createSupabaseServerClient) will silently fail to update org settings.
**Why it happens:** The initial schema (00001) only added a SELECT policy for organizations. UPDATE was never needed until now.
**How to avoid:** Add an explicit UPDATE policy for owner/admin roles in the migration. The server actions use the SSR client (anon key + user session), not the service role client.
**Warning signs:** Settings form submits without error but values don't persist. Check RLS policies on organizations table.

### Pitfall 2: Outreach Queue Items Lack org_id
**What goes wrong:** The outreach_queue table doesn't have an org_id column. To resolve org credentials for sending, you must JOIN through clients.org_id. This adds a query per outreach item.
**Why it happens:** Outreach queue was designed when everything used global env vars.
**How to avoid:** When processing outreach items, batch-resolve org credentials. Group items by client_id, fetch clients with org_id in bulk, then fetch org credentials once per org. Or add org_id to outreach_queue in the migration.
**Warning signs:** N+1 queries in processOutreachQueue when resolving per-org Twilio config.

### Pitfall 3: Encryption Key Rotation Not Planned
**What goes wrong:** If ENCRYPTION_KEY is compromised, all credentials need re-encryption. Without a versioned format, you can't distinguish old-key vs new-key ciphertexts.
**Why it happens:** Simple encryption implementations assume the key never changes.
**How to avoid:** Include a key version prefix in the encrypted format (e.g., `v1:iv:tag:ciphertext`). For v1 launch, this is documentation-only, not a multi-key implementation. Just prefix so future rotation is possible.
**Warning signs:** None initially. This is a forward-looking design decision.

### Pitfall 4: Twilio Number Provisioning Failure During Signup
**What goes wrong:** If Twilio number provisioning fails during org signup, the org is created without a phone number. No retry mechanism exists.
**Why it happens:** External API calls are unreliable. Twilio might rate-limit, have no numbers available in the requested area, or timeout.
**How to avoid:** Make phone number provisioning non-blocking. Create the org first (atomic via provision_org), then attempt number provisioning as a follow-up. If it fails, store the failure state and allow retry from the settings page. The org should still be functional (just without SMS capability until a number is provisioned).
**Warning signs:** Orgs exist in the database but have null twilio_phone_number.

### Pitfall 5: Dead Letter Queue Entries Pile Up Without Alerting
**What goes wrong:** Tasks silently move to DLQ but nobody notices because there's no notification.
**Why it happens:** DLQ is just a table. Without active monitoring, it's a write-only log.
**How to avoid:** Create an escalation automatically when a task moves to DLQ. The escalation system already has Slack/Google Chat notifications. Also show DLQ count badge in the sidebar navigation.
**Warning signs:** Growing DLQ table with no admin action.

## Code Examples

### Database Migration: Encrypted Columns + DLQ + RLS
```sql
-- 00008_org_credentials_and_dlq.sql

-- Add encrypted credential columns to organizations
-- These store AES-256-GCM encrypted values (iv:tag:ciphertext format)
alter table public.organizations
  add column if not exists twilio_account_sid_encrypted text,
  add column if not exists twilio_auth_token_encrypted text,
  add column if not exists twilio_phone_number text,  -- not encrypted, needed for display
  add column if not exists ghl_api_key_encrypted text,
  add column if not exists ghl_location_id text,  -- not secret, just config
  add column if not exists ghl_company_id text,
  add column if not exists vapi_api_key_encrypted text,
  add column if not exists vapi_assistant_id text,
  add column if not exists elevenlabs_agent_id text;

-- RLS: Allow org owner/admin to update their organization
create policy "org_owners_update" on public.organizations
  for update using (
    id in (
      select org_id from public.org_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- Dead letter queue table
create table public.dead_letter_queue (
  id uuid primary key default uuid_generate_v4(),
  original_table text not null,  -- 'service_tasks' or 'outreach_queue'
  original_id uuid not null,
  task_type text,
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  last_error text,
  attempt_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  retried_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_dlq_org on public.dead_letter_queue(org_id);
create index idx_dlq_active on public.dead_letter_queue(org_id)
  where retried_at is null and dismissed_at is null;

alter table public.dead_letter_queue enable row level security;

create policy "dlq_select" on public.dead_letter_queue
  for select using (
    org_id in (
      select org_id from public.org_members where user_id = auth.uid()
    )
  );

create policy "dlq_update" on public.dead_letter_queue
  for update using (
    org_id in (
      select org_id from public.org_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );
```

### Twilio Phone Number Provisioning
```typescript
// packages/shared/src/automations/twilio-provisioner.ts

interface TwilioProvisionConfig {
  accountSid: string;
  authToken: string;
}

export async function provisionPhoneNumber(
  config: TwilioProvisionConfig,
  options: { country?: string; areaCode?: string; smsEnabled?: boolean } = {}
): Promise<{ phoneNumber: string; sid: string }> {
  const country = options.country || "US";
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

  // 1. Search for available numbers
  const searchParams = new URLSearchParams({
    SmsEnabled: String(options.smsEnabled ?? true),
    VoiceEnabled: "true",
    ...(options.areaCode ? { AreaCode: options.areaCode } : {}),
  });

  const searchUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/AvailablePhoneNumbers/${country}/Local.json?${searchParams}`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!searchRes.ok) {
    throw new Error(`Twilio number search failed: ${searchRes.status}`);
  }

  const { available_phone_numbers } = await searchRes.json() as {
    available_phone_numbers: Array<{ phone_number: string; friendly_name: string }>;
  };

  if (!available_phone_numbers?.length) {
    throw new Error("No phone numbers available in the requested area");
  }

  // 2. Purchase the first available number
  const buyUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json`;

  const buyRes = await fetch(buyUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      PhoneNumber: available_phone_numbers[0].phone_number,
    }),
  });

  if (!buyRes.ok) {
    throw new Error(`Twilio number purchase failed: ${buyRes.status}`);
  }

  const result = await buyRes.json() as { phone_number: string; sid: string };
  return { phoneNumber: result.phone_number, sid: result.sid };
}
```

### Settings Server Action Pattern
```typescript
// apps/admin/src/app/(dashboard)/settings/actions.ts
"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { encrypt } from "@leadrwizard/shared/crypto";
import { revalidatePath } from "next/cache";

async function getAuthedOrg() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const orgData = await getUserOrg(supabase, user.id);
  if (!orgData || !["owner", "admin"].includes(orgData.role)) {
    throw new Error("Insufficient permissions");
  }
  return { supabase, orgId: orgData.org.id };
}

export async function saveTwilioCredentials(formData: FormData) {
  const { supabase, orgId } = await getAuthedOrg();

  const accountSid = (formData.get("twilio_account_sid") as string)?.trim();
  const authToken = (formData.get("twilio_auth_token") as string)?.trim();

  if (!accountSid || !authToken) {
    throw new Error("Twilio Account SID and Auth Token are required");
  }

  const { error } = await supabase
    .from("organizations")
    .update({
      twilio_account_sid_encrypted: encrypt(accountSid),
      twilio_auth_token_encrypted: encrypt(authToken),
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Global env vars for Twilio/GHL | Per-org encrypted DB credentials | This phase | Every adapter needs refactoring to accept org config |
| Static settings page (disabled inputs) | Functional server action forms | This phase | Settings page becomes primary integration config surface |
| Failed tasks disappear after 3 attempts | Dead letter queue with admin visibility | This phase | Ops visibility for persistent failures |
| Shared phone number for all orgs | Dedicated per-org Twilio number | This phase | Better deliverability, A2P compliance, sender trust |

**Deprecated/outdated:**
- pgsodium: Supabase has announced pending deprecation. Vault will migrate internally but standalone pgsodium usage should be avoided.
- `organizations.settings` JSONB for credentials: This field should remain for non-sensitive config (outreach cadence, escalation channel). Sensitive credentials go in dedicated encrypted columns.

## Open Questions

1. **Twilio number provisioning timing**
   - What we know: Numbers can be searched and purchased via REST API. Costs ~$1.15/month per US local number.
   - What's unclear: Should provisioning happen during Stripe checkout webhook (fully automatic) or deferred to settings page (manual trigger)?
   - Recommendation: Attempt automatic provisioning during signup using the platform's shared Twilio account. If it fails, org gets created without a number and admin can provision later from settings. Store provisioning status on org record.

2. **Twilio sub-accounts vs shared account**
   - What we know: Each org stores their own Twilio credentials (CRUD-04). ORG-01 says "dedicated phone number provisioned at signup."
   - What's unclear: Are orgs expected to bring their own Twilio accounts, or does the platform provision numbers on the platform's Twilio account?
   - Recommendation: Support both. At signup, provision a number on the platform's Twilio account (using platform env vars). In settings, admins can optionally enter their own Twilio Account SID/Auth Token, which overrides the platform-provisioned number. The credential fields are optional, not required.

3. **GHL credential validation on save**
   - What we know: GHL API key can be validated by making a test API call.
   - What's unclear: Should the settings form validate credentials before saving, or save them and let failures surface during operations?
   - Recommendation: Validate on save with a lightweight GHL API call (e.g., GET /locations/{locationId}). Show validation result in the UI. Save even if validation fails (the admin might be pre-configuring for later), but show a warning.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `packages/shared/src/comms/twilio-sms.ts` - confirmed global env var pattern for Twilio (lines 37-48)
- Codebase analysis: `packages/shared/src/automations/ghl-adapter.ts` - confirmed global env var pattern for GHL (lines 29-39)
- Codebase analysis: `packages/shared/src/comms/ghl-email.ts` - confirmed global env var pattern for GHL email (lines 27-36)
- Codebase analysis: `supabase/migrations/00001_initial_schema.sql` - confirmed organizations.settings JSONB schema (lines 9-32)
- Codebase analysis: `apps/admin/src/app/(dashboard)/settings/page.tsx` - confirmed static placeholder UI
- Codebase analysis: No UPDATE RLS policy exists on organizations table (only SELECT via `org_members_read_org`)
- [Supabase Vault docs](https://supabase.com/docs/guides/database/vault) - Vault is for global secrets, not per-row encryption
- [pgsodium deprecation notice](https://supabase.com/docs/guides/database/extensions/pgsodium) - pgsodium pending deprecation
- [Twilio IncomingPhoneNumber API](https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource) - POST to provision numbers
- [Twilio AvailablePhoneNumbers API](https://www.twilio.com/docs/phone-numbers/global-catalog/api/available-numbers) - GET to search numbers

### Secondary (MEDIUM confidence)
- [Node.js AES-256-GCM pattern](https://gist.github.com/rjz/15baffeab434b8125ca4d783f4116d81) - verified against Node.js crypto docs
- [Building Server-Side API Key Encryption](https://medium.com/@jballo/building-server-side-api-key-encryption-with-convex-and-node-js-crypto-29f69e0de8c6) - application-level encryption pattern confirmation
- `.planning/codebase/CONCERNS.md` - confirmed "GHL API Credentials in Environment Variables Shared Across All Orgs" as identified security concern

### Tertiary (LOW confidence)
- None. All findings verified against codebase and official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Node.js crypto is built-in, pattern well-established, no external dependencies
- Architecture: HIGH - All adapter files examined, refactoring paths clear, no ambiguity in where changes go
- Pitfalls: HIGH - Missing RLS policy confirmed by grep across all migrations, outreach queue schema examined
- DLQ design: HIGH - Existing task-processor.ts failure handling examined (3-attempt limit), clear extension point
- Twilio provisioning: MEDIUM - API endpoints confirmed via official docs, but provisioning timing is a design decision

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable domain, no fast-moving dependencies)
