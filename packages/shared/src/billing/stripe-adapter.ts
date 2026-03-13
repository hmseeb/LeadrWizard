import Stripe from "stripe";
import type { SupabaseClient } from "../supabase/client";
import type { SubscriptionPlan, OrgSubscription } from "../types";

/**
 * Stripe billing adapter.
 * Handles subscription management, checkout sessions, and webhook processing.
 *
 * Stripe API: https://stripe.com/docs/api
 */

export type { SubscriptionPlan, OrgSubscription };

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  return new Stripe(secretKey, { apiVersion: "2026-02-25.clover" });
}

/**
 * Verifies a Stripe webhook signature and returns the parsed event.
 * Throws the original Stripe error on failure — callers should catch and return 400.
 */
export function constructEvent(
  rawBody: string,
  signature: string,
  secret: string
): Stripe.Event {
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  }
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/**
 * Creates a Stripe customer for an organization.
 */
export async function createStripeCustomer(
  supabase: SupabaseClient,
  orgId: string,
  email: string,
  name: string
): Promise<string> {
  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { org_id: orgId },
  });

  const customerId = customer.id;

  // Store customer ID on org
  await supabase
    .from("organizations")
    .update({ stripe_customer_id: customerId })
    .eq("id", orgId);

  return customerId;
}

/**
 * Creates a Stripe Checkout session for a subscription.
 */
