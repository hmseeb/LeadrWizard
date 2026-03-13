# Phase 2: Self-Service Signup - Research

**Researched:** 2026-03-14
**Domain:** Stripe Checkout -> org provisioning -> Supabase auth -> admin dashboard empty state
**Confidence:** HIGH

## Summary

Phase 2 turns LeadrWizard from a manually-provisioned platform into a self-service SaaS. The flow: agency visits pricing page, clicks "Sign Up", completes Stripe Checkout, webhook fires, org + user + membership + subscription all get created atomically, admin gets a welcome email with a set-password link, logs in and sees an empty-state setup wizard.

The codebase is 80% ready. The Stripe webhook handler (`stripe/route.ts`) already has signature verification and idempotency. The `processStripeWebhook` function already handles `checkout.session.completed` but only for EXISTING orgs (it reads `org_id` from session metadata). The `createOrganization` function in `org-manager.ts` already creates orgs and owner memberships. The admin app has auth (login, middleware, callback) and a full dashboard layout with sidebar. What's missing: the webhook handler needs to create orgs for NEW signups (no org_id in metadata), Supabase auth user creation, welcome email, and the empty-state setup wizard UI.

**Primary recommendation:** Extend `processStripeWebhook` to detect "new signup" vs "existing org upgrade" based on whether `org_id` exists in session metadata. For new signups, create an atomic `provision_org` plpgsql function similar to the existing `provision_client`. Use Supabase's `auth.admin.inviteUserByEmail()` for welcome email with set-password link. Build the setup wizard as a client component that checks org state and shows contextual next steps.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SIGN-01 | Agency completes Stripe checkout and org is auto-provisioned (org record + membership + subscription) via `checkout.session.completed` webhook | Extend `processStripeWebhook` to handle new signup flow. Create `provision_org` plpgsql function for atomicity. Create a public-facing checkout session creator that doesn't require auth. |
| SIGN-02 | New org admin receives welcome email with link to set password and access dashboard | Use `supabase.auth.admin.inviteUserByEmail()` which sends an invite email with a link. Configure Supabase email template. Add redirect URL to allowed list. |
| SIGN-03 | New org dashboard shows empty state with setup wizard guiding through: add services, configure package, set up integrations | Check org state (services count, packages count, integrations configured) server-side. Render setup wizard component when org has no content. |
| SIGN-04 | Stripe CLI configured for local webhook testing with forwarding to dev server | `stripe listen --forward-to localhost:3000/api/webhooks/stripe --events checkout.session.completed`. Document setup in dev docs. Add `STRIPE_WEBHOOK_SECRET` from CLI output. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| stripe | 20.4.1 | Stripe SDK for checkout sessions and webhooks | Already installed in packages/shared |
| @supabase/supabase-js | ^2.49.0 | Auth admin API (inviteUserByEmail, createUser) | Already installed, provides service role access |
| @supabase/ssr | ^0.5.0 | Server-side Supabase client for Next.js | Already installed in apps/admin |
| next | ^15.1.0 | App Router API routes for webhook + new checkout endpoint | Already installed |
| lucide-react | ^0.468.0 | Icons for setup wizard UI | Already installed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Stripe CLI | latest | Local webhook testing | Dev environment only |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| supabase inviteUserByEmail | supabase createUser + custom email | inviteUserByEmail handles email sending and token generation automatically. Custom email requires email service setup (Resend, SendGrid). Use inviteUserByEmail for simplicity. |
| plpgsql provision_org function | Sequential JS inserts | Same reasoning as existing provision_client: atomicity prevents orphaned records on partial failure |

## Architecture Patterns

### Current State Analysis

**What exists:**

1. **Stripe webhook handler** (`apps/admin/src/app/api/webhooks/stripe/route.ts`):
   - Signature verification via `constructEvent()`
   - Idempotency via `processed_webhook_events` table
   - Calls `processStripeWebhook()` for event processing

2. **processStripeWebhook** (`packages/shared/src/billing/stripe-adapter.ts`):
   - Handles `checkout.session.completed` but assumes `org_id` exists in `session.metadata`
   - Creates `org_subscriptions` record and updates `organizations.stripe_customer_id`
   - Also handles `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`

