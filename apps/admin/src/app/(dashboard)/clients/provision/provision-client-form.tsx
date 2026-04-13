"use client";

import { useActionState } from "react";
import Link from "next/link";

interface PackageOption {
  id: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  price_interval: string | null;
}

interface ProvisionClientFormProps {
  packages: PackageOption[];
  action: (formData: FormData) => Promise<void>;
}

const inputClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors";
const labelClass = "block text-sm font-medium text-zinc-300 mb-1.5";

function formatPrice(cents: number | null, interval: string | null): string {
  if (cents === null) return "";
  const dollars = (cents / 100).toFixed(0);
  if (interval === "monthly") return `$${dollars}/mo`;
  if (interval === "yearly") return `$${dollars}/yr`;
  return `$${dollars}`;
}

export function ProvisionClientForm({
  packages,
  action,
}: ProvisionClientFormProps) {
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
    <form action={formAction} className="space-y-6">
      {error && (
        <div className="rounded-lg border border-rose-500/20 bg-rose-600/10 p-4 text-sm text-rose-400">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 bg-surface p-6">
        <h2 className="text-lg font-semibold text-zinc-50">Client Details</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Basic contact information. The client will receive their onboarding
          link at the phone number you enter (falls back to email if empty).
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="customer_name" className={labelClass}>
              Contact Name
            </label>
            <input
              id="customer_name"
              name="customer_name"
              type="text"
              required
              minLength={2}
              placeholder="John Smith"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="customer_email" className={labelClass}>
              Contact Email
            </label>
            <input
              id="customer_email"
              name="customer_email"
              type="email"
              required
              placeholder="john@business.com"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="customer_phone" className={labelClass}>
              Contact Phone
            </label>
            <input
              id="customer_phone"
              name="customer_phone"
              type="tel"
              placeholder="+1 (555) 123-4567"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="business_name" className={labelClass}>
              Business Name
            </label>
            <input
              id="business_name"
              name="business_name"
              type="text"
              placeholder="Smith Plumbing LLC"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-surface p-6">
        <h2 className="text-lg font-semibold text-zinc-50">Package</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Services from the selected package will be provisioned for this
          client.
        </p>
        <div className="mt-4 space-y-2">
          {packages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-700 p-4 text-center text-sm text-zinc-500">
              No packages defined yet.{" "}
              <Link
                href="/packages/new"
                className="text-brand-400 hover:text-brand-300"
              >
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
                <div className="flex-1">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm font-medium text-zinc-100">
                      {pkg.name}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {formatPrice(pkg.price_cents, pkg.price_interval)}
                    </span>
                  </div>
                  {pkg.description && (
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {pkg.description}
                    </p>
                  )}
                </div>
              </label>
            ))
          )}
        </div>
      </div>

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
          {isPending ? "Provisioning..." : "Provision client"}
        </button>
      </div>
    </form>
  );
}
