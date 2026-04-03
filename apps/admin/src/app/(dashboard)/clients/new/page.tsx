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
        Start an onboarding for a new client. They&apos;ll receive an SMS with a link to provide their details.
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
