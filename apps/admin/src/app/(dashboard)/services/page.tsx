import { createSupabaseServerClient } from "@/lib/supabase-server";
import Link from "next/link";
import type { DataFieldDefinition } from "@leadrwizard/shared/types";
import { ServiceActions } from "./service-actions";

export default async function ServicesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: services } = await supabase
    .from("service_definitions")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Service Definitions</h1>
          <p className="mt-1 text-gray-500">
            Define what services you offer and what data each requires for
            onboarding
          </p>
        </div>
        <Link
          href="/services/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
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
              className="rounded-lg border bg-white p-6"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold">{service.name}</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {service.description}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    Active
                  </span>
                  <ServiceActions serviceId={service.id} serviceName={service.name} />
                </div>
              </div>
              <div className="mt-4 flex gap-4 text-sm text-gray-500">
                <span>{fields.length} data fields</span>
                <span>{requiredCount} required</span>
                <span>{steps.length} setup steps</span>
                <span>Slug: {service.slug}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {fields.map((field) => (
                  <span
                    key={field.key}
                    className={`rounded px-2 py-0.5 text-xs ${
                      field.required
                        ? "bg-brand-50 text-brand-700"
                        : "bg-gray-100 text-gray-600"
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
          <div className="rounded-lg border bg-white p-8 text-center text-gray-400">
            No services defined yet.{" "}
            <Link href="/services/new" className="text-brand-600 hover:text-brand-700">
              Add your first service
            </Link>{" "}
            to get started.
          </div>
        )}
      </div>
    </div>
  );
}