3. **Org creation** (`packages/shared/src/tenant/org-manager.ts`):
   - `createOrganization()`: creates org + owner membership (non-atomic, two separate inserts)
   - `getUserOrg()`: finds user's org via org_members join

4. **Existing checkout flow** (`apps/admin/src/app/api/billing/checkout/route.ts`):
   - Requires authenticated user with existing org
   - Uses `getUserOrg()` to get org_id, passes it to `createCheckoutSession()`
   - Not suitable for self-service signup (no user/org exists yet)

5. **Auth infrastructure**:
   - Middleware redirects unauthenticated users to `/login` (excludes `/api/webhooks/*`)
   - Login page supports password + magic link
   - Setup page (`/setup`) creates org for authenticated users without one
   - Callback route (`/callback`) handles Supabase auth code exchange

6. **Database schema**:
   - `organizations` table has `stripe_customer_id`, `plan_slug`, `onboarding_completed` columns
   - `org_members` table with `(org_id, user_id)` unique constraint
   - `org_subscriptions` table with active subscription unique index per org
   - `subscription_plans` seeded with Starter ($99), Growth ($249), Scale ($499)

**What's missing:**

1. **Public checkout endpoint**: A route that creates a Stripe Checkout session WITHOUT requiring auth. The agency is a new visitor, not yet a user.
2. **New-signup webhook logic**: When `checkout.session.completed` fires with no `org_id` in metadata, the handler needs to create org + auth user + membership + subscription atomically.
3. **`provision_org` plpgsql function**: Atomic org creation similar to `provision_client`.
4. **Supabase auth user creation**: Using admin API to create the user and send invite email.
5. **Empty-state setup wizard**: Dashboard component that detects fresh org and guides admin.
6. **Stripe CLI dev tooling**: Configuration and documentation for local testing.
7. **Middleware update**: Allow `/setup` and invite-related routes without auth redirect loops.

### Recommended Flow Architecture

```
Agency visits pricing page
    |
    v
POST /api/signup/checkout  (NEW, public, no auth required)
    |-- Receives: { planSlug, email, orgName }
    |-- Creates Stripe Checkout Session with metadata: { plan_slug, org_name, admin_email }
    |-- NO org_id in metadata (org doesn't exist yet)
    |-- Returns: { checkoutUrl }
    |
    v
Agency completes Stripe Checkout (Stripe hosted page)
    |
    v
Stripe fires checkout.session.completed webhook
    |
    v
POST /api/webhooks/stripe  (existing route)
    |-- Signature verification (existing)
    |-- Idempotency check (existing)
    |-- processStripeWebhook() detects NO org_id in metadata
    |
    v
New signup branch in processStripeWebhook:
    1. Call supabase.rpc('provision_org', { org_name, admin_email, plan_slug, ... })
       -> Creates: organization, org_subscription
       -> Returns: org_id
    2. Call supabase.auth.admin.inviteUserByEmail(admin_email, { data: { org_id }, redirectTo })
       -> Creates auth user
       -> Sends invite email with set-password link
    3. Insert org_members (org_id, user_id from step 2, role: 'owner')
    4. Update organizations.stripe_customer_id
    |
    v
Admin receives welcome email
    |-- Clicks "Set Password" link
    |-- Redirected to /callback with invite token
    |-- Sets password via Supabase auth
    |-- Redirected to /dashboard
    |
    v
Dashboard detects empty org state
    |-- Shows SetupWizard component
    |-- Steps: Add Services -> Configure Package -> Set Up Integrations
```

### Recommended Project Structure (new files)
```
apps/admin/src/app/
  api/
    signup/
      checkout/
        route.ts          # Public checkout session creator (no auth)
  (dashboard)/
    dashboard/
      page.tsx            # Modified to detect empty state
      setup-wizard.tsx    # Client component: guided setup steps

packages/shared/src/
  billing/
    stripe-adapter.ts     # Extended processStripeWebhook with new-signup branch
  tenant/
    org-manager.ts        # Add provisionOrgFromWebhook() function

supabase/migrations/
  00006_provision_org.sql  # provision_org plpgsql function
```

