"use client";

import { CheckCircle2, Cog, Package, Puzzle } from "lucide-react";
import Link from "next/link";

interface SetupWizardProps {
  hasServices: boolean;
  hasPackages: boolean;
  hasIntegrations: boolean;
  orgName: string;
}

const steps = [
  {
    key: "services" as const,
    title: "Add Your Services",
    description:
      "Define the services you offer to clients (website, GMB, A2P registration, etc.)",
    href: "/services",
    icon: Puzzle,
    checkKey: "hasServices" as const,
  },
  {
    key: "packages" as const,
    title: "Configure a Package",
    description:
      "Bundle your services into packages that clients purchase for onboarding",
    href: "/packages",
    icon: Package,
    checkKey: "hasPackages" as const,
  },
  {
    key: "integrations" as const,
    title: "Set Up Integrations",
    description:
      "Connect GoHighLevel, Twilio, and other services to power automation",
    href: "/settings",
    icon: Cog,
    checkKey: "hasIntegrations" as const,
  },
];

export function SetupWizard({
  hasServices,
  hasPackages,
  hasIntegrations,
  orgName,
}: SetupWizardProps) {
  const stateMap = { hasServices, hasPackages, hasIntegrations };
  const completedCount = steps.filter((s) => stateMap[s.checkKey]).length;

  return (
    <div className="rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/50 p-8">
      <h2 className="text-xl font-bold text-gray-900">
        Welcome to LeadrWizard, {orgName}!
      </h2>
      <p className="mt-2 text-gray-600">
        Complete these steps to start onboarding clients automatically.
      </p>
      <div className="mt-1 text-sm text-gray-500">
        {completedCount} of {steps.length} steps completed
      </div>

      <div className="mt-6 space-y-4">
        {steps.map((step, i) => {
          const done = stateMap[step.checkKey];
          const Icon = step.icon;

          return (
            <Link
              key={step.key}
              href={step.href}
              className={`flex items-start gap-4 rounded-lg border p-4 transition-colors ${
                done
                  ? "border-green-200 bg-green-50"
                  : "border-gray-200 bg-white hover:border-brand-300 hover:bg-brand-50/30"
              }`}
            >
              <div
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                  done
                    ? "bg-green-500 text-white"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {done ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <span className="text-sm font-bold">{i + 1}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-gray-400" />
                  <h3 className="font-semibold text-gray-900">{step.title}</h3>
                </div>
                <p className="mt-0.5 text-sm text-gray-500">
                  {step.description}
                </p>
              </div>
              {!done && (
                <span className="flex-shrink-0 text-sm font-medium text-brand-600">
                  Start
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
