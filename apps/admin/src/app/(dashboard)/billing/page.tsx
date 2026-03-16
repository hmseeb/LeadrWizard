import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";

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
  const authClient = await createSupabaseServerClient();

  const {
    data: { user },
  } = await authClient.auth.getUser();

  const supabase = createSupabaseServiceClient();

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
      <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">Billing</h1>
      <p className="mt-1 text-zinc-400">Manage your subscription and billing</p>

      {/* Current Plan */}
      <div className="mt-6 rounded-xl border border-zinc-800 bg-surface p-6">
        <h2 className="text-lg font-semibold text-zinc-50">Current Plan</h2>
        {typedSub ? (
          <div className="mt-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-brand-400">
                {typedSub.plan?.name || "Unknown Plan"}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  typedSub.status === "active"
                    ? "border border-emerald-500/20 bg-emerald-600/10 text-emerald-400"
                    : typedSub.status === "trialing"
                      ? "border border-blue-500/20 bg-blue-600/10 text-blue-400"
                      : "border border-rose-500/20 bg-rose-600/10 text-rose-400"
                }`}
              >
                {typedSub.status}
              </span>
              {typedSub.cancel_at_period_end && (
                <span className="rounded-full border border-amber-500/20 bg-amber-600/10 px-2.5 py-0.5 text-xs font-medium text-amber-400">
                  Cancels at period end
                </span>
              )}
            </div>
            <p className="mt-2 text-zinc-400">
              ${((typedSub.plan?.price_cents || 0) / 100).toFixed(2)}/
              {typedSub.plan?.billing_interval || "month"}
            </p>
            {typedSub.current_period_end && (
              <p className="mt-1 text-sm text-zinc-500">
                Current period ends:{" "}
                {new Date(typedSub.current_period_end).toLocaleDateString()}
              </p>
            )}

            <form action="/api/billing/portal" method="POST" className="mt-4">
              <button
                type="submit"
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-700 transition-all"
              >
                Manage Subscription
              </button>
            </form>
          </div>
        ) : (
          <p className="mt-4 text-zinc-400">
            No active subscription. Choose a plan below to get started.
          </p>
        )}
      </div>

      {/* Usage */}
      <div className="mt-6 rounded-xl border border-zinc-800 bg-surface p-6">
        <h2 className="text-lg font-semibold text-zinc-50">Usage</h2>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-sm text-zinc-400">Clients</p>
            <p className="text-xl font-bold text-zinc-50">
              {clientCount ?? 0}
              {typedSub?.plan?.max_clients && (
                <span className="text-sm font-normal text-zinc-500">
                  {" "}
                  / {typedSub.plan.max_clients}
                </span>
              )}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-sm text-zinc-400">Active Services</p>
            <p className="text-xl font-bold text-zinc-50">
              {serviceCount ?? 0}
              {typedSub?.plan?.max_services && (
                <span className="text-sm font-normal text-zinc-500">
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
        <h2 className="text-lg font-semibold text-zinc-50">Available Plans</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {typedPlans.map((plan) => {
            const isCurrent = typedSub?.plan?.slug === plan.slug;
            return (
              <div
                key={plan.id}
                className={`rounded-xl border p-6 ${
                  isCurrent
                    ? "border-brand-500/40 bg-brand-600/5"
                    : "border-zinc-800 bg-surface"
                }`}
              >
                <h3 className="text-lg font-bold text-zinc-50">{plan.name}</h3>
                <p className="mt-1 text-sm text-zinc-400">
                  {plan.description}
                </p>
                <p className="mt-4 text-3xl font-bold text-zinc-50">
                  ${(plan.price_cents / 100).toFixed(0)}
                  <span className="text-sm font-normal text-zinc-500">
                    /{plan.billing_interval === "yearly" ? "yr" : "mo"}
                  </span>
                </p>

                <ul className="mt-4 space-y-2">
                  <li className="text-sm text-zinc-300">
                    {plan.max_clients
                      ? `Up to ${plan.max_clients} clients`
                      : "Unlimited clients"}
                  </li>
                  <li className="text-sm text-zinc-300">
                    {plan.max_services
                      ? `Up to ${plan.max_services} services`
                      : "Unlimited services"}
                  </li>
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="text-sm text-zinc-300"
                    >
                      {formatFeature(feature)}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <div className="mt-6 rounded-lg border border-brand-500/20 bg-brand-600/10 px-4 py-2 text-center text-sm font-medium text-brand-400">
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
        className="mt-6 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 transition-all shadow-sm"
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
