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

export async function createService(formData: FormData) {
  const { supabase, orgId } = await getAuthedOrg();

  const name = formData.get("name") as string;
  if (!name || name.trim().length < 2) {
    throw new Error("Service name is required (min 2 characters)");
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const { error } = await supabase.from("service_definitions").insert({
    org_id: orgId,
    name: name.trim(),
    slug,
    description: (formData.get("description") as string)?.trim() || null,
    required_data_fields: JSON.parse(
      (formData.get("required_data_fields") as string) || "[]"
    ),
    setup_steps: JSON.parse(
      (formData.get("setup_steps") as string) || "[]"
    ),
  });

  if (error) {
    if (error.code === "23505") {
      throw new Error("A service with this name already exists");
    }
    throw new Error(error.message);
  }

  revalidatePath("/services");
  redirect("/services");
}

export async function updateService(serviceId: string, formData: FormData) {
  const { supabase } = await getAuthedOrg();

  const name = formData.get("name") as string;
  if (!name || name.trim().length < 2) {
    throw new Error("Service name is required (min 2 characters)");
  }

  const { error } = await supabase
    .from("service_definitions")
    .update({
      name: name.trim(),
      description: (formData.get("description") as string)?.trim() || null,
      required_data_fields: JSON.parse(
        (formData.get("required_data_fields") as string) || "[]"
      ),
      setup_steps: JSON.parse(
        (formData.get("setup_steps") as string) || "[]"
      ),
      updated_at: new Date().toISOString(),
    })
    .eq("id", serviceId);

  if (error) throw new Error(error.message);

  revalidatePath("/services");
  redirect("/services");
}

export async function softDeleteService(serviceId: string) {
  const { supabase } = await getAuthedOrg();

  const { error } = await supabase
    .from("service_definitions")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", serviceId);

  if (error) throw new Error(error.message);

  revalidatePath("/services");
}