export async function createCheckoutSession(
  supabase: SupabaseClient,
  orgId: string,
  planSlug: string,
  successUrl: string,
  cancelUrl: string
): Promise<{ checkoutUrl: string; sessionId: string }> {
  // Get the plan
  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("slug", planSlug)
    .eq("is_active", true)
    .single();

  if (!plan || !(plan as SubscriptionPlan).stripe_price_id) {
    throw new Error(`Plan "${planSlug}" not found or not configured`);
  }

  // Get or create Stripe customer
  const { data: org } = await supabase
    .from("organizations")
    .select("stripe_customer_id, name")
    .eq("id", orgId)
    .single();

  let customerId = (org as Record<string, string | null>)?.stripe_customer_id;

  if (!customerId) {
    // Get the org owner's email
    const { data: owner } = await supabase
      .from("org_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("role", "owner")
      .single();

    if (owner) {
      const { data: userData } = await supabase.auth.admin.getUserById(
        owner.user_id
      );
      const email = userData?.user?.email || "";
      customerId = await createStripeCustomer(
        supabase,
        orgId,
        email,
        (org as Record<string, string>)?.name || ""
      );
    }
  }

  const stripe = getStripeClient();

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [
      {
        price: (plan as SubscriptionPlan).stripe_price_id!,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      org_id: orgId,
      plan_slug: planSlug,
    },
  };

  if (customerId) {
    sessionParams.customer = customerId;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  return {
    checkoutUrl: session.url as string,
    sessionId: session.id,
  };
}

/**
 * Creates a Stripe Checkout session for a NEW agency signup.
 * Unlike createCheckoutSession, this does NOT require an existing org or auth.
 * The metadata.signup flag tells the webhook handler to provision a new org.
 */
export async function createSignupCheckoutSession(
  supabase: SupabaseClient,
  planSlug: string,
  email: string,
  orgName: string,
  successUrl: string,
  cancelUrl: string
): Promise<{ checkoutUrl: string; sessionId: string }> {
  // Validate plan exists and has a Stripe price ID
  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("slug", planSlug)
    .eq("is_active", true)
    .single();

  if (!plan || !(plan as SubscriptionPlan).stripe_price_id) {
    throw new Error(`Plan "${planSlug}" not found or not configured with Stripe price`);
  }

  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: email,
    line_items: [
      {
        price: (plan as SubscriptionPlan).stripe_price_id!,
        quantity: 1,
      },
    ],
    metadata: {
      signup: "true",
      org_name: orgName,
      admin_email: email,
      plan_slug: planSlug,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return {
    checkoutUrl: session.url as string,
    sessionId: session.id,
  };
}

/**
 * Creates a Stripe Billing Portal session for managing subscriptions.
 */
export async function createBillingPortalSession(
  supabase: SupabaseClient,
  orgId: string,
  returnUrl: string
): Promise<string> {
  const { data: org } = await supabase
    .from("organizations")
    .select("stripe_customer_id")
    .eq("id", orgId)
    .single();

  const customerId = (org as Record<string, string | null>)?.stripe_customer_id;
  if (!customerId) {
    throw new Error("Organization has no Stripe customer");
  }

  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}

/**
 * Handles a brand-new agency signup from Stripe Checkout.
 * 1. Atomically creates org + subscription via provision_org RPC
 * 2. Invites admin user via Supabase auth (sends welcome email)
 * 3. Creates org membership linking the user to the org
 *
 * Order matters: org must exist before user invite, user must exist before membership.
 * The invite email takes a few seconds to deliver, providing natural buffering
 * so the membership record exists before the user clicks the link.
 *
 * Testable locally via Stripe CLI (SIGN-04):
 *   stripe listen --forward-to localhost:3000/api/webhooks/stripe
 *   stripe trigger checkout.session.completed
 */
async function handleNewOrgSignup(
  supabase: SupabaseClient,
  session: Stripe.Checkout.Session
): Promise<void> {
  const orgName = session.metadata?.org_name || "My Agency";
  const adminEmail =
    session.metadata?.admin_email ||
    session.customer_details?.email ||
    "";
  const planSlug = session.metadata?.plan_slug || "starter";
  const subscriptionId = session.subscription as string;
  const customerId = session.customer as string;

  if (!adminEmail) {
    throw new Error("No admin email found in checkout session metadata or customer_details");
  }

  // Step 1: Atomically create org + subscription
  const { data: provisionResult, error: provisionError } = await supabase.rpc(
    "provision_org",
    {
      p_org_name: orgName,
      p_admin_email: adminEmail,
      p_plan_slug: planSlug,
      p_stripe_sub_id: subscriptionId,
      p_stripe_cust_id: customerId,
    }
  );

  if (provisionError) {
    throw new Error(`Org provisioning failed: ${provisionError.message}`);
  }

  const result = provisionResult as { org_id: string; idempotent: boolean };

  // If idempotent (duplicate webhook), skip user creation
  if (result.idempotent) {
    return;
  }

  const orgId = result.org_id;

  // Step 2: Create auth user and send invite email via Supabase
  // This uses the service role client (createServerClient), which has admin access.
  // inviteUserByEmail creates the auth user AND sends the invite email in one call.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const { data: inviteData, error: inviteError } =
    await supabase.auth.admin.inviteUserByEmail(adminEmail, {
      data: {
        org_id: orgId,
        role: "owner",
        org_name: orgName,
      },
      redirectTo: `${appUrl}/callback`,
    });

  if (inviteError) {
    throw new Error(`User invite failed: ${inviteError.message}`);
  }

  // Step 3: Create org membership linking the invited user to the org
  const { error: memberError } = await supabase.from("org_members").insert({
    org_id: orgId,
    user_id: inviteData.user.id,
    role: "owner",
  });

  if (memberError) {
    throw new Error(`Membership creation failed: ${memberError.message}`);
  }
}

/**
 * Process a Stripe webhook event.
 */
export async function processStripeWebhook(
  supabase: SupabaseClient,
  event: Stripe.Event
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const isNewSignup = session.metadata?.signup === "true";

      if (isNewSignup) {
        // NEW SIGNUP: agency completing checkout for the first time
        await handleNewOrgSignup(supabase, session);
      } else {
        // EXISTING ORG: upgrading or purchasing a plan
        const orgId = session.metadata?.org_id;
        const planSlug = session.metadata?.plan_slug;
        const subscriptionId = session.subscription as string;
        const customerId = session.customer as string;

        if (orgId && planSlug) {
          const { data: plan } = await supabase
            .from("subscription_plans")
            .select("id")
            .eq("slug", planSlug)
            .single();

          if (plan) {
            await supabase.from("org_subscriptions").insert({
              org_id: orgId,
              plan_id: plan.id,
              stripe_subscription_id: subscriptionId,
              stripe_customer_id: customerId,
              status: "active",
              current_period_start: new Date().toISOString(),
              current_period_end: new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000
              ).toISOString(),
            });

            await supabase
              .from("organizations")
              .update({
                stripe_customer_id: customerId,
                plan_slug: planSlug,
                updated_at: new Date().toISOString(),
              })
              .eq("id", orgId);
          }
        }
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const subscriptionId = subscription.id;
      const status = subscription.status;

      // current_period_start/end moved to SubscriptionItem in Stripe v20
      const firstItem = subscription.items?.data?.[0];
      const periodStart = firstItem?.current_period_start ?? null;
      const periodEnd = firstItem?.current_period_end ?? null;

      const statusMap: Record<string, string> = {
        active: "active",
        past_due: "past_due",
        canceled: "cancelled",
        trialing: "trialing",
        unpaid: "past_due",
      };

      await supabase
        .from("org_subscriptions")
        .update({
          status: statusMap[status] || "active",
          cancel_at_period_end: subscription.cancel_at_period_end || false,
          current_period_start: periodStart
            ? new Date(periodStart * 1000).toISOString()
            : null,
          current_period_end: periodEnd
            ? new Date(periodEnd * 1000).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", subscriptionId);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const subscriptionId = subscription.id;

      await supabase
        .from("org_subscriptions")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", subscriptionId);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      // In Stripe v20, subscription is accessed via invoice.parent?.subscription_details
      const parent = invoice.parent as
        | { subscription_details?: { subscription?: string | Stripe.Subscription } }
        | null
        | undefined;
      const rawSub = parent?.subscription_details?.subscription;
      const subscriptionId =
        typeof rawSub === "string" ? rawSub : rawSub?.id ?? null;

      if (subscriptionId) {
        await supabase
          .from("org_subscriptions")
          .update({
            status: "past_due",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscriptionId);
      }
      break;
    }
  }
}

/**
 * Check if an org is within their plan limits.
 */
export async function checkPlanLimits(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  within_limits: boolean;
  current_clients: number;
  max_clients: number | null;
  current_services: number;
  max_services: number | null;
}> {
  // Get active subscription
  const { data: sub } = await supabase
    .from("org_subscriptions")
    .select("plan_id")
    .eq("org_id", orgId)
    .in("status", ["active", "trialing"])
    .single();

  if (!sub) {
    return {
      within_limits: false,
      current_clients: 0,
      max_clients: 0,
      current_services: 0,
      max_services: 0,
    };
  }

  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("max_clients, max_services")
    .eq("id", sub.plan_id)
    .single();

  const typedPlan = plan as {
    max_clients: number | null;
    max_services: number | null;
  } | null;

  const { count: clientCount } = await supabase
    .from("clients")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId);

  const { count: serviceCount } = await supabase
    .from("service_definitions")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("is_active", true);

  const maxClients = typedPlan?.max_clients ?? null;
  const maxServices = typedPlan?.max_services ?? null;

  return {
    within_limits:
      (maxClients === null || (clientCount ?? 0) < maxClients) &&
      (maxServices === null || (serviceCount ?? 0) < maxServices),
    current_clients: clientCount ?? 0,
    max_clients: maxClients,
    current_services: serviceCount ?? 0,
    max_services: maxServices,
  };
}
