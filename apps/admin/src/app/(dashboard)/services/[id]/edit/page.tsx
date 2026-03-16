import { createSupabaseServiceClient } from "@/lib/supabase-server";
import { notFound } from "next/navigation";
import { ServiceForm } from "@/components/service-form";
import { updateService } from "../../actions";
import type { ServiceDefinition } from "@leadrwizard/shared/types";

export default async function EditServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createSupabaseServiceClient();
  const { data: service } = await supabase
    .from("service_definitions")
    .select("*")
    .eq("id", id)
    .single();

  if (!service) notFound();

  const boundUpdateService = updateService.bind(null, id);

  return (
    <div>
      <h1 className="text-2xl font-bold">Edit Service</h1>
      <p className="mt-1 text-gray-500">
        Update the service definition and its required data fields.
      </p>
      <div className="mt-6">
        <ServiceForm
          mode="edit"
          initialData={service as ServiceDefinition}
          action={boundUpdateService}
        />
      </div>
    </div>
  );
}