### Pattern 1: Detecting New Signup vs Existing Org Upgrade
**What:** Branch in webhook handler based on metadata content
**When to use:** `checkout.session.completed` event arrives
**Example:**
```typescript
// In processStripeWebhook, checkout.session.completed case:
case "checkout.session.completed": {
  const session = event.data.object as Stripe.Checkout.Session;
  const orgId = session.metadata?.org_id;

  if (orgId) {
    // EXISTING flow: org upgrading plan (current code)
    await handleExistingOrgCheckout(supabase, session, orgId);
  } else {
    // NEW flow: self-service signup
    await handleNewOrgSignup(supabase, session);
  }
  break;
}
```

### Pattern 2: Atomic Org Provisioning via plpgsql
**What:** Single-transaction org + subscription creation
**When to use:** New org signup from webhook
**Example:**
```sql
-- Similar to existing provision_client pattern
create or replace function public.provision_org(
  p_org_name       text,
  p_admin_email    text,
  p_plan_slug      text,
  p_stripe_sub_id  text,
  p_stripe_cust_id text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_org  public.organizations%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_slug text;
begin
  -- Idempotency: check if org already exists for this Stripe customer
  select * into v_org from public.organizations
  where stripe_customer_id = p_stripe_cust_id;

  if found then
    return jsonb_build_object('org_id', v_org.id, 'idempotent', true);
  end if;

  -- Generate slug
  v_slug := lower(regexp_replace(p_org_name, '[^a-z0-9]+', '-', 'gi'));
  v_slug := trim(both '-' from v_slug);

  -- Handle slug collision
  if exists (select 1 from public.organizations where slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 6);
  end if;

  -- Get plan
  select * into v_plan from public.subscription_plans
  where slug = p_plan_slug and is_active = true;

  -- Create org
  insert into public.organizations (name, slug, stripe_customer_id, plan_slug)
  values (p_org_name, v_slug, p_stripe_cust_id, p_plan_slug)
  returning * into v_org;

  -- Create subscription
  insert into public.org_subscriptions (
    org_id, plan_id, stripe_subscription_id,
    stripe_customer_id, status,
    current_period_start, current_period_end
  ) values (
    v_org.id, v_plan.id, p_stripe_sub_id,
    p_stripe_cust_id, 'active',
    now(), now() + interval '30 days'
  );

  return jsonb_build_object('org_id', v_org.id, 'idempotent', false);
end;
$$;
```

### Pattern 3: Supabase Auth Invite for Welcome Email
**What:** Create user + send welcome email in one call
**When to use:** After org is provisioned in webhook handler
**Example:**
```typescript
// Source: Supabase official docs - auth-admin-inviteuserbyemail
const { data: inviteData, error: inviteError } =
  await supabase.auth.admin.inviteUserByEmail(adminEmail, {
    data: { org_id: orgId, role: "owner" },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/callback`,
  });

if (inviteError) throw new Error(`Invite failed: ${inviteError.message}`);

// Create org membership linking user to org
await supabase.from("org_members").insert({
  org_id: orgId,
  user_id: inviteData.user.id,
  role: "owner",
});
```

### Pattern 4: Empty State Setup Wizard
**What:** Detect fresh org and show guided setup
**When to use:** Dashboard page when org has zero services/packages
**Example:**
```typescript
// Server component checks
const [
  { count: serviceCount },
  { count: packageCount },
  { data: org },
] = await Promise.all([
  supabase.from("service_definitions").select("*", { count: "exact", head: true }).eq("org_id", orgId),
  supabase.from("service_packages").select("*", { count: "exact", head: true }).eq("org_id", orgId),
  supabase.from("organizations").select("onboarding_completed").eq("id", orgId).single(),
]);

