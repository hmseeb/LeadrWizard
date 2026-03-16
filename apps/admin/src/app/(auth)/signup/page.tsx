"use client";

import { useState, Suspense } from "react";
import { Zap, Check, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";

interface Plan {
  slug: string;
  name: string;
  price: number;
  description: string;
  features: string[];
  highlight?: boolean;
}

const PLANS: Plan[] = [
  {
    slug: "starter",
    name: "Starter",
    price: 99,
    description: "For small agencies getting started with AI onboarding.",
    features: [
      "Up to 50 clients/month",
      "1 onboarding wizard",
      "Email support",
      "Basic analytics",
      "Custom branding",
    ],
  },
  {
    slug: "growth",
    name: "Growth",
    price: 249,
    description: "For growing agencies that need more power and flexibility.",
    features: [
      "Up to 250 clients/month",
      "5 onboarding wizards",
      "Priority support",
      "Advanced analytics",
      "Custom branding",
      "API access",
      "Webhook integrations",
    ],
    highlight: true,
  },
  {
    slug: "scale",
    name: "Scale",
    price: 499,
    description: "For large agencies running high-volume onboarding at scale.",
    features: [
      "Unlimited clients",
      "Unlimited wizards",
      "Dedicated support",
      "Full analytics suite",
      "Custom branding",
      "API access",
      "Webhook integrations",
      "White-label option",
      "SSO / SAML",
    ],
  },
];

function SignupContent() {
  const searchParams = useSearchParams();
  const cancelled = searchParams.get("cancelled");

  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selectedPlan) {
      setError("Select a plan to continue.");
      return;
    }

    if (!orgName.trim()) {
      setError("Enter your agency name.");
      return;
    }

    if (!email || !email.includes("@") || !email.includes(".")) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/signup/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planSlug: selectedPlan,
          email: email.trim(),
          orgName: orgName.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Try again.");
        setLoading(false);
        return;
      }

      window.location.href = data.checkoutUrl;
    } catch {
      setError("Network error. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <>
      {/* Cancelled banner */}
      {cancelled && (
        <div className="mt-8 w-full max-w-3xl">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3.5 text-sm text-amber-400">
            Checkout was cancelled. Select a plan and try again when you&apos;re ready.
          </div>
        </div>
      )}

      {/* Plan cards */}
      <div className="mt-10 grid w-full max-w-4xl gap-5 sm:grid-cols-3">
        {PLANS.map((plan) => {
          const isSelected = selectedPlan === plan.slug;
          return (
            <button
              key={plan.slug}
              type="button"
              onClick={() => setSelectedPlan(plan.slug)}
              className={`
                relative flex flex-col rounded-xl border p-6 text-left transition-all duration-200
                ${
                  isSelected
                    ? "border-brand-500 bg-brand-500/5 shadow-glow"
                    : "border-zinc-800 bg-surface hover:border-zinc-700"
                }
              `}
            >
              {plan.highlight && (
                <span className="absolute -top-2.5 right-4 rounded-full bg-brand-600 px-3 py-0.5 text-xs font-semibold text-white">
                  Popular
                </span>
              )}

              <h3 className="font-display text-lg font-semibold text-zinc-50">
                {plan.name}
              </h3>

              <div className="mt-2 flex items-baseline gap-1">
                <span className="font-display text-3xl font-bold text-zinc-50">
                  ${plan.price}
                </span>
                <span className="text-sm text-zinc-500">/mo</span>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                {plan.description}
              </p>

              <ul className="mt-5 flex flex-1 flex-col gap-2.5">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-sm text-zinc-300"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                    {feature}
                  </li>
                ))}
              </ul>

              <div
                className={`
                  mt-6 rounded-lg py-2 text-center text-sm font-semibold transition-colors duration-150
                  ${
                    isSelected
                      ? "bg-brand-600 text-white"
                      : "bg-zinc-800 text-zinc-400"
                  }
                `}
              >
                {isSelected ? "Selected" : "Select"}
              </div>
            </button>
          );
        })}
      </div>

      {/* Signup form */}
      <form onSubmit={handleSubmit} className="mt-10 w-full max-w-md">
        <div className="rounded-xl border border-zinc-800 bg-surface p-6 shadow-card">
          <h2 className="font-display text-lg font-semibold text-zinc-50">
            Your details
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            We&apos;ll send your login credentials to this email.
          </p>

          {error && (
            <div className="alert-error mt-4">
              {error}
            </div>
          )}

          <div className="mt-5">
            <label className="label">Agency name</label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="input"
              placeholder="Acme Marketing"
              required
            />
          </div>

          <div className="mt-4">
            <label className="label">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="you@agency.com"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || !selectedPlan}
            className="btn-primary mt-6 flex w-full items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Redirecting to checkout...
              </>
            ) : (
              "Continue to Checkout"
            )}
          </button>

          {!selectedPlan && (
            <p className="mt-3 text-center text-xs text-zinc-500">
              Select a plan above to continue
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Already have an account?{" "}
          <a href="/login" className="text-brand-400 hover:text-brand-300 transition-colors">
            Sign in
          </a>
        </p>
      </form>
    </>
  );
}

export default function SignupPage() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-950 bg-[radial-gradient(ellipse_at_center,_rgba(16,185,129,0.06)_0%,_transparent_70%)] px-4 py-12 sm:py-16">
      {/* Logo */}
      <div className="flex flex-col items-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600/15 shadow-glow">
          <Zap className="h-6 w-6 text-brand-400" />
        </div>
        <h1 className="mt-4 font-display text-center text-2xl font-bold tracking-tight text-zinc-50">
          LeadrWizard
        </h1>
        <p className="mt-1 text-center text-sm text-zinc-400">
          AI-powered client onboarding for agencies
        </p>
      </div>

      <Suspense>
        <SignupContent />
      </Suspense>
    </div>
  );
}
