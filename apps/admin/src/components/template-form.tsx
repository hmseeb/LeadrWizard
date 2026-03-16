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
            <div className="rounded-lg border border-rose-500/20 bg-rose-600/10 p-4 text-sm text-rose-400">
              {error}
            </div>
          )}

          {/* Basic Info */}
          <div className="rounded-xl border border-zinc-800 bg-surface p-6">
            <h2 className="text-lg font-semibold text-zinc-50">Template Details</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="name"
                  className="block text-sm font-medium text-zinc-300 mb-1.5"
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
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  Channel
                </label>
                <div className="flex gap-2">
                  {(["sms", "email", "voice"] as const).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setChannel(ch)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                        channel === ch
                          ? "bg-brand-600 text-white shadow-sm"
                          : "border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
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
                    className="block text-sm font-medium text-zinc-300 mb-1.5"
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
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
                  />
                </div>
              )}
              {channel !== "email" && (
                <input type="hidden" name="subject" value="" />
              )}
            </div>
          </div>

          {/* Body */}
          <div className="rounded-xl border border-zinc-800 bg-surface p-6">
            <h2 className="text-lg font-semibold text-zinc-50">Message Body</h2>
            <p className="mt-1 text-sm text-zinc-400">
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
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-mono text-zinc-400 hover:border-brand-500/40 hover:text-brand-400 transition-colors"
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
              className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
            />

            {channel === "sms" && (
              <p className="mt-1 text-xs text-zinc-500">
                {body.length} characters
                {body.length > 160 && " (will be sent as multiple segments)"}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <Link
              href="/templates"
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
                  ? "Create Template"
                  : "Save Changes"}
            </button>
          </div>
        </div>

        {/* Right: Preview + Variable Reference */}
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-zinc-50">Preview</h2>
            <p className="mt-1 text-sm text-zinc-400">
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
          <div className="rounded-xl border border-zinc-800 bg-surface p-6">
            <h3 className="text-sm font-semibold text-zinc-300">
              Available Variables
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              These are replaced with real values when the message is sent.
            </p>
            <div className="mt-3 space-y-2">
              {TEMPLATE_VARIABLES.map((v) => (
                <div
                  key={v.key}
                  className="flex items-start justify-between text-sm"
                >
                  <div>
                    <code className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                      {`{{${v.key}}}`}
                    </code>
                    <span className="ml-2 text-zinc-400">{v.label}</span>
                  </div>
                  <span className="text-xs text-zinc-500">{v.example}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