const showWizard = !org?.onboarding_completed && (serviceCount === 0 || packageCount === 0);
```

### Anti-Patterns to Avoid
- **Creating auth user before org in webhook:** If user creation succeeds but org creation fails, you have an orphaned auth user. Create org first (via RPC), then auth user.
- **Using createUser + custom email service:** inviteUserByEmail does both. Don't hand-roll email sending when Supabase handles it.
- **Storing sensitive data in Stripe metadata:** Metadata is visible in Stripe Dashboard. Only store org_name, plan_slug, admin_email (not passwords, tokens).
- **Creating the checkout session with org_id for new signups:** The org doesn't exist yet. The metadata should contain the data needed to CREATE the org, not reference an existing one.
- **Non-atomic org provisioning:** Without a plpgsql function, partial failures leave orphaned records. The existing `provision_client` pattern proves this approach works.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Welcome email | Custom SMTP/email service integration | `supabase.auth.admin.inviteUserByEmail()` | Handles email sending, token generation, link creation, and password set flow. Supabase already has email templates. |
| Org provisioning atomicity | Sequential INSERT statements | plpgsql `provision_org` function | Same pattern as `provision_client`. Prevents orphaned records on partial failure. |
| Auth token/invite link | Custom JWT + email link | Supabase invite flow | Supabase handles invite tokens, expiry, and password-setting automatically via built-in auth. |
| Slug generation/collision | Custom slug logic in JS | SQL function with collision check | Done in transaction, no TOCTOU race condition. |
| Stripe webhook signature verification | Manual HMAC | `stripe.webhooks.constructEvent()` | Already implemented. Never re-implement crypto. |

**Key insight:** Supabase's auth admin API and the existing webhook infrastructure do 90% of the heavy lifting. The main new code is: (1) a public checkout endpoint, (2) a new-signup branch in the webhook handler, (3) a provision_org SQL function, and (4) a setup wizard React component.

## Common Pitfalls

### Pitfall 1: Stripe Checkout for New Users Requires a Public Endpoint
**What goes wrong:** The existing `/api/billing/checkout` route requires authentication. New agencies don't have an account yet.
**Why it happens:** The current checkout flow was designed for existing orgs upgrading their plan.
**How to avoid:** Create a separate `/api/signup/checkout` route that is explicitly public. Add it to the middleware exclusion list alongside `/api/webhooks/*`.
**Warning signs:** 401 errors when trying to create a checkout session for the signup flow.

### Pitfall 2: Supabase inviteUserByEmail Requires Correct Redirect URL Config
**What goes wrong:** Invite email links redirect to `localhost:3000` in production, or to the wrong path.
**Why it happens:** Supabase's redirect URL must be in the project's allowed redirect URLs list (configured in Supabase Dashboard > Auth > URL Configuration). The `redirectTo` parameter must be a full URL (not just a path).
**How to avoid:** Add `https://your-domain.com/callback` to Supabase's allowed redirect URLs. Use `NEXT_PUBLIC_APP_URL` env var for the redirectTo parameter.
**Warning signs:** Email links going to localhost, or "Invalid redirect URL" errors in Supabase logs.

### Pitfall 3: Webhook Handler Must Work with Service Role Client
**What goes wrong:** The webhook handler uses `createServerClient()` from `packages/shared/src/supabase/client.ts` (service role). But `auth.admin.inviteUserByEmail()` requires service role access.
**Why it happens:** The shared `createServerClient()` already uses `SUPABASE_SERVICE_ROLE_KEY`, so this should work. But the admin app's `createSupabaseServerClient()` in `apps/admin/src/lib/supabase-server.ts` uses the ANON key with cookies.
**How to avoid:** The webhook handler already uses `createServerClient()` from shared (service role). Verify `inviteUserByEmail` is called on THIS client, not the cookie-based one.
**Warning signs:** "Not authorized" errors when calling admin auth methods.

### Pitfall 4: Race Condition Between Webhook and User Clicking Invite Link
**What goes wrong:** User receives email and clicks the link before the webhook fully completes processing.
**Why it happens:** Email delivery can be fast. If the webhook handler is slow, the user might land on the callback page before their org_membership record exists.
**How to avoid:** The `provision_org` RPC and `org_members` insert must complete BEFORE `inviteUserByEmail` is called. The invite email takes a few seconds to deliver, providing natural buffering.
**Warning signs:** User lands on dashboard but `getUserOrg()` returns null.

### Pitfall 5: Stripe CLI Webhook Secret is Different from Production
**What goes wrong:** Developer sets up Stripe CLI, gets a webhook signing secret (`whsec_...`), but the code uses the production webhook secret.
**Why it happens:** Stripe CLI generates a temporary secret for local forwarding that's different from the secret in the Stripe Dashboard.
**How to avoid:** Use `STRIPE_WEBHOOK_SECRET` env var. In `.env.local`, set it to the Stripe CLI signing secret. In production, set it to the Dashboard webhook secret.
**Warning signs:** "Webhook signature verification failed" errors in local dev.

### Pitfall 6: Checkout Session customer_details May Not Have org_name
**What goes wrong:** Stripe Checkout collects email and card info, but doesn't have a field for "organization name" by default.
**Why it happens:** Stripe Checkout's built-in fields are for billing, not app-specific data.
**How to avoid:** Collect `orgName` in our signup form BEFORE redirecting to Stripe. Store it in the Checkout session's `metadata.org_name`. Also store `metadata.admin_email` even though Stripe collects email, so we have it reliably in the webhook.
**Warning signs:** Org created with blank name, or having to make an extra API call to get customer email from Stripe.

### Pitfall 7: Middleware Must Allow Invite Callback Path
**What goes wrong:** User clicks invite link, gets redirected to `/callback`, but middleware redirects them to `/login` because they're not authenticated yet.
**Why it happens:** The middleware checks for auth on all non-excluded paths. The callback route IS excluded (`/callback`), but the user also needs access to a password-set page.
**How to avoid:** Verify the middleware exclusions: `/callback` is already excluded. After the callback exchanges the code for a session, the user is authenticated and can access the dashboard. If a separate `/set-password` page is needed, add it to middleware exclusions.
**Warning signs:** Infinite redirect loop between `/callback` and `/login`.

### Pitfall 8: Duplicate Webhook Events
**What goes wrong:** Stripe sends the same `checkout.session.completed` event twice, creating duplicate orgs.
**Why it happens:** Stripe retries webhooks if your endpoint returns 5xx or times out.
**How to avoid:** Idempotency is already implemented via `processed_webhook_events` table. The `provision_org` RPC should also be idempotent (check for existing org with same `stripe_customer_id`).
**Warning signs:** Multiple orgs with same Stripe customer ID.

## Code Examples

### Public Signup Checkout Endpoint
```typescript
// apps/admin/src/app/api/signup/checkout/route.ts
// Source: Stripe API docs - create checkout session
import { NextResponse } from "next/server";
import Stripe from "stripe";

export async function POST(request: Request) {
  const { planSlug, email, orgName } = await request.json();

  if (!planSlug || !email || !orgName) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  // Look up price ID from plan slug
  const supabase = createServerClient();
  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("stripe_price_id")
    .eq("slug", planSlug)
    .eq("is_active", true)
    .single();

  if (!plan?.stripe_price_id) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: email,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    metadata: {
      signup: "true",         // Flag to distinguish from org upgrade
      org_name: orgName,
      admin_email: email,
      plan_slug: planSlug,
    },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/signup?cancelled=true`,
  });

  return NextResponse.json({ checkoutUrl: session.url });
}
```

### New Signup Branch in Webhook Handler
```typescript
// In processStripeWebhook - new signup branch
async function handleNewOrgSignup(
  supabase: SupabaseClient,
  session: Stripe.Checkout.Session
): Promise<void> {
  const orgName = session.metadata?.org_name || "My Agency";
  const adminEmail = session.metadata?.admin_email || session.customer_details?.email || "";
  const planSlug = session.metadata?.plan_slug || "starter";
  const subscriptionId = session.subscription as string;
  const customerId = session.customer as string;

  if (!adminEmail) throw new Error("No email found in checkout session");

  // 1. Atomically create org + subscription
  const { data: result, error } = await supabase.rpc("provision_org", {
    p_org_name: orgName,
    p_admin_email: adminEmail,
    p_plan_slug: planSlug,
    p_stripe_sub_id: subscriptionId,
    p_stripe_cust_id: customerId,
  });

  if (error) throw new Error(`Org provisioning failed: ${error.message}`);
  if (result.idempotent) return; // Already processed

  const orgId = result.org_id;

  // 2. Create auth user and send invite email
  const { data: inviteData, error: inviteError } =
    await supabase.auth.admin.inviteUserByEmail(adminEmail, {
      data: { org_id: orgId, role: "owner", org_name: orgName },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/callback`,
    });

  if (inviteError) throw new Error(`Invite failed: ${inviteError.message}`);

  // 3. Create org membership
  await supabase.from("org_members").insert({
    org_id: orgId,
    user_id: inviteData.user.id,
    role: "owner",
  });
}
```

### Empty State Setup Wizard Component
```typescript
// apps/admin/src/app/(dashboard)/dashboard/setup-wizard.tsx
"use client";

interface SetupWizardProps {
  hasServices: boolean;
  hasPackages: boolean;
  hasIntegrations: boolean;
}

const steps = [
  {
    key: "services",
    title: "Add Your Services",
    description: "Define what services you offer to clients (website, GMB, A2P, etc.)",
    href: "/services",
    checkKey: "hasServices" as const,
  },
  {
    key: "packages",
    title: "Configure a Package",
    description: "Bundle services into packages that clients can purchase",
    href: "/packages",
    checkKey: "hasPackages" as const,
  },
  {
    key: "integrations",
    title: "Set Up Integrations",
    description: "Connect GHL, Twilio, and other services to power automation",
    href: "/settings",
    checkKey: "hasIntegrations" as const,
  },
];

export function SetupWizard(props: SetupWizardProps) {
  const completedCount = steps.filter((s) => props[s.checkKey]).length;

  return (
    <div className="rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/50 p-8">
      <h2 className="text-xl font-bold text-gray-900">Welcome to LeadrWizard</h2>
      <p className="mt-2 text-gray-600">
        Complete these steps to start onboarding clients automatically.
      </p>
      <div className="mt-2 text-sm text-gray-500">
        {completedCount} of {steps.length} steps completed
      </div>
      <div className="mt-6 space-y-4">
        {steps.map((step, i) => {
          const done = props[step.checkKey];
          return (
            <a key={step.key} href={step.href}
               className={`flex items-start gap-4 rounded-lg border p-4 transition-colors ${
                 done ? "border-green-200 bg-green-50" : "border-gray-200 bg-white hover:border-brand-300"
               }`}>
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                done ? "bg-green-500 text-white" : "bg-gray-200 text-gray-600"
              }`}>
                {done ? "\u2713" : i + 1}
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{step.title}</h3>
                <p className="mt-0.5 text-sm text-gray-500">{step.description}</p>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
```

### Stripe CLI Local Dev Setup
```bash
# Install Stripe CLI (macOS)
brew install stripe/stripe-cli/stripe

# Login to Stripe
stripe login

# Forward webhooks to local dev server
stripe listen \
  --forward-to localhost:3000/api/webhooks/stripe \
  --events checkout.session.completed,customer.subscription.updated,customer.subscription.deleted,invoice.payment_failed

# The CLI outputs a webhook signing secret (whsec_...)
# Set it in apps/admin/.env.local:
# STRIPE_WEBHOOK_SECRET=whsec_... (from CLI output)

# In another terminal, trigger a test event:
stripe trigger checkout.session.completed
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Stripe v16 webhooks (invoice.subscription) | Stripe v20 (current_period on SubscriptionItem) | Stripe API 2024+ | Already handled in stripe-adapter.ts |
| supabase.auth.admin.createUser + custom email | supabase.auth.admin.inviteUserByEmail | Supabase v2 | Single call handles both user creation and invite email |
| Manual org setup by developer | Self-service via Stripe Checkout webhook | This phase | Removes deployment blocker for scaling |

**Deprecated/outdated:**
- `supabase.auth.api.inviteUserByEmail()` (v1 API): Use `supabase.auth.admin.inviteUserByEmail()` in v2

## Open Questions

1. **Stripe Price IDs not yet configured**
   - What we know: `subscription_plans` table has `stripe_price_id` column, but it's nullable and seeds don't include Stripe IDs
   - What's unclear: Whether Stripe Products/Prices have been created in the Stripe Dashboard
   - Recommendation: The plan should include a task to create Stripe Products/Prices and update the seed data with real price IDs (or at minimum document the manual step)

2. **Supabase Email Template Customization**
   - What we know: Supabase sends invite emails with a default template. Templates support `{{ .ConfirmationURL }}`, `{{ .SiteURL }}`, `{{ .Email }}`, `{{ .Data }}` variables.
   - What's unclear: Whether the default invite email template is acceptable or needs customization
   - Recommendation: Start with the default template. Customization is done in Supabase Dashboard > Auth > Email Templates. This can be a follow-up task.

3. **What happens when user clicks invite link after password already set?**
   - What we know: Supabase invite links have 24-hour expiry. If user already accepted and set password, clicking again should be a no-op.
   - What's unclear: Whether the callback route handles this gracefully
   - Recommendation: The existing callback route uses `exchangeCodeForSession`, which should handle expired/used tokens. Test this scenario.

4. **Signup success page**
   - What we know: After Stripe Checkout, user is redirected to `success_url`
   - What's unclear: What should the success page show? The user can't log in yet (no password set)
   - Recommendation: Show a simple "Check your email" page at `/signup/success`. No auth required.

## Database Changes Required

### Migration: 00006_provision_org.sql

New tables: None (all tables exist)

New columns: None needed (organizations already has stripe_customer_id, plan_slug, onboarding_completed)

New function: `provision_org` (plpgsql, security definer)
- Creates organization record
- Creates org_subscription record
- Idempotent on stripe_customer_id
- Returns org_id

### No Schema Changes Required
The existing schema is sufficient:
- `organizations`: has `stripe_customer_id`, `plan_slug`, `onboarding_completed`
- `org_members`: has `org_id`, `user_id`, `role`
- `org_subscriptions`: has all needed fields
- `subscription_plans`: seeded with plans (needs stripe_price_id population)
- `processed_webhook_events`: handles idempotency

## API Routes Needed

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/signup/checkout` | POST | Public (no auth) | Creates Stripe Checkout session for new agency signup |
| `/signup/success` | GET | Public (no auth) | Post-checkout "check your email" page |

Existing routes to modify:
- None need route changes, but `processStripeWebhook` in shared package needs the new-signup branch

## UI Components Needed

| Component | Location | Type | Purpose |
|-----------|----------|------|---------|
| SetupWizard | `apps/admin/src/app/(dashboard)/dashboard/setup-wizard.tsx` | Client component | Guided setup for new orgs |
| Signup success page | `apps/admin/src/app/(auth)/signup/success/page.tsx` | Server component | "Check your email" message |

Existing components to modify:
- `apps/admin/src/app/(dashboard)/dashboard/page.tsx`: Add empty-state detection and SetupWizard rendering

## Dependencies Between Requirements

```
SIGN-04 (Stripe CLI setup)     -- independent, do first for dev testing
    |
    v
SIGN-01 (checkout -> provision) -- core webhook + provisioning logic
    |
    v
SIGN-02 (welcome email)        -- depends on SIGN-01 (user created after org)
    |
    v
SIGN-03 (empty state wizard)   -- depends on SIGN-02 (admin must be able to log in)
```

**Recommended plan ordering:**
1. **Plan 1:** Database migration (provision_org function) + Stripe CLI setup (SIGN-04)
2. **Plan 2:** Public checkout endpoint + webhook handler new-signup branch (SIGN-01)
3. **Plan 3:** Supabase auth invite flow + welcome email (SIGN-02)
4. **Plan 4:** Empty-state setup wizard + signup success page (SIGN-03)

## Middleware Considerations

The current middleware (`apps/admin/src/middleware.ts`) excludes:
- `/login`
- `/callback`
- `/api/webhooks/*`
- `/api/cron/*`

Additional exclusions needed:
- `/api/signup/*` (public checkout endpoint)
- `/signup/*` (success page)

## Sources

### Primary (HIGH confidence)
- Supabase JS docs: `auth.admin.inviteUserByEmail()` - parameters, behavior, email template variables
- Supabase JS docs: `auth.admin.createUser()` - difference from inviteUserByEmail
- Stripe API docs: Checkout Session object - available fields (customer_details, metadata, subscription, customer)
- Stripe API docs: Create Checkout Session - mode, metadata, customer_email parameters
- Codebase analysis: stripe-adapter.ts, org-manager.ts, webhook handlers, middleware, migration files

### Secondary (MEDIUM confidence)
- Stripe CLI docs: `stripe listen --forward-to`, `stripe trigger` commands
- Supabase email templates docs: template variables (ConfirmationURL, SiteURL, Data, RedirectTo)
- Supabase redirect URLs docs: allowed redirect URL configuration

### Tertiary (LOW confidence)
- None. All findings verified against official docs and codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed, versions verified in package.json
- Architecture: HIGH - Pattern proven by existing provision_client + webhook flow, just needs extension
- Pitfalls: HIGH - Based on real codebase analysis (middleware exclusions, service role vs anon key, idempotency)
- Database: HIGH - Schema analyzed directly, no changes needed beyond new plpgsql function

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable domain, Stripe/Supabase APIs unlikely to change)
