"use client";

import { useActionState } from "react";
import Link from "next/link";

interface PackageOption {
  id: string;
  name: string;
  description: string | null;
}

interface NewClientFormProps {
  packages: PackageOption[];
  action: (formData: FormData) => Promise<void>;
}

export function NewClientForm({ packages, action }: NewClientFormProps) {
  const [error, formAction, isPending] = useActionState(
    async (_prevState: string | null, formData: FormData) => {
      try {
        await action(formData);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Something went wrong";
      }
    },
    null
  );

  return (
    <form action={formAction}>
      <div className="space-y-8">
        {error && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-600/10 p-4 text-sm text-rose-400">
            {error}
          </div>
        )}

        {/* Client Info */}
        <div className="rounded-xl border border-zinc-800 bg-surface p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Client Information</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Basic details about the client. They&apos;ll receive an SMS to start onboarding.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="customer_name" className="block text-sm font-medium text-zinc-300 mb-1.5">
                Full Name
              </label>
              <input
                id="customer_name"
                name="customer_name"
                type="text"
                required
                minLength={2}
                placeholder="John Smith"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
              />
            </div>
            <div>
              <label htmlFor="customer_email" className="block text-sm font-medium text-zinc-300 mb-1.5">
                Email
              </label>
              <input
                id="customer_email"
                name="customer_email"
                type="email"
                required
                placeholder="john@business.com"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
              />
            </div>
            <div>
              <label htmlFor="customer_phone" className="block text-sm font-medium text-zinc-300 mb-1.5">
                Phone Number
              </label>
              <input
                id="customer_phone"
                name="customer_phone"
                type="tel"
                placeholder="+1 (555) 123-4567"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
              />
              <p className="mt-1 text-xs text-zinc-500">Required for SMS outreach</p>
            </div>
            <div>
              <label htmlFor="business_name" className="block text-sm font-medium text-zinc-300 mb-1.5">
                Business Name
              </label>
              <input
                id="business_name"
                name="business_name"
                type="text"
                placeholder="Smith Plumbing LLC"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Package Selection */}
        <div className="rounded-xl border border-zinc-800 bg-surface p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Select Package</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Choose which services to onboard this client for.
          </p>
          <div className="mt-4 space-y-2">
            {packages.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-700 p-4 text-center text-sm text-zinc-500">
                No packages defined yet.{" "}
                <Link href="/packages/new" className="text-brand-400 hover:text-brand-300">
                  Create a package
                </Link>{" "}
                first.
              </div>
            ) : (
              packages.map((pkg) => (
                <label
                  key={pkg.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-700 p-4 transition-colors hover:border-zinc-600 has-[:checked]:border-brand-500/40 has-[:checked]:bg-brand-600/10"
                >
                  <input
                    type="radio"
                    name="package_id"
                    value={pkg.id}
                    required
                    className="border-zinc-600 bg-zinc-800 text-brand-500 focus:ring-brand-500/30"
                  />
                  <div>
                    <span className="text-sm font-medium text-zinc-100">{pkg.name}</span>
                    {pkg.description && (
                      <p className="mt-0.5 text-xs text-zinc-400">{pkg.description}</p>
                    )}
                  </div>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Link
            href="/clients"
            className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending || packages.length === 0}
            className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50 transition-all shadow-sm"
          >
            {isPending ? "Starting Onboarding..." : "Start Onboarding"}
          </button>
        </div>
      </div>
    </form>
  );
}
