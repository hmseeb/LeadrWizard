import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function PackagesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: packages } = await supabase
    .from("service_packages")
    .select(
      `
      *,
      package_services(
        service:service_definitions(name, slug)
      )
    `
    )
    .order("created_at", { ascending: true });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Service Packages</h1>
          <p className="mt-1 text-gray-500">
            Bundle services into packages that clients can purchase
          </p>
        </div>
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Create Package
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {packages?.map((pkg) => {
          const services = (pkg.package_services || []) as Array<{
            service: { name: string; slug: string } | null;
          }>;

          return (
            <div key={pkg.id} className="rounded-lg border bg-white p-6">
              <div className="flex items-start justify-between">
                <h3 className="text-lg font-semibold">{pkg.name}</h3>
                {pkg.price_cents && (
                  <span className="text-lg font-bold text-brand-600">
                    ${(pkg.price_cents / 100).toFixed(2)}
                  </span>
                )}
              </div>
              {pkg.description && (
                <p className="mt-2 text-sm text-gray-500">{pkg.description}</p>
              )}
              <div className="mt-4">
                <p className="text-xs font-medium uppercase text-gray-400">
                  Included Services
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {services.map((ps, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
                    >
                      {ps.service?.name || "Unknown"}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        {(!packages || packages.length === 0) && (
          <div className="col-span-2 rounded-lg border bg-white p-8 text-center text-gray-400">
            No packages created yet.
          </div>
        )}
      </div>
    </div>
  );
}
