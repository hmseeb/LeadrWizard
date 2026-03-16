import { createSupabaseServerClient } from "@/lib/supabase-server";
import Link from "next/link";
import { MessageSquare, Mail, Phone } from "lucide-react";
import { TemplateActions } from "./template-actions";
import type { MessageChannel } from "@leadrwizard/shared/types";

const channelConfig: Record<
  MessageChannel,
  { label: string; icon: typeof MessageSquare; color: string }
> = {
  sms: { label: "SMS", icon: MessageSquare, color: "text-emerald-400 ring-1 ring-emerald-500/30 bg-emerald-500/10" },
  email: { label: "Email", icon: Mail, color: "text-sky-400 ring-1 ring-sky-500/30 bg-sky-500/10" },
  voice: { label: "Voice", icon: Phone, color: "text-purple-400 ring-1 ring-purple-500/30 bg-purple-500/10" },
};

export default async function TemplatesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: templates } = await supabase
    .from("message_templates")
    .select("*")
    .eq("is_active", true)
    .order("channel", { ascending: true })
    .order("name", { ascending: true });

  // Group by channel for display
  type TemplateRow = NonNullable<typeof templates>[number];
  const grouped = (templates || []).reduce<Record<string, TemplateRow[]>>(
    (acc, t) => {
      const ch = t.channel as MessageChannel;
      if (!acc[ch]) acc[ch] = [];
      acc[ch].push(t);
      return acc;
    },
    {}
  );

  const channelOrder: MessageChannel[] = ["sms", "email", "voice"];
  const totalCount = templates?.length || 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">Message Templates</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Outreach templates for SMS, email, and voice messages. Use{" "}
            {"{{variables}}"} for dynamic content.
          </p>
        </div>
        <Link
          href="/templates/new"
          className="btn-primary"
        >
          Create Template
        </Link>
      </div>

      {totalCount === 0 ? (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-surface p-8 text-center text-zinc-500">
          No message templates yet.{" "}
          <Link
            href="/templates/new"
            className="text-brand-400 hover:text-brand-300"
          >
            Create your first template
          </Link>{" "}
          to start customizing outreach messages.
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {channelOrder.map((ch) => {
            const items = grouped[ch];
            if (!items || items.length === 0) return null;

            const config = channelConfig[ch];
            const Icon = config.icon;

            return (
              <div key={ch}>
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-lg ${config.color}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <h2 className="text-lg font-semibold text-zinc-50">
                    {config.label} Templates
                  </h2>
                  <span className="text-sm text-zinc-500">
                    ({items.length})
                  </span>
                </div>

                <div className="mt-3 grid gap-3">
                  {items.map((template) => {
                    // Extract variable names from body
                    const vars = Array.from(
                      (template.body as string).matchAll(/\{\{(\w+)\}\}/g)
                    ).map((m) => m[1]);
                    const uniqueVars = [...new Set(vars)];

                    // Truncate body for preview
                    const bodyPreview =
                      (template.body as string).length > 120
                        ? (template.body as string).substring(0, 120) + "..."
                        : (template.body as string);

                    return (
                      <div
                        key={template.id}
                        className="rounded-xl border border-zinc-800 bg-surface p-5"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-zinc-50">
                                {template.name}
                              </h3>
                              <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-xs font-mono text-zinc-400">
                                {template.slug}
                              </span>
                            </div>
                            {ch === "email" && template.subject && (
                              <p className="mt-1 text-sm text-zinc-300">
                                Subject: {template.subject}
                              </p>
                            )}
                            <p className="mt-1 text-sm text-zinc-400">
                              {bodyPreview}
                            </p>
                            {uniqueVars.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {uniqueVars.map((v) => (
                                  <span
                                    key={v}
                                    className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-xs font-mono text-zinc-400"
                                  >
                                    {`{{${v}}}`}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <TemplateActions
                            templateId={template.id}
                            templateName={template.name}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
