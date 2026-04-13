import { createSupabaseServiceClient } from "@/lib/supabase-server";
import { ProvisionClientForm } from "./provision-client-form";
import { startClientProvision } from "../actions";

export default async function ProvisionClientPage() {
  const supabase = createSupabaseServiceClient();

  const { data: packages } = await supabase
    .from("service_packages")
    .select("id, name, description, price_cents, price_interval")
    .eq("is_active", true)
    .order("name");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">
        Provision Client
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Create a client without a payment webhook. The client will receive the
        onboarding link via SMS just like a paid signup. Use this for comped
        accounts, out-of-band payments, or testing.
      </p>

      <div className="mt-6">
        <ProvisionClientForm
          packages={
            (packages || []) as {
              id: string;
              name: string;
              description: string | null;
              price_cents: number | null;
              price_interval: string | null;
            }[]
          }
          action={startClientProvision}
        />
      </div>
    </div>
  );
}
