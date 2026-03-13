"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

/**
 * New organization setup page.
 * Shown after signup when user doesn't belong to any org.
 * Creates the org, adds user as owner, redirects to dashboard.
 */
export default function OrgSetupPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    if (!orgName.trim()) return;

    setLoading(true);
    setError("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      // Create organization via API
      const response = await fetch("/api/org/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: orgName.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create organization");
      }

      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="rounded-xl bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900">
            Set Up Your Organization
          </h1>
          <p className="mt-2 text-gray-500">
            Create your organization to start onboarding clients with AI.
          </p>

          <form onSubmit={handleSetup} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="orgName"
                className="block text-sm font-medium text-gray-700"
              >
                Organization Name
              </label>
              <input
                id="orgName"
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g., Acme Digital Marketing"
                className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                required
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !orgName.trim()}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Organization"}
            </button>
          </form>

          <div className="mt-6 rounded-lg bg-gray-50 p-4">
            <h3 className="text-sm font-medium text-gray-700">
              What happens next:
            </h3>
            <ul className="mt-2 space-y-1 text-sm text-gray-500">
              <li>1. Configure your services and packages</li>
              <li>2. Connect your integrations (GHL, Twilio, etc.)</li>
              <li>3. Start accepting payments and onboarding clients</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
