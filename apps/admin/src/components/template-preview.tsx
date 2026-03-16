"use client";

import { TEMPLATE_VARIABLES } from "@leadrwizard/shared/types";
import type { MessageChannel } from "@leadrwizard/shared/types";

interface TemplatePreviewProps {
  body: string;
  subject?: string;
  channel: MessageChannel;
}

// Build sample data from TEMPLATE_VARIABLES constant
const sampleData: Record<string, string> = Object.fromEntries(
  TEMPLATE_VARIABLES.map((v) => [v.key, v.example])
);

function interpolate(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return sampleData[key] || match;
  });
}

const channelStyles: Record<MessageChannel, { label: string; accent: string; maxWidth: string }> = {
  sms: { label: "SMS Preview", accent: "border-emerald-500/30", maxWidth: "max-w-sm" },
  email: { label: "Email Preview", accent: "border-blue-500/30", maxWidth: "max-w-lg" },
  voice: { label: "Voice Script Preview", accent: "border-purple-500/30", maxWidth: "max-w-md" },
};

export function TemplatePreview({ body, subject, channel }: TemplatePreviewProps) {
  const style = channelStyles[channel];
  const renderedBody = interpolate(body);
  const renderedSubject = subject ? interpolate(subject) : null;

  if (!body.trim()) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 p-6 text-center text-sm text-zinc-500">
        Start typing to see preview...
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${style.accent} bg-zinc-900/80 p-4`}>
      <p className="mb-2 text-xs font-medium uppercase text-zinc-500">
        {style.label}
      </p>

      <div className={`${style.maxWidth}`}>
        {channel === "email" && renderedSubject && (
          <div className="mb-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-100">
            Subject: {renderedSubject}
          </div>
        )}

        {channel === "sms" ? (
          /* SMS bubble style */
          <div className="rounded-2xl rounded-tl-sm border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-200 shadow-sm">
            {renderedBody.split("\n").map((line, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </div>
        ) : channel === "voice" ? (
          /* Voice script style */
          <div className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm italic text-zinc-300 shadow-sm">
            &ldquo;{renderedBody}&rdquo;
          </div>
        ) : (
          /* Email body style */
          <div className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-300 shadow-sm">
            {renderedBody.split("\n").map((line, i) => (
              <p key={i} className={line.trim() === "" ? "h-3" : ""}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 text-xs text-zinc-500">
        Variables shown with sample data
      </div>
    </div>
  );
}
