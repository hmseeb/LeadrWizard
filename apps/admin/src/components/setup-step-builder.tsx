"use client";

import { useState } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import type { SetupStepDefinition, ServiceTaskType } from "@leadrwizard/shared/types";

const TASK_TYPES: Array<{ value: ServiceTaskType; label: string }> = [
  { value: "a2p_registration", label: "A2P Registration" },
  { value: "gmb_access_request", label: "Google Business Profile" },
  { value: "website_generation", label: "Website Generation" },
  { value: "ghl_snapshot_deploy", label: "GHL Snapshot Deploy" },
  { value: "ghl_sub_account_provision", label: "GHL Sub-Account" },
];

interface SetupStepBuilderProps {
  initialSteps?: SetupStepDefinition[];
  name: string;
}

export function SetupStepBuilder({ initialSteps = [], name }: SetupStepBuilderProps) {
  const [steps, setSteps] = useState<SetupStepDefinition[]>(initialSteps);

  function addStep() {
    setSteps([
      ...steps,
      {
        key: "",
        label: "",
        description: "",
        automated: false,
      },
    ]);
  }

  function removeStep(index: number) {
    setSteps(steps.filter((_, i) => i !== index));
  }

  function updateStep(index: number, updates: Partial<SetupStepDefinition>) {
    setSteps(
      steps.map((s, i) => {
        if (i !== index) return s;
        const updated = { ...s, ...updates };
        if (updates.label && !s.key) {
          updated.key = updates.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
        }
        // Clear task_type when not automated
        if (updates.automated === false) {
          updated.task_type = undefined;
        }
        return updated;
      })
    );
  }

  function moveStep(from: number, to: number) {
    if (to < 0 || to >= steps.length) return;
    const updated = [...steps];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    setSteps(updated);
  }

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(steps)} />

      <div className="space-y-3">
        {steps.map((step, i) => (
          <div
            key={i}
            className="rounded-lg border bg-gray-50 p-4"
          >
            <div className="flex items-start gap-2">
              <div className="flex flex-col gap-1 pt-2">
                <button
                  type="button"
                  onClick={() => moveStep(i, i - 1)}
                  disabled={i === 0}
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  title="Move up"
                >
                  <GripVertical className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Label
                  </label>
                  <input
                    type="text"
                    value={step.label}
                    onChange={(e) => updateStep(i, { label: e.target.value })}
                    placeholder="e.g. Register A2P"
                    className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Key
                  </label>
                  <input
                    type="text"
                    value={step.key}
                    onChange={(e) => updateStep(i, { key: e.target.value })}
                    placeholder="register_a2p"
                    className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm font-mono"
                    required
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600">
                    Description
                  </label>
                  <input
                    type="text"
                    value={step.description}
                    onChange={(e) => updateStep(i, { description: e.target.value })}
                    placeholder="What this step does..."
                    className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                    required
                  />
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={step.automated}
                      onChange={(e) =>
                        updateStep(i, { automated: e.target.checked })
                      }
                      className="rounded border-gray-300"
                    />
                    Automated
                  </label>
                </div>
                {step.automated && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600">
                      Task Type
                    </label>
                    <select
                      value={step.task_type || ""}
                      onChange={(e) =>
                        updateStep(i, {
                          task_type: (e.target.value || undefined) as ServiceTaskType | undefined,
                        })
                      }
                      className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                    >
                      <option value="">Select task type...</option>
                      {TASK_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => removeStep(i)}
                className="mt-6 text-red-400 hover:text-red-600"
                title="Remove step"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addStep}
        className="mt-3 flex items-center gap-2 rounded-lg border border-dashed px-4 py-2 text-sm text-gray-500 hover:border-brand-300 hover:text-brand-600"
      >
        <Plus className="h-4 w-4" />
        Add Setup Step
      </button>
    </div>
  );
}
