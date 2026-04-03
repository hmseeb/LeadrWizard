import { createSupabaseServiceClient } from "@/lib/supabase-server";
import { NewClientForm } from "@/components/new-client-form";
import { startManualOnboarding } from "../actions";

export default async function NewClientPage() {
  const supabase = createSupabaseServiceClient();

  const { data: packages } = await supabase
    .from("service_packages")
    .select("id, name, description")
    .eq("is_active", true)
    .order("name");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">
        New Client
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Register a client for A2P texting. Fill in their business details and select message types — the registration is submitted directly to Twilio on their behalf.
      </p>

      <div className="mt-6">
        <NewClientForm
          packages={(packages || []) as { id: string; name: string; description: string | null }[]}
          action={startManualOnboarding}
        />
      </div>
    </div>
  );
}
