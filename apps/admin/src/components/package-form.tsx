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
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Basic Info */}
        <div className="rounded-lg border bg-white p-6">
          <h2 className="text-lg font-semibold">Package Details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-gray-700"
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
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="price"
                className="block text-sm font-medium text-gray-700"
              >
                Price (USD)
              </label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute left-3 top-2 text-sm text-gray-400">
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
                  className="w-full rounded-md border py-2 pl-7 pr-3 text-sm"
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
                className="block text-sm font-medium text-gray-700"
              >
                Description
              </label>
              <textarea
                id="description"
                name="description"
                rows={3}
                defaultValue={initialData?.description || ""}
                placeholder="What's included in this package..."
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Service Assignment */}
        <div className="rounded-lg border bg-white p-6">
          <h2 className="text-lg font-semibold">Included Services</h2>
          <p className="mt-1 text-sm text-gray-500">
            Select which services are included in this package. Only active
            services are shown.
          </p>
          <div className="mt-4 space-y-2">
            {availableServices.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center text-sm text-gray-400">
                No services defined yet.{" "}
                <Link
                  href="/services/new"
                  className="text-brand-600 hover:text-brand-700"
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
                      ? "border-brand-300 bg-brand-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedServices.includes(service.id)}
                    onChange={() => toggleService(service.id)}
                    className="rounded border-gray-300"
                  />
                  <div>
                    <span className="text-sm font-medium">{service.name}</span>
                    <span className="ml-2 text-xs text-gray-400">
                      {service.slug}
                    </span>
                  </div>
                </label>
              ))
            )}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            {selectedServices.length} service{selectedServices.length !== 1 ? "s" : ""} selected
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Link
            href="/packages"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
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
