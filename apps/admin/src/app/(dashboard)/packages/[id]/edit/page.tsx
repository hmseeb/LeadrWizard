import { createSupabaseServiceClient } from "@/lib/supabase-server";
import { notFound } from "next/navigation";
import { PackageForm } from "@/components/package-form";
import { updatePackage } from "../../actions";

export default async function EditPackagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createSupabaseServiceClient();

  // Fetch package and its current service assignments in parallel
  const [
    { data: pkg },
    { data: packageServices },
    { data: services },
  ] = await Promise.all([
    supabase
      .from("service_packages")
      .select("*")
      .eq("id", id)
      .single(),
    supabase
      .from("package_services")
      .select("service_id")
      .eq("package_id", id),
    supabase
      .from("service_definitions")
      .select("id, name, slug")
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  if (!pkg) notFound();

  const currentServiceIds = (packageServices || []).map(
    (ps) => ps.service_id as string
  );

  const boundUpdatePackage = updatePackage.bind(null, id);

  return (
    <div>
      <h1 className="text-2xl font-bold">Edit Package</h1>
      <p className="mt-1 text-gray-500">
        Update the package details and assigned services.
      </p>
      <div className="mt-6">
        <PackageForm
          mode="edit"
          initialData={{
            name: pkg.name as string,
            description: pkg.description as string | null,
            price_cents: pkg.price_cents as number | null,
            price_interval:
              (pkg.price_interval as "one_time" | "monthly" | "yearly") ||
              "one_time",
          }}
          initialServiceIds={currentServiceIds}
          availableServices={services || []}
          action={boundUpdatePackage}
        />
      </div>
    </div>
  );
}
