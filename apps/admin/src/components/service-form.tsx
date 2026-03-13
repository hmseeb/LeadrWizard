"use client";

import { useActionState } from "react";
import Link from "next/link";
import { DataFieldBuilder } from "./data-field-builder";
import { SetupStepBuilder } from "./setup-step-builder";
import type { ServiceDefinition } from "@leadrwizard/shared/types";

interface ServiceFormProps {
  mode: "create" | "edit";
  initialData?: ServiceDefinition;
  action: (formData: FormData) => Promise<void>;
}

export function ServiceForm({ mode, initialData, action }: ServiceFormProps) {
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
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Basic Info */}
        <div className="rounded-lg border bg-white p-6">
          <h2 className="text-lg font-semibold">Basic Information</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="name"
                className="block text-sm font-medium text-gray-700"
              >
                Service Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                minLength={2}
                maxLength={100}
                defaultValue={initialData?.name || ""}
                placeholder="e.g. A2P Registration"
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
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
                placeholder="What this service does and why clients need it..."
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Required Data Fields */}
        <div className="rounded-lg border bg-white p-6">
          <h2 className="text-lg font-semibold">Required Data Fields</h2>
          <p className="mt-1 text-sm text-gray-500">
            Define what information the onboarding agent needs to collect from
            clients for this service.
          </p>
          <div className="mt-4">
            <DataFieldBuilder
              name="required_data_fields"
              initialFields={initialData?.required_data_fields || []}
            />
          </div>
        </div>

        {/* Setup Steps */}
        <div className="rounded-lg border bg-white p-6">
          <h2 className="text-lg font-semibold">Setup Steps</h2>
          <p className="mt-1 text-sm text-gray-500">
            Define the steps to provision this service after data collection.
            Automated steps run without human intervention.
          </p>
          <div className="mt-4">
            <SetupStepBuilder
              name="setup_steps"
              initialSteps={initialData?.setup_steps || []}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Link
            href="/services"
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
                ? "Create Service"
                : "Save Changes"}
          </button>
        </div>
      </div>
    </form>
  );
}
