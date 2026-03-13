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

const channelStyles: Record<MessageChannel, { label: string; bg: string; maxWidth: string }> = {
  sms: { label: "SMS Preview", bg: "bg-green-50", maxWidth: "max-w-sm" },
  email: { label: "Email Preview", bg: "bg-blue-50", maxWidth: "max-w-lg" },
  voice: { label: "Voice Script Preview", bg: "bg-purple-50", maxWidth: "max-w-md" },
};

export function TemplatePreview({ body, subject, channel }: TemplatePreviewProps) {
  const style = channelStyles[channel];
  const renderedBody = interpolate(body);
  const renderedSubject = subject ? interpolate(subject) : null;

  if (!body.trim()) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-gray-400">
        Start typing to see preview...
      </div>
    );
  }

  return (
    <div className={`rounded-lg ${style.bg} p-4`}>
      <p className="mb-2 text-xs font-medium uppercase text-gray-500">
        {style.label}
      </p>

      <div className={`${style.maxWidth}`}>
        {channel === "email" && renderedSubject && (
          <div className="mb-2 rounded bg-white px-3 py-2 text-sm font-medium text-gray-900">
            Subject: {renderedSubject}
          </div>
        )}

        {channel === "sms" ? (
          /* SMS bubble style */
          <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm text-gray-800 shadow-sm">
            {renderedBody.split("\n").map((line, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </div>
        ) : channel === "voice" ? (
          /* Voice script style */
          <div className="rounded bg-white px-4 py-3 text-sm italic text-gray-700 shadow-sm">
            &ldquo;{renderedBody}&rdquo;
          </div>
        ) : (
          /* Email body style */
          <div className="rounded bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">
            {renderedBody.split("\n").map((line, i) => (
              <p key={i} className={line.trim() === "" ? "h-3" : ""}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 text-xs text-gray-400">
        Variables shown with sample data
      </div>
    </div>
  );
}
