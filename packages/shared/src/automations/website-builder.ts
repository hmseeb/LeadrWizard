import type { ServiceTask, ServiceTaskStatus, NicheTemplate } from "../types";
import type { SupabaseClient } from "../supabase/client";

/**
 * Data collected during onboarding for website generation.
 */
export interface WebsiteBuildData {
  business_name: string;
  niche: string;
  tagline?: string;
  primary_color?: string;
  logo_url?: string;
  phone: string;
  email: string;
  address?: string;
  services_offered?: string[];
  about_text?: string;
}

/**
 * Finds a matching niche template or flags that a new one is needed.
 */
export async function findNicheTemplate(
  supabase: SupabaseClient,
  orgId: string,
  niche: string
): Promise<NicheTemplate | null> {
  const { data } = await supabase
    .from("niche_templates")
    .select()
    .eq("org_id", orgId)
    .ilike("niche_name", `%${niche}%`)
    .limit(1)
    .single();

  return (data as NicheTemplate) || null;
}

/**
 * Initiates the website generation process.
 * Uses AI to generate from niche template + client data, then deploys to Vercel.
 *
 * TODO: Wire up actual AI generation + Vercel deployment in Session 3.
 */
export async function initiateWebsiteBuild(
  supabase: SupabaseClient,
  clientServiceId: string,
  data: WebsiteBuildData,
  template: NicheTemplate | null
): Promise<ServiceTask> {
  const { data: task, error } = await supabase
    .from("service_tasks")
    .insert({
      client_service_id: clientServiceId,
      task_type: "website_generation",
      status: "pending" as ServiceTaskStatus,
      external_ref: null, // Will be Vercel deployment URL
      next_check_at: null,
      attempt_count: 0,
      last_result: {
        build_data: data,
        template_id: template?.id || null,
        needs_new_template: !template,
      },
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create website task: ${error.message}`);

  // TODO: Actual implementation:
  // 1. If no template exists for niche, flag for manual template creation
  // 2. Use AI (Claude) to customize template with client data
  // 3. Deploy to Vercel with custom subdomain (client-slug.leadrwizard.com)
  // 4. Send preview link to client
  // 5. Track approval + up to 3 adjustments

  return task as ServiceTask;
}
