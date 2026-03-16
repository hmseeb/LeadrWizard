"use server";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase-server";
import { getUserOrg } from "@leadrwizard/shared/tenant";
import { revalidatePath } from "next/cache";

async function getAuthedOrg() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const serviceClient = createSupabaseServiceClient();
  const orgData = await getUserOrg(serviceClient, user.id);
  if (!orgData || !["owner", "admin"].includes(orgData.role)) {
    throw new Error("Insufficient permissions");
  }

  return { supabase: serviceClient, orgId: orgData.org.id };
}

/**
 * Retry a DLQ entry: reset the original service_task for re-processing
 * and mark the DLQ entry as retried.
 */
export async function retryDLQEntry(dlqId: string) {
  const { supabase } = await getAuthedOrg();

  // Get the DLQ entry
  const { data: dlqEntry, error: fetchError } = await supabase
    .from("dead_letter_queue")
    .select("*")
    .eq("id", dlqId)
    .single();

  if (fetchError || !dlqEntry) {
    throw new Error("DLQ entry not found");
  }

  const entry = dlqEntry as {
    id: string;
    original_table: string;
    original_id: string;
    retried_at: string | null;
  };

  if (entry.retried_at) {
    throw new Error("This entry has already been retried");
  }

  // Reset the original service_task for re-processing
  if (entry.original_table === "service_tasks") {
    const { error: updateError } = await supabase
      .from("service_tasks")
      .update({
        status: "in_progress",
        attempt_count: 0,
        next_check_at: new Date().toISOString(),
        last_result: { retried_from_dlq: true, dlq_entry_id: entry.id },
        updated_at: new Date().toISOString(),
      })
      .eq("id", entry.original_id);

    if (updateError) throw new Error(updateError.message);
  }

  // Mark DLQ entry as retried
  const { error: dlqError } = await supabase
    .from("dead_letter_queue")
    .update({ retried_at: new Date().toISOString() })
    .eq("id", dlqId);

  if (dlqError) throw new Error(dlqError.message);

  revalidatePath("/dead-letter-queue");
}

/**
 * Dismiss a DLQ entry: mark it as acknowledged without retrying.
 */
export async function dismissDLQEntry(dlqId: string) {
  const { supabase } = await getAuthedOrg();

  const { error } = await supabase
    .from("dead_letter_queue")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", dlqId);

  if (error) throw new Error(error.message);

  revalidatePath("/dead-letter-queue");
}
