"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

interface PackageOption {
  id: string;
  name: string;
  description: string | null;
}

interface NewClientFormProps {
  packages: PackageOption[];
  action: (formData: FormData) => Promise<void>;
}

const MESSAGE_TYPES = [
  {
    id: "appointment_reminders",
    label: "Appointment Reminders",
    description: "Upcoming appointment notifications and confirmations",
    sample: "Hi {{name}}, this is a reminder about your appointment with {{business}} on {{date}} at {{time}}. Reply C to confirm or R to reschedule.",
  },
  {
    id: "missed_call_textback",
    label: "Missed Call Text Back",
    description: "Auto-text when a call is missed",
    sample: "Hey {{name}}, sorry we missed your call at {{business}}! How can we help? Reply here or call us back at {{phone}}.",
  },
  {
    id: "review_requests",
    label: "Review Requests",
    description: "Post-service review and feedback requests",
    sample: "Thanks for choosing {{business}}, {{name}}! We'd love your feedback — tap here to leave a review: {{link}}",
  },
  {
    id: "promotional",
    label: "Promotions & Offers",
    description: "Deals, discounts, and special offers",
    sample: "{{name}}, {{business}} has a special offer for you this week! {{offer_details}}. Reply STOP to opt out.",
  },
  {
    id: "service_updates",
    label: "Service Updates",
    description: "Job status, delivery, and completion updates",
    sample: "Hi {{name}}, your {{service}} with {{business}} has been completed. Let us know if you have any questions!",
  },
  {
    id: "two_way_conversation",
    label: "Two-Way Conversations",
    description: "General customer support and chat",
    sample: "Hi {{name}}, thanks for reaching out to {{business}}! A team member will respond shortly. Reply HELP for assistance.",
  },
  {
    id: "booking_confirmation",
    label: "Booking Confirmations",
    description: "Confirmation messages after scheduling",
    sample: "{{name}}, your booking with {{business}} is confirmed for {{date}} at {{time}}. We'll send a reminder before your appointment.",
  },
  {
    id: "follow_up",
    label: "Follow-Up Messages",
    description: "Post-service check-ins and follow-ups",
    sample: "Hi {{name}}, it's been a week since your visit to {{business}}. How is everything going? We're here if you need anything.",
  },
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

const inputClass = "w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors";
const labelClass = "block text-sm font-medium text-zinc-300 mb-1.5";

export function NewClientForm({ packages, action }: NewClientFormProps) {
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);

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

  function toggleMessage(id: string) {
    setSelectedMessages((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  const selectedSamples = MESSAGE_TYPES
    .filter((m) => selectedMessages.includes(m.id))
    .map((m) => m.sample);

  return (
    <form action={formAction}>
      <input type="hidden" name="message_types" value={JSON.stringify(selectedMessages)} />
      <input type="hidden" name="sample_messages" value={JSON.stringify(selectedSamples)} />

      <div className="space-y-8">
        {error && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-600/10 p-4 text-sm text-rose-400">
            {error}
          </div>
        )}

        {/* Section 1: Client Contact Info */}
        <div className="rounded-xl border border-zinc-800 bg-surface p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Client Contact</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Point of contact for this client. They will not be contacted automatically.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="customer_name" className={labelClass}>Contact Name</label>
              <input id="customer_name" name="customer_name" type="text" required minLength={2} placeholder="John Smith" className={inputClass} />
            </div>
            <div>
              <label htmlFor="customer_email" className={labelClass}>Contact Email</label>
              <input id="customer_email" name="customer_email" type="email" required placeholder="john@business.com" className={inputClass} />
            </div>
            <div>
              <label htmlFor="customer_phone" className={labelClass}>Contact Phone</label>
              <input id="customer_phone" name="customer_phone" type="tel" placeholder="+1 (555) 123-4567" className={inputClass} />
            </div>
          </div>
        </div>

        {/* Section 2: Business Information (A2P) */}
        <div className="rounded-xl border border-zinc-800 bg-surface p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Business Information</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Legal business details for A2P 10DLC registration with Twilio. Must match IRS records.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="legal_business_name" className={labelClass}>Legal Business Name</label>
              <input id="legal_business_name" name="legal_business_name" type="text" required placeholder="Smith Plumbing LLC" className={inputClass} />
              <p className="mt-1 text-xs text-zinc-500">Exact name as registered with the IRS</p>
            </div>
            <div>
              <label htmlFor="ein" className={labelClass}>EIN (Tax ID)</label>
              <input id="ein" name="ein" type="text" required placeholder="12-3456789" maxLength={10} className={inputClass} />
              <p className="mt-1 text-xs text-zinc-500">9-digit Employer Identification Number</p>
            </div>
            <div>
              <label htmlFor="business_phone" className={labelClass}>Business Phone</label>
              <input id="business_phone" name="business_phone" type="tel" required placeholder="+1 (555) 000-0000" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="business_address" className={labelClass}>Street Address</label>
              <input id="business_address" name="business_address" type="text" required placeholder="123 Main St, Suite 100" className={inputClass} />
            </div>
            <div>
              <label htmlFor="business_city" className={labelClass}>City</label>
              <input id="business_city" name="business_city" type="text" required placeholder="Houston" className={inputClass} />
            </div>
            <div>
              <label htmlFor="business_state" className={labelClass}>State</label>
              <select id="business_state" name="business_state" required className={inputClass}>
                <option value="">Select state</option>
                {US_STATES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="business_zip" className={labelClass}>ZIP Code</label>
              <input id="business_zip" name="business_zip" type="text" required placeholder="77001" maxLength={10} className={inputClass} />
            </div>
          </div>
        </div>

        {/* Section 3: Message Types */}
        <div className="rounded-xl border border-zinc-800 bg-surface p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Message Types</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Select the types of messages this client&apos;s customers will receive. This determines what gets submitted to Twilio for A2P approval.
          </p>
          <div className="mt-4 space-y-2">
            {MESSAGE_TYPES.map((msg) => (
              <label
                key={msg.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                  selectedMessages.includes(msg.id)
                    ? "border-brand-500/40 bg-brand-600/10"
                    : "border-zinc-700 hover:border-zinc-600"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedMessages.includes(msg.id)}
                  onChange={() => toggleMessage(msg.id)}
                  className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-brand-500 focus:ring-brand-500/30"
                />
                <div className="flex-1">
                  <span className="text-sm font-medium text-zinc-100">{msg.label}</span>
                  <p className="mt-0.5 text-xs text-zinc-400">{msg.description}</p>
                  <p className="mt-1.5 rounded bg-zinc-800/80 px-2.5 py-1.5 text-xs text-zinc-400 font-mono">
                    {msg.sample}
                  </p>
                </div>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {selectedMessages.length} message type{selectedMessages.length !== 1 ? "s" : ""} selected
          </p>
        </div>

        {/* Section 4: SMS Compliance Disclosures */}
        <div className="rounded-xl border border-zinc-800 bg-surface p-6">
          <h2 className="text-lg font-semibold text-zinc-50">SMS Compliance</h2>
          <p className="mt-1 text-sm text-zinc-400">
            These opt-in/opt-out disclosures will be included in the A2P campaign registration. They are required by carriers and TCPA regulations.
          </p>
          <div className="mt-4 space-y-3">
            <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="rounded bg-emerald-600/20 px-2 py-0.5 text-xs font-medium text-emerald-400">STOP</span>
                <span className="text-xs text-zinc-400">Opt-Out</span>
              </div>
              <p className="text-xs text-zinc-300 font-mono">
                Reply STOP to unsubscribe from future messages. You will receive a confirmation and no further messages will be sent.
              </p>
            </div>
            <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="rounded bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-400">HELP</span>
                <span className="text-xs text-zinc-400">Support</span>
              </div>
              <p className="text-xs text-zinc-300 font-mono">
                Reply HELP for support. Contact us at {"{{email}}"} or call {"{{phone}}"} for assistance.
              </p>
            </div>
            <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="rounded bg-amber-600/20 px-2 py-0.5 text-xs font-medium text-amber-400">START</span>
                <span className="text-xs text-zinc-400">Re-subscribe</span>
              </div>
              <p className="text-xs text-zinc-300 font-mono">
                Reply START or YES to re-subscribe to messages after opting out.
              </p>
            </div>
            <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="rounded bg-purple-600/20 px-2 py-0.5 text-xs font-medium text-purple-400">OPT-IN</span>
                <span className="text-xs text-zinc-400">Initial Consent</span>
              </div>
              <p className="text-xs text-zinc-300 font-mono">
                By providing your phone number, you consent to receive text messages from {"{{business}}"}. Msg & data rates may apply. Msg frequency varies. Reply STOP to cancel, HELP for help.
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            These disclosures are automatically included in the Twilio campaign registration and cannot be modified.
          </p>
        </div>

        {/* Section 5: Package Selection */}
        <div className="rounded-xl border border-zinc-800 bg-surface p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Select Package</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Choose which services to register for this client.
          </p>
          <div className="mt-4 space-y-2">
            {packages.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-700 p-4 text-center text-sm text-zinc-500">
                No packages defined yet.{" "}
                <Link href="/packages/new" className="text-brand-400 hover:text-brand-300">
                  Create a package
                </Link>{" "}
                first.
              </div>
            ) : (
              packages.map((pkg) => (
                <label
                  key={pkg.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-700 p-4 transition-colors hover:border-zinc-600 has-[:checked]:border-brand-500/40 has-[:checked]:bg-brand-600/10"
                >
                  <input
                    type="radio"
                    name="package_id"
                    value={pkg.id}
                    required
                    className="border-zinc-600 bg-zinc-800 text-brand-500 focus:ring-brand-500/30"
                  />
                  <div>
                    <span className="text-sm font-medium text-zinc-100">{pkg.name}</span>
                    {pkg.description && (
                      <p className="mt-0.5 text-xs text-zinc-400">{pkg.description}</p>
                    )}
                  </div>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Link
            href="/clients"
            className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending || packages.length === 0 || selectedMessages.length === 0}
            className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50 transition-all shadow-sm"
          >
            {isPending ? "Submitting A2P Registration..." : "Submit A2P Registration"}
          </button>
        </div>
      </div>
    </form>
  );
}
