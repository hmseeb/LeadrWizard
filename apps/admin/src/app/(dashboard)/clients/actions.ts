"use server";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { handlePaymentWebhook } from "@leadrwizard/shared/automations";
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

export async function startManualOnboarding(formData: FormData) {
  const { supabase, orgId } = await getAuthedOrg();

  const name = formData.get("customer_name") as string;
  const email = formData.get("customer_email") as string;
  const phone = formData.get("customer_phone") as string;
  const businessName = formData.get("business_name") as string;
  const packageId = formData.get("package_id") as string;

  if (!name || name.trim().length < 2) {
    throw new Error("Client name is required");
  }
  if (!email || !email.includes("@")) {
    throw new Error("Valid email is required");
  }
  if (!packageId) {
    throw new Error("Please select a package");
  }

  const paymentRef = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await handlePaymentWebhook(supabase, orgId, {
    customer_name: name.trim(),
    customer_email: email.trim(),
    customer_phone: phone?.trim() || undefined,
    business_name: businessName?.trim() || undefined,
    package_id: packageId,
    payment_ref: paymentRef,
    metadata: { source: "manual_onboarding" },
  });

  revalidatePath("/clients");
  revalidatePath("/onboardings");
  revalidatePath("/dashboard");
  redirect("/clients");
}
