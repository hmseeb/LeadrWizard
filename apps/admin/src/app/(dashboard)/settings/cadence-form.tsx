"use client";

import { useActionState } from "react";
import { saveEscalationConfig, type ActionResult } from "./actions";
import type { OrgSettings } from "@leadrwizard/shared/types";

const initialState: ActionResult = { success: false };

export function CadenceForm({ settings }: { settings: OrgSettings }) {
  const [state, action, pending] = useActionState(
    saveEscalationConfig,
    initialState
  );

  const cadenceSteps = settings.outreach_cadence?.steps || [
    { delay_minutes: 60, channel: "sms", message_template: "first_reminder" },
    { delay_minutes: 240, channel: "sms", message_template: "second_reminder" },
    { delay_minutes: 1440, channel: "voice_call", message_template: "first_call" },
    { delay_minutes: 2880, channel: "email", message_template: "email_reminder" },
    { delay_minutes: 4320, channel: "voice_call", message_template: "second_call" },
    { delay_minutes: 7200, channel: "sms", message_template: "urgent_reminder" },
    { delay_minutes: 10080, channel: "voice_call", message_template: "final_call" },
  ];

  const channelColors: Record<string, { bg: string; text: string }> = {
    sms: { bg: "bg-blue-500/10 border border-blue-500/20", text: "text-blue-400" },
    voice_call: { bg: "bg-emerald-500/10 border border-emerald-500/20", text: "text-emerald-400" },
    email: { bg: "bg-purple-500/10 border border-purple-500/20", text: "text-purple-400" },
  };

  function formatDelay(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 1440) return `${Math.round(minutes / 60)} hours`;
    return `${Math.round(minutes / 1440)} days`;
  }

  return (
    <div className="space-y-6">
      {/* Follow-Up Cadence (read-only display for now) */}
      <div className="rounded-xl border border-zinc-800 bg-surface p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Follow-Up Cadence</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Escalating outreach sequence for unresponsive clients
        </p>
        <div className="mt-4 space-y-2 text-sm">
          {cadenceSteps.map((step, i) => {
            const colors = channelColors[step.channel] || {
              bg: "bg-zinc-800 border border-zinc-700",
              text: "text-zinc-400",
            };
            return (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5"
              >
                <span className="w-20 text-zinc-500">
                  {formatDelay(step.delay_minutes)}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${colors.bg} ${colors.text}`}
                >
                  {step.channel === "voice_call" ? "Voice Call" : step.channel.toUpperCase()}
                </span>
                <span className="text-zinc-300">
                  {step.message_template.replace(/_/g, " ")}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Escalation Channel */}
      <div className="rounded-xl border border-zinc-800 bg-surface p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Escalation Channel</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Where bot-stuck cases get posted for human review
        </p>
        <form action={action} className="mt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Channel
            </label>
            <select
              name="escalation_channel"
              defaultValue={settings.escalation_channel || ""}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
            >
              <option value="">None</option>
              <option value="slack">Slack</option>
              <option value="google_chat">Google Chat</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Webhook URL
            </label>
            <input
              type="url"
              name="escalation_webhook_url"
              placeholder="https://hooks.slack.com/services/..."
              defaultValue={settings.escalation_webhook_url || ""}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50 transition-all shadow-sm"
            >
              {pending ? "Saving..." : "Save Escalation Config"}
            </button>
            {state.success && (
              <span className="text-sm text-emerald-400">Saved successfully</span>
            )}
            {state.error && (
              <span className="text-sm text-rose-400">{state.error}</span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
