"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { TEMPLATE_VARIABLES } from "@leadrwizard/shared/types";
import type { MessageTemplate, MessageChannel } from "@leadrwizard/shared/types";
import { TemplatePreview } from "./template-preview";

interface TemplateFormProps {
  mode: "create" | "edit";
  initialData?: MessageTemplate;
  action: (formData: FormData) => Promise<void>;
}

export function TemplateForm({ mode, initialData, action }: TemplateFormProps) {
  const [channel, setChannel] = useState<MessageChannel>(
    initialData?.channel || "sms"
  );
  const [body, setBody] = useState(initialData?.body || "");
  const [subject, setSubject] = useState(initialData?.subject || "");

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

  function insertVariable(varKey: string) {
    const textarea = document.getElementById("body") as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = `{{${varKey}}}`;
    const newBody =
      body.substring(0, start) + text + body.substring(end);
    setBody(newBody);
    // Restore cursor position after React re-render
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + text.length, start + text.length);
    });
  }

  return (
    <form action={formAction}>
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Left: Form */}
        <div className="space-y-6">
          {error && (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Basic Info */}
          <div className="rounded-lg border bg-white p-6">
            <h2 className="text-lg font-semibold">Template Details</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="name"
                  className="block text-sm font-medium text-gray-700"
                >
                  Template Name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={100}
                  defaultValue={initialData?.name || ""}
                  placeholder="e.g. Welcome SMS"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Channel
                </label>
                <div className="mt-2 flex gap-2">
                  {(["sms", "email", "voice"] as const).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setChannel(ch)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                        channel === ch
                          ? "bg-brand-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {ch === "sms" ? "SMS" : ch === "email" ? "Email" : "Voice"}
                    </button>
                  ))}
                </div>
                <input type="hidden" name="channel" value={channel} />
              </div>

              {channel === "email" && (
                <div>
                  <label
                    htmlFor="subject"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Subject Line
                  </label>
                  <input
                    id="subject"
                    name="subject"
                    type="text"
                    required={channel === "email"}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. Complete your {{packageName}} setup"
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  />
                </div>
              )}
              {channel !== "email" && (
                <input type="hidden" name="subject" value="" />
              )}
            </div>
          </div>

          {/* Body */}
          <div className="rounded-lg border bg-white p-6">
            <h2 className="text-lg font-semibold">Message Body</h2>
            <p className="mt-1 text-sm text-gray-500">
              Use {"{{variableName}}"} to insert dynamic content. Click a variable
              below to insert it at the cursor.
            </p>

            {/* Variable Quick-Insert */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insertVariable(v.key)}
                  className="rounded bg-gray-100 px-2 py-1 text-xs font-mono text-gray-600 hover:bg-brand-50 hover:text-brand-700"
                  title={v.label}
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>

            <textarea
              id="body"
              name="body"
              rows={channel === "sms" ? 4 : channel === "voice" ? 6 : 10}
              required
              minLength={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                channel === "sms"
                  ? "Hey {{name}}, your {{packageName}} setup is ready..."
                  : channel === "voice"
                    ? "Hi, this is a call about your service setup with {{businessName}}..."
                    : "Dear {{name}},\n\nWe're reaching out about your {{packageName}} setup..."
              }
              className="mt-3 w-full rounded-md border px-3 py-2 text-sm font-mono"
            />

            {channel === "sms" && (
              <p className="mt-1 text-xs text-gray-400">
                {body.length} characters
                {body.length > 160 && " (will be sent as multiple segments)"}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <Link
              href="/templates"
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
                  ? "Create Template"
                  : "Save Changes"}
            </button>
          </div>
        </div>

        {/* Right: Preview + Variable Reference */}
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Preview</h2>
            <p className="mt-1 text-sm text-gray-500">
              Shows how the message will look with sample data.
            </p>
            <div className="mt-4">
              <TemplatePreview
                body={body}
                subject={channel === "email" ? subject : undefined}
                channel={channel}
              />
            </div>
          </div>

          {/* Variable Reference */}
          <div className="rounded-lg border bg-white p-6">
            <h3 className="text-sm font-semibold text-gray-700">
              Available Variables
            </h3>
            <p className="mt-1 text-xs text-gray-400">
              These are replaced with real values when the message is sent.
            </p>
            <div className="mt-3 space-y-2">
              {TEMPLATE_VARIABLES.map((v) => (
                <div
                  key={v.key}
                  className="flex items-start justify-between text-sm"
                >
                  <div>
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
                      {`{{${v.key}}}`}
                    </code>
                    <span className="ml-2 text-gray-600">{v.label}</span>
                  </div>
                  <span className="text-xs text-gray-400">{v.example}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
