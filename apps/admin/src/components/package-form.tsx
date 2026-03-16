"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

interface ServiceOption {
  id: string;
  name: string;
  slug: string;
}

interface PackageFormProps {
  mode: "create" | "edit";
  initialData?: {
    name: string;
    description: string | null;
    price_cents: number | null;
  };
  initialServiceIds?: string[];
  availableServices: ServiceOption[];
  action: (formData: FormData) => Promise<void>;
}

export function PackageForm({
  mode,
  initialData,
  initialServiceIds = [],
  availableServices,
  action,
}: PackageFormProps) {
  const [selectedServices, setSelectedServices] = useState<string[]>(initialServiceIds);

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

  function toggleService(serviceId: string) {
    setSelectedServices((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  }

  // Convert dollars to cents for form submission
  const initialPriceDollars =
    initialData?.price_cents != null
      ? (initialData.price_cents / 100).toFixed(2)
      : "";

  return (
    <form action={formAction}>
      <input
        type="hidden"
        name="service_ids"
        value={JSON.stringify(selectedServices)}
      />

      <div className="space-y-8">
        {error && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-600/10 p-4 text-sm text-rose-400">
            {error}
          </div>
        )}

        {/* Basic Info */}
        <div className="rounded-xl border border-zinc-800 bg-surface p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Package Details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-zinc-300 mb-1.5"
              >
                Package Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                minLength={2}
                maxLength={100}
                defaultValue={initialData?.name || ""}
                placeholder="e.g. Pro Bundle"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
              />
            </div>
            <div>
              <label
                htmlFor="price"
                className="block text-sm font-medium text-zinc-300 mb-1.5"
              >
                Price (USD)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-2.5 text-sm text-zinc-500">
                  $
                </span>
                <input
                  id="price"
                  name="price_display"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={initialPriceDollars}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 py-2.5 pl-7 pr-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
                  onChange={(e) => {
                    // Convert dollars to cents in a hidden field
                    const cents = e.target.value
                      ? Math.round(parseFloat(e.target.value) * 100)
                      : "";
                    const hidden = document.querySelector(
                      'input[name="price_cents"]'
                    ) as HTMLInputElement;
                    if (hidden) hidden.value = String(cents);
                  }}
                />
                <input
                  type="hidden"
                  name="price_cents"
                  defaultValue={initialData?.price_cents?.toString() || ""}
                />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="description"
                className="block text-sm font-medium text-zinc-300 mb-1.5"
              >
                Description
              </label>
              <textarea
                id="description"
                name="description"
                rows={3}
                defaultValue={initialData?.description || ""}
                placeholder="What's included in this package..."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Service Assignment */}
        <div className="rounded-xl border border-zinc-800 bg-surface p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Included Services</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Select which services are included in this package. Only active
            services are shown.
          </p>
          <div className="mt-4 space-y-2">
            {availableServices.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-700 p-4 text-center text-sm text-zinc-500">
                No services defined yet.{" "}
                <Link
                  href="/services/new"
                  className="text-brand-400 hover:text-brand-300"
                >
                  Create a service
                </Link>{" "}
                first.
              </div>
            ) : (
              availableServices.map((service) => (
                <label
                  key={service.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    selectedServices.includes(service.id)
                      ? "border-brand-500/40 bg-brand-600/10"
                      : "border-zinc-700 hover:border-zinc-600"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedServices.includes(service.id)}
                    onChange={() => toggleService(service.id)}
                    className="rounded border-zinc-600 bg-zinc-800 text-brand-500 focus:ring-brand-500/30"
                  />
                  <div>
                    <span className="text-sm font-medium text-zinc-100">{service.name}</span>
                    <span className="ml-2 text-xs text-zinc-500">
                      {service.slug}
                    </span>
                  </div>
                </label>
              ))
            )}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {selectedServices.length} service{selectedServices.length !== 1 ? "s" : ""} selected
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Link
            href="/packages"
            className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50 transition-all shadow-sm"
          >
            {isPending
              ? mode === "create"
                ? "Creating..."
                : "Saving..."
              : mode === "create"
                ? "Create Package"
                : "Save Changes"}
          </button>
        </div>
      </div>
    </form>
  );
}
