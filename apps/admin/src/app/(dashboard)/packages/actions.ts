"use server";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function getAuthedOrg() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const serviceClient = createSupabaseServiceClient();
  const orgData = await getUserOrg(serviceClient, user.id);
  if (!orgData || !["owner", "admin"].includes(orgData.role)) {
    throw new Error("Insufficient permissions");
  }

  return { supabase: serviceClient, orgId: orgData.org.id };
}

export async function createPackage(formData: FormData) {
  const { supabase, orgId } = await getAuthedOrg();

  const name = formData.get("name") as string;
  if (!name || name.trim().length < 2) {
    throw new Error("Package name is required (min 2 characters)");
  }

  const priceCentsRaw = formData.get("price_cents") as string;
  const priceCents = priceCentsRaw ? parseInt(priceCentsRaw, 10) : null;
  if (priceCents !== null && (isNaN(priceCents) || priceCents < 0)) {
    throw new Error("Price must be a positive number");
  }

  // 1. Insert the package
  const { data: pkg, error: pkgError } = await supabase
    .from("service_packages")
    .insert({
      org_id: orgId,
      name: name.trim(),
      description: (formData.get("description") as string)?.trim() || null,
      price_cents: priceCents,
    })
    .select("id")
    .single();

  if (pkgError) throw new Error(pkgError.message);

  // 2. Insert service assignments
  const serviceIds = JSON.parse(
    (formData.get("service_ids") as string) || "[]"
  ) as string[];

  if (serviceIds.length > 0) {
    const { error: svcError } = await supabase
      .from("package_services")
      .insert(
        serviceIds.map((sid) => ({
          package_id: pkg.id,
          service_id: sid,
        }))
      );

    if (svcError) throw new Error(svcError.message);
  }

  revalidatePath("/packages");
  redirect("/packages");
}

export async function updatePackage(packageId: string, formData: FormData) {
  const { supabase } = await getAuthedOrg();

  const name = formData.get("name") as string;
  if (!name || name.trim().length < 2) {
    throw new Error("Package name is required (min 2 characters)");
  }

  const priceCentsRaw = formData.get("price_cents") as string;
  const priceCents = priceCentsRaw ? parseInt(priceCentsRaw, 10) : null;
  if (priceCents !== null && (isNaN(priceCents) || priceCents < 0)) {
    throw new Error("Price must be a positive number");
  }

  // 1. Update the package
  const { error: pkgError } = await supabase
    .from("service_packages")
    .update({
      name: name.trim(),
      description: (formData.get("description") as string)?.trim() || null,
      price_cents: priceCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packageId);

  if (pkgError) throw new Error(pkgError.message);

  // 2. Replace service assignments: delete old, insert new
  const { error: delError } = await supabase
    .from("package_services")
    .delete()
    .eq("package_id", packageId);

  if (delError) throw new Error(delError.message);

  const serviceIds = JSON.parse(
    (formData.get("service_ids") as string) || "[]"
  ) as string[];

  if (serviceIds.length > 0) {
    const { error: svcError } = await supabase
      .from("package_services")
      .insert(
        serviceIds.map((sid) => ({
          package_id: packageId,
          service_id: sid,
        }))
      );

    if (svcError) throw new Error(svcError.message);
  }

  revalidatePath("/packages");
  redirect("/packages");
}

export async function deletePackage(packageId: string) {
  const { supabase } = await getAuthedOrg();

  // Hard delete. package_services rows are cascade-deleted by FK.
  const { error } = await supabase
    .from("service_packages")
    .delete()
    .eq("id", packageId);

  if (error) throw new Error(error.message);

  revalidatePath("/packages");
}
