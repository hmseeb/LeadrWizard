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
          <div className="rounded-lg border border-rose-500/20 bg-rose-600/10 p-4 text-sm text-rose-400">
            {error}
          </div>
        )}

        {/* Basic Info */}
        <div className="rounded-xl border border-zinc-800 bg-surface p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Basic Information</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="name"
                className="block text-sm font-medium text-zinc-300 mb-1.5"
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
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
              />
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
                placeholder="What this service does and why clients need it..."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Required Data Fields */}
        <div className="rounded-xl border border-zinc-800 bg-surface p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Required Data Fields</h2>
          <p className="mt-1 text-sm text-zinc-400">
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
        <div className="rounded-xl border border-zinc-800 bg-surface p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Setup Steps</h2>
          <p className="mt-1 text-sm text-zinc-400">
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
                ? "Create Service"
                : "Save Changes"}
          </button>
        </div>
      </div>
    </form>
  );
}
