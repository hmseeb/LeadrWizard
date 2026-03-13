import { createSupabaseServerClient } from "@/lib/supabase-server";

interface Plan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  billing_interval: string;
  max_clients: number | null;
  max_services: number | null;
  features: string[];
}

interface Subscription {
  id: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  plan: Plan;
}

export default async function BillingPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Get user's org
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user?.id || "")
    .single();

  const orgId = membership?.org_id;

  // Get current subscription
  const { data: subscription } = await supabase
    .from("org_subscriptions")
    .select(`
      *,
      plan:subscription_plans(*)
    `)
    .eq("org_id", orgId || "")
    .in("status", ["active", "trialing", "past_due"])
    .single();

  const typedSub = subscription as Subscription | null;

  // Get all plans
  const { data: plans } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("is_active", true)
    .order("price_cents", { ascending: true });

  const typedPlans = (plans || []) as Plan[];

  // Get usage stats
  const { count: clientCount } = await supabase
    .from("clients")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId || "");

  const { count: serviceCount } = await supabase
    .from("service_definitions")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId || "")
    .eq("is_active", true);

  return (
    <div>
      <h1 className="text-2xl font-bold">Billing</h1>
      <p className="mt-1 text-gray-500">Manage your subscription and billing</p>

      {/* Current Plan */}
      <div className="mt-6 rounded-lg border bg-white p-6">
        <h2 className="text-lg font-semibold">Current Plan</h2>
        {typedSub ? (
          <div className="mt-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-brand-600">
                {typedSub.plan?.name || "Unknown Plan"}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  typedSub.status === "active"
                    ? "bg-green-100 text-green-700"
                    : typedSub.status === "trialing"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-red-100 text-red-700"
                }`}
              >
                {typedSub.status}
              </span>
              {typedSub.cancel_at_period_end && (
                <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
                  Cancels at period end
                </span>
              )}
            </div>
            <p className="mt-2 text-gray-500">
              ${((typedSub.plan?.price_cents || 0) / 100).toFixed(2)}/
              {typedSub.plan?.billing_interval || "month"}
            </p>
            {typedSub.current_period_end && (
              <p className="mt-1 text-sm text-gray-400">
                Current period ends:{" "}
                {new Date(typedSub.current_period_end).toLocaleDateString()}
              </p>
            )}

            <form action="/api/billing/portal" method="POST" className="mt-4">
              <button
                type="submit"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Manage Subscription
              </button>
            </form>
          </div>
        ) : (
          <p className="mt-4 text-gray-500">
            No active subscription. Choose a plan below to get started.
          </p>
        )}
      </div>

      {/* Usage */}
      <div className="mt-6 rounded-lg border bg-white p-6">
        <h2 className="text-lg font-semibold">Usage</h2>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500">Clients</p>
            <p className="text-xl font-bold">
              {clientCount ?? 0}
              {typedSub?.plan?.max_clients && (
                <span className="text-sm font-normal text-gray-400">
                  {" "}
                  / {typedSub.plan.max_clients}
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Active Services</p>
            <p className="text-xl font-bold">
              {serviceCount ?? 0}
              {typedSub?.plan?.max_services && (
                <span className="text-sm font-normal text-gray-400">
                  {" "}
                  / {typedSub.plan.max_services}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Plans */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold">Available Plans</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {typedPlans.map((plan) => {
            const isCurrent = typedSub?.plan?.slug === plan.slug;
            return (
              <div
                key={plan.id}
                className={`rounded-lg border p-6 ${
                  isCurrent
                    ? "border-brand-500 bg-brand-50"
                    : "bg-white"
                }`}
              >
                <h3 className="text-lg font-bold">{plan.name}</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {plan.description}
                </p>
                <p className="mt-4 text-3xl font-bold">
                  ${(plan.price_cents / 100).toFixed(0)}
                  <span className="text-sm font-normal text-gray-400">
                    /{plan.billing_interval === "yearly" ? "yr" : "mo"}
                  </span>
                </p>

                <ul className="mt-4 space-y-2">
                  <li className="text-sm text-gray-600">
                    {plan.max_clients
                      ? `Up to ${plan.max_clients} clients`
                      : "Unlimited clients"}
                  </li>
                  <li className="text-sm text-gray-600">
                    {plan.max_services
                      ? `Up to ${plan.max_services} services`
                      : "Unlimited services"}
                  </li>
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="text-sm text-gray-600"
                    >
                      {formatFeature(feature)}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <div className="mt-6 rounded-lg bg-brand-100 px-4 py-2 text-center text-sm font-medium text-brand-700">
                    Current Plan
                  </div>
                ) : (
                  <PlanButton planSlug={plan.slug} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlanButton({ planSlug }: { planSlug: string }) {
  return (
    <form action="/api/billing/checkout" method="POST">
      <input type="hidden" name="planSlug" value={planSlug} />
      <button
        type="submit"
        className="mt-6 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Upgrade
      </button>
    </form>
  );
}

function formatFeature(feature: string): string {
  const labels: Record<string, string> = {
    sms: "SMS outreach",
    voice: "Voice calls",
    email: "Email outreach",
    basic_analytics: "Basic analytics",
    advanced_analytics: "Advanced analytics",
    custom_templates: "Custom templates",
    priority_support: "Priority support",
    api_access: "API access",
    white_label: "White-label branding",
  };
  return labels[feature] || feature;
}
