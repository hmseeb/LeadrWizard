import { createSupabaseServerClient } from "@/lib/supabase-server";
import Link from "next/link";
import { PackageActions } from "./package-actions";

export default async function PackagesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: packages } = await supabase
    .from("service_packages")
    .select(
      `
      *,
      package_services(
        service:service_definitions(id, name, slug)
      )
    `
    )
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">Service Packages</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Bundle services into packages that clients can purchase
          </p>
        </div>
        <Link
          href="/packages/new"
          className="btn-primary"
        >
          Create Package
        </Link>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {packages?.map((pkg) => {
          const services = (pkg.package_services || []) as Array<{
            service: { id: string; name: string; slug: string } | null;
          }>;

          return (
            <div key={pkg.id} className="rounded-xl border border-zinc-800 bg-surface p-5">
              <div className="flex items-start justify-between">
                <h3 className="text-lg font-semibold text-zinc-50">{pkg.name}</h3>
                <div className="flex items-center gap-2">
                  {pkg.price_cents != null && (
                    <span className="text-lg font-bold text-brand-400">
                      ${(pkg.price_cents / 100).toFixed(2)}
                    </span>
                  )}
                  <PackageActions
                    packageId={pkg.id}
                    packageName={pkg.name}
                  />
                </div>
              </div>
              {pkg.description && (
                <p className="mt-2 text-sm text-zinc-400">{pkg.description}</p>
              )}
              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Included Services ({services.length})
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {services.map((ps, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-brand-500/15 px-3 py-1 text-xs font-medium text-brand-400 ring-1 ring-brand-500/20"
                    >
                      {ps.service?.name || "Unknown"}
                    </span>
                  ))}
                  {services.length === 0 && (
                    <span className="text-xs text-zinc-500">
                      No services assigned
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {(!packages || packages.length === 0) && (
          <div className="col-span-2 rounded-xl border border-zinc-800 bg-surface p-8 text-center text-zinc-500">
            No packages created yet.{" "}
            <Link
              href="/packages/new"
              className="text-brand-400 hover:text-brand-300"
            >
              Create your first package
            </Link>.
          </div>
        )}
      </div>
    </div>
  );
}
