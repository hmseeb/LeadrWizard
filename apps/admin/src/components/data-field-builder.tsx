"use client";

import { useState } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import type { DataFieldDefinition } from "@leadrwizard/shared/types";

const FIELD_TYPES: Array<{ value: DataFieldDefinition["type"]; label: string }> = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "url", label: "URL" },
  { value: "textarea", label: "Textarea" },
  { value: "select", label: "Select (dropdown)" },
  { value: "file", label: "File Upload" },
];

interface DataFieldBuilderProps {
  initialFields?: DataFieldDefinition[];
  name: string; // hidden input name for form submission
}

export function DataFieldBuilder({ initialFields = [], name }: DataFieldBuilderProps) {
  const [fields, setFields] = useState<DataFieldDefinition[]>(initialFields);

  function addField() {
    setFields([
      ...fields,
      {
        key: "",
        label: "",
        type: "text",
        required: true,
      },
    ]);
  }

  function removeField(index: number) {
    setFields(fields.filter((_, i) => i !== index));
  }

  function updateField(index: number, updates: Partial<DataFieldDefinition>) {
    setFields(
      fields.map((f, i) => {
        if (i !== index) return f;
        const updated = { ...f, ...updates };
        // Auto-generate key from label if key is empty
        if (updates.label && !f.key) {
          updated.key = updates.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
        }
        return updated;
      })
    );
  }

  function moveField(from: number, to: number) {
    if (to < 0 || to >= fields.length) return;
    const updated = [...fields];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    setFields(updated);
  }

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(fields)} />

      <div className="space-y-3">
        {fields.map((field, i) => (
          <div
            key={i}
            className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4"
          >
            <div className="flex items-start gap-2">
              <div className="flex flex-col gap-1 pt-2">
                <button
                  type="button"
                  onClick={() => moveField(i, i - 1)}
                  disabled={i === 0}
                  className="text-zinc-500 hover:text-zinc-300 disabled:opacity-30 transition-colors"
                  title="Move up"
                >
                  <GripVertical className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400">
                    Label
                  </label>
                  <input
                    type="text"
                    value={field.label}
                    onChange={(e) => updateField(i, { label: e.target.value })}
                    placeholder="e.g. Business Name"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400">
                    Key
                  </label>
                  <input
                    type="text"
                    value={field.key}
                    onChange={(e) => updateField(i, { key: e.target.value })}
                    placeholder="business_name"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2 text-sm font-mono text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400">
                    Type
                  </label>
                  <select
                    value={field.type}
                    onChange={(e) =>
                      updateField(i, {
                        type: e.target.value as DataFieldDefinition["type"],
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2 text-sm text-zinc-100 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end gap-4">
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) =>
                        updateField(i, { required: e.target.checked })
                      }
                      className="rounded border-zinc-600 bg-zinc-800 text-brand-500 focus:ring-brand-500/30"
                    />
                    Required
                  </label>
                </div>
                {field.type === "select" && (
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-zinc-400">
                      Options (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={(field.options || []).join(", ")}
                      onChange={(e) =>
                        updateField(i, {
                          options: e.target.value
                            .split(",")
                            .map((o) => o.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Option 1, Option 2, Option 3"
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-zinc-400">
                    Placeholder
                  </label>
                  <input
                    type="text"
                    value={field.placeholder || ""}
                    onChange={(e) =>
                      updateField(i, { placeholder: e.target.value || undefined })
                    }
                    placeholder="Enter your..."
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400">
                    Help Text
                  </label>
                  <input
                    type="text"
                    value={field.help_text || ""}
                    onChange={(e) =>
                      updateField(i, { help_text: e.target.value || undefined })
                    }
                    placeholder="Additional instructions..."
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => removeField(i)}
                className="mt-6 text-rose-400 hover:text-rose-300 transition-colors"
                title="Remove field"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addField}
        className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:border-brand-500/40 hover:text-brand-400 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add Data Field
      </button>
    </div>
  );
}
