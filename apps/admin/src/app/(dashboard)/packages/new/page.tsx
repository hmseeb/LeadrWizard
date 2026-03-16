import { createSupabaseServiceClient } from "@/lib/supabase-server";
import { PackageForm } from "@/components/package-form";
import { createPackage } from "../actions";

export default async function NewPackagePage() {
  const supabase = createSupabaseServiceClient();

  // Fetch active services for the assignment checklist
  const { data: services } = await supabase
    .from("service_definitions")
    .select("id, name, slug")
    .eq("is_active", true)
    .order("name", { ascending: true });

  return (
    <div>
      <h1 className="text-2xl font-bold">Create Package</h1>
      <p className="mt-1 text-gray-500">
        Bundle services together into a package that clients can purchase.
      </p>
      <div className="mt-6">
        <PackageForm
          mode="create"
          availableServices={services || []}
          action={createPackage}
        />
      </div>
    </div>
  );
}
