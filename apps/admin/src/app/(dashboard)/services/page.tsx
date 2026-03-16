import { createSupabaseServiceClient } from "@/lib/supabase-server";
import Link from "next/link";
import type { DataFieldDefinition } from "@leadrwizard/shared/types";
import { ServiceActions } from "./service-actions";

export default async function ServicesPage() {
  const supabase = createSupabaseServiceClient();
  const { data: services } = await supabase
    .from("service_definitions")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">Service Definitions</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Define what services you offer and what data each requires for
            onboarding
          </p>
        </div>
        <Link
          href="/services/new"
          className="btn-primary"
        >
          Add Service
        </Link>
      </div>

      <div className="mt-6 grid gap-4">
        {services?.map((service) => {
          const fields = (service.required_data_fields ||
            []) as DataFieldDefinition[];
          const requiredCount = fields.filter((f) => f.required).length;
          const steps = (service.setup_steps || []) as Array<{ label: string }>;

          return (
            <div
              key={service.id}
              className="rounded-xl border border-zinc-800 bg-surface p-5"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-zinc-50">{service.name}</h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    {service.description}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="badge-success">
                    Active
                  </span>
                  <ServiceActions serviceId={service.id} serviceName={service.name} />
                </div>
              </div>
              <div className="mt-4 flex gap-4 text-sm text-zinc-500">
                <span>{fields.length} data fields</span>
                <span>{requiredCount} required</span>
                <span>{steps.length} setup steps</span>
                <span>Slug: {service.slug}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {fields.map((field) => (
                  <span
                    key={field.key}
                    className={`rounded-md px-2 py-0.5 text-xs ${
                      field.required
                        ? "bg-brand-500/15 text-brand-400"
                        : "bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    {field.label}
                    {field.required && " *"}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        {(!services || services.length === 0) && (
          <div className="rounded-xl border border-zinc-800 bg-surface p-8 text-center text-zinc-500">
            No services defined yet.{" "}
            <Link href="/services/new" className="text-brand-400 hover:text-brand-300">
              Add your first service
            </Link>{" "}
            to get started.
          </div>
        )}
      </div>
    </div>
  );
}
