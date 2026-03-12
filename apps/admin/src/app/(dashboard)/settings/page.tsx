export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-gray-500">
        Configure integrations and automation behavior
      </p>

      <div className="mt-6 space-y-6">
        {/* Integration Cards */}
        {[
          {
            name: "GoHighLevel",
            description: "CRM, email, sub-account provisioning, snapshot deployment",
            fields: ["API Key", "Location ID", "Snapshot ID"],
            status: "Not configured",
          },
          {
            name: "Twilio",
            description: "SMS messaging and A2P registration",
            fields: ["Account SID", "Auth Token", "Phone Number"],
            status: "Not configured",
          },
          {
            name: "Vapi",
            description: "Outbound AI voice calls",
            fields: ["API Key", "Assistant ID"],
            status: "Not configured",
          },
          {
            name: "ElevenLabs",
            description: "In-browser voice onboarding",
            fields: ["Agent ID"],
            status: "Not configured",
          },
          {
            name: "Escalation Channel",
            description: "Where bot-stuck cases get posted for human review",
            fields: ["Slack Webhook URL", "Google Chat Webhook URL"],
            status: "Not configured",
          },
        ].map((integration) => (
          <div
            key={integration.name}
            className="rounded-lg border bg-white p-6"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">{integration.name}</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {integration.description}
                </p>
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {integration.status}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {integration.fields.map((field) => (
                <div key={field}>
                  <label className="block text-sm font-medium text-gray-700">
                    {field}
                  </label>
                  <input
                    type="password"
                    placeholder={`Enter ${field.toLowerCase()}`}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    disabled
                  />
                </div>
              ))}
            </div>
            <button
              className="mt-4 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-600"
              disabled
            >
              Save (Coming Soon)
            </button>
          </div>
        ))}

        {/* Outreach Cadence */}
        <div className="rounded-lg border bg-white p-6">
          <h3 className="text-lg font-semibold">Follow-Up Cadence</h3>
          <p className="mt-1 text-sm text-gray-500">
            Configure the escalating outreach sequence for unresponsive clients
          </p>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center gap-3 rounded bg-gray-50 p-2">
              <span className="w-20 text-gray-500">1 hour</span>
              <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                SMS
              </span>
              <span>First reminder</span>
            </div>
            <div className="flex items-center gap-3 rounded bg-gray-50 p-2">
              <span className="w-20 text-gray-500">4 hours</span>
              <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                SMS
              </span>
              <span>Second reminder</span>
            </div>
            <div className="flex items-center gap-3 rounded bg-gray-50 p-2">
              <span className="w-20 text-gray-500">24 hours</span>
              <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                Voice Call
              </span>
              <span>First call attempt</span>
            </div>
            <div className="flex items-center gap-3 rounded bg-gray-50 p-2">
              <span className="w-20 text-gray-500">48 hours</span>
              <span className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
                Email
              </span>
              <span>Email + SMS combo</span>
            </div>
            <div className="flex items-center gap-3 rounded bg-gray-50 p-2">
              <span className="w-20 text-gray-500">72 hours</span>
              <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                Voice Call
              </span>
              <span>Second call attempt</span>
            </div>
            <div className="flex items-center gap-3 rounded bg-gray-50 p-2">
              <span className="w-20 text-gray-500">5 days</span>
              <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                SMS
              </span>
              <span>Urgent reminder</span>
            </div>
            <div className="flex items-center gap-3 rounded bg-gray-50 p-2">
              <span className="w-20 text-gray-500">7 days</span>
              <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                Voice Call
              </span>
              <span>Final call → escalate to human</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
