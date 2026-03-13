import type { SupabaseClient } from "../supabase/client";
import type { SubscriptionPlan, OrgSubscription } from "../types";

/**
 * Stripe billing adapter.
 * Handles subscription management, checkout sessions, and webhook processing.
 *
 * Stripe API: https://stripe.com/docs/api
 */

export type { SubscriptionPlan, OrgSubscription };

interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  publishableKey: string;
}

function getStripeConfig(): StripeConfig {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  return {
    secretKey,
    webhookSecret: webhookSecret || "",
    publishableKey: publishableKey || "",
  };
}

async function stripeRequest(
  path: string,
  options: {
    method?: string;
    body?: Record<string, string>;
  } = {}
): Promise<Record<string, unknown>> {
  const config = getStripeConfig();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.secretKey}`,
  };

  let requestBody: string | undefined;
  if (options.body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    requestBody = new URLSearchParams(options.body).toString();
  }

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: options.method || "GET",
    headers,
    ...(requestBody ? { body: requestBody } : {}),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Stripe API error (${response.status}): ${errorBody}`);
  }

  return (await response.json()) as Record<string, unknown>;
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
  const customer = await stripeRequest("/customers", {
    method: "POST",
    body: {
      email,
      name,
      "metadata[org_id]": orgId,
    },
  });

  const customerId = customer.id as string;

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

  const sessionParams: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": (plan as SubscriptionPlan).stripe_price_id!,
    "line_items[0][quantity]": "1",
    success_url: successUrl,
    cancel_url: cancelUrl,
    "metadata[org_id]": orgId,
    "metadata[plan_slug]": planSlug,
  };

  if (customerId) {
    sessionParams.customer = customerId;
  }

  const session = await stripeRequest("/checkout/sessions", {
    method: "POST",
    body: sessionParams,
  });

  return {
    checkoutUrl: session.url as string,
    sessionId: session.id as string,
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

  const session = await stripeRequest("/billing_portal/sessions", {
    method: "POST",
    body: {
      customer: customerId,
      return_url: returnUrl,
    },
  });

  return session.url as string;
}

/**
 * Process a Stripe webhook event.
 */
export async function processStripeWebhook(
  supabase: SupabaseClient,
  event: {
    type: string;
    data: { object: Record<string, unknown> };
  }
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const orgId = (session.metadata as Record<string, string>)?.org_id;
      const planSlug = (session.metadata as Record<string, string>)?.plan_slug;
      const subscriptionId = session.subscription as string;
      const customerId = session.customer as string;

      if (orgId && planSlug) {
        // Get plan
        const { data: plan } = await supabase
          .from("subscription_plans")
          .select("id")
          .eq("slug", planSlug)
          .single();

        if (plan) {
          // Create subscription record
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

          // Update org
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
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object;
      const subscriptionId = subscription.id as string;
      const status = subscription.status as string;

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
          cancel_at_period_end:
            (subscription.cancel_at_period_end as boolean) || false,
          current_period_start: subscription.current_period_start
            ? new Date(
                (subscription.current_period_start as number) * 1000
              ).toISOString()
            : null,
          current_period_end: subscription.current_period_end
            ? new Date(
                (subscription.current_period_end as number) * 1000
              ).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", subscriptionId);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const subscriptionId = subscription.id as string;

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
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription as string;

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

  const typedPlan = plan as { max_clients: number | null; max_services: number | null } | null;

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
