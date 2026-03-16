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

export async function createTemplate(formData: FormData) {
  const { supabase, orgId } = await getAuthedOrg();

  const name = formData.get("name") as string;
  if (!name || name.trim().length < 2) {
    throw new Error("Template name is required (min 2 characters)");
  }

  const channel = formData.get("channel") as string;
  if (!["sms", "email", "voice"].includes(channel)) {
    throw new Error("Invalid channel. Must be sms, email, or voice");
  }

  const body = formData.get("body") as string;
  if (!body || body.trim().length < 5) {
    throw new Error("Template body is required (min 5 characters)");
  }

  const subject = (formData.get("subject") as string)?.trim() || null;
  if (channel === "email" && !subject) {
    throw new Error("Email templates require a subject line");
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const { error } = await supabase.from("message_templates").insert({
    org_id: orgId,
    name: name.trim(),
    slug,
    channel,
    subject,
    body: body.trim(),
  });

  if (error) {
    if (error.code === "23505") {
      throw new Error("A template with this name already exists");
    }
    throw new Error(error.message);
  }

  revalidatePath("/templates");
  redirect("/templates");
}

export async function updateTemplate(templateId: string, formData: FormData) {
  const { supabase } = await getAuthedOrg();

  const name = formData.get("name") as string;
  if (!name || name.trim().length < 2) {
    throw new Error("Template name is required (min 2 characters)");
  }

  const channel = formData.get("channel") as string;
  if (!["sms", "email", "voice"].includes(channel)) {
    throw new Error("Invalid channel. Must be sms, email, or voice");
  }

  const body = formData.get("body") as string;
  if (!body || body.trim().length < 5) {
    throw new Error("Template body is required (min 5 characters)");
  }

  const subject = (formData.get("subject") as string)?.trim() || null;
  if (channel === "email" && !subject) {
    throw new Error("Email templates require a subject line");
  }

  const { error } = await supabase
    .from("message_templates")
    .update({
      name: name.trim(),
      channel,
      subject,
      body: body.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", templateId);

  if (error) throw new Error(error.message);

  revalidatePath("/templates");
  redirect("/templates");
}

export async function deleteTemplate(templateId: string) {
  const { supabase } = await getAuthedOrg();

  const { error } = await supabase
    .from("message_templates")
    .delete()
    .eq("id", templateId);

  if (error) throw new Error(error.message);

  revalidatePath("/templates");
}
