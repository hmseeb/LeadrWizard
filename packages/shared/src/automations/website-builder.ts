import type { ServiceTask, ServiceTaskStatus, NicheTemplate } from "../types";
import type { SupabaseClient } from "../supabase/client";

/**
 * AI website builder — generates client websites from niche templates.
 *
 * Flow:
 * 1. Find matching niche template (or flag for manual template creation)
 * 2. Use Claude to customize template HTML with client data
 * 3. Deploy to Vercel with custom subdomain (client-slug.leadrwizard.com)
 * 4. Send preview link to client for approval
 * 5. Allow up to 3 adjustments, then mark as delivered
 *
 * Vercel API: https://vercel.com/docs/rest-api
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

interface VercelConfig {
  token: string;
  teamId?: string;
}

function getVercelConfig(): VercelConfig {
  const token = process.env.VERCEL_TOKEN;

  if (!token) {
    throw new Error("Missing Vercel config: VERCEL_TOKEN");
  }

  return { token, teamId: process.env.VERCEL_TEAM_ID };
}

/**
 * Finds a matching niche template or flags that a new one is needed.
 */
export async function findNicheTemplate(
  supabase: SupabaseClient,
  orgId: string,
  niche: string
): Promise<NicheTemplate | null> {
  // Try exact match first
  const { data: exact } = await supabase
    .from("niche_templates")
    .select()
    .eq("org_id", orgId)
    .ilike("niche_name", niche)
    .limit(1)
    .single();

  if (exact) return exact as NicheTemplate;

  // Try fuzzy match
  const { data: fuzzy } = await supabase
    .from("niche_templates")
    .select()
    .eq("org_id", orgId)
    .ilike("niche_name", `%${niche}%`)
    .limit(1)
    .single();

  return (fuzzy as NicheTemplate) || null;
}

/**
 * Uses Claude to generate customized website HTML from a template + client data.
 */
async function generateWebsiteContent(
  template: NicheTemplate,
  data: WebsiteBuildData
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const templateHtml = (template.template_data as Record<string, string>)?.html || "";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `You are a website builder. Customize this HTML template for a ${data.niche} business.

TEMPLATE HTML:
${templateHtml}

BUSINESS DATA:
- Business Name: ${data.business_name}
- Niche: ${data.niche}
- Tagline: ${data.tagline || "Professional " + data.niche + " services"}
- Phone: ${data.phone}
- Email: ${data.email}
- Address: ${data.address || ""}
- Services: ${data.services_offered?.join(", ") || ""}
- About: ${data.about_text || ""}
- Primary Color: ${data.primary_color || "#6366f1"}
- Logo URL: ${data.logo_url || ""}

INSTRUCTIONS:
1. Replace all placeholder content with the business data above
2. Keep the layout and structure from the template
3. Use the primary color for buttons and accents
4. If a logo URL is provided, use it; otherwise use the business name as text
5. Make the content professional and appropriate for the niche
6. Return ONLY the complete HTML document — no markdown, no explanation`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const result = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const htmlContent = result.content[0]?.text || "";

  // Strip markdown code fences if present
  return htmlContent
    .replace(/^```html?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
}

/**
 * Deploys a static HTML site to Vercel using their API.
 * Creates a project if it doesn't exist, then deploys the files.
 */
async function deployToVercel(
  slug: string,
  htmlContent: string
): Promise<{ url: string; deploymentId: string }> {
  const config = getVercelConfig();

  const teamQuery = config.teamId ? `?teamId=${config.teamId}` : "";

  // Create deployment using Vercel's file-based deployment API
  const deployResponse = await fetch(
    `https://api.vercel.com/v13/deployments${teamQuery}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: slug,
        files: [
          {
            file: "index.html",
            data: Buffer.from(htmlContent).toString("base64"),
            encoding: "base64",
          },
          {
            file: "404.html",
            data: Buffer.from(htmlContent).toString("base64"),
            encoding: "base64",
          },
        ],
        projectSettings: {
          framework: null,
        },
        target: "production",
      }),
    }
  );

  if (!deployResponse.ok) {
    const errorBody = await deployResponse.text();
    throw new Error(`Vercel deployment failed (${deployResponse.status}): ${errorBody}`);
  }

  const deployment = (await deployResponse.json()) as {
    id: string;
    url: string;
    readyState: string;
  };

  return {
    url: `https://${deployment.url}`,
    deploymentId: deployment.id,
  };
}

/**
 * Sets up a custom subdomain for a deployed site.
 * Maps client-slug.leadrwizard.com to the Vercel deployment.
 */
async function setupCustomDomain(
  projectName: string,
  clientSlug: string
): Promise<string> {
  const config = getVercelConfig();
  const teamQuery = config.teamId ? `?teamId=${config.teamId}` : "";
  const domain = `${clientSlug}.leadrwizard.com`;

  await fetch(
    `https://api.vercel.com/v10/projects/${projectName}/domains${teamQuery}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: domain }),
    }
  );

  return domain;
}

/**
 * Generates a URL-safe slug from a business name.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 63); // Vercel project name limit
}

/**
 * Initiates the website generation and deployment process.
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
      status: "in_progress" as ServiceTaskStatus,
      external_ref: null,
      next_check_at: null,
      attempt_count: 1,
      last_result: {
        build_data: data,
        template_id: template?.id || null,
        needs_new_template: !template,
        step: "generating",
        adjustments_remaining: 3,
      },
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create website task: ${error.message}`);

  const taskId = (task as ServiceTask).id;

  if (!template) {
    // No template for this niche — create an escalation for manual template creation
    await supabase
      .from("service_tasks")
      .update({
        status: "waiting_external" as ServiceTaskStatus,
        last_result: {
          build_data: data,
          step: "needs_template",
          message: `No template found for niche "${data.niche}". Manual template creation required.`,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    // Get client info for escalation
    const { data: clientService } = await supabase
      .from("client_services")
      .select("client_id")
      .eq("id", clientServiceId)
      .single();

    if (clientService) {
      // Resolve org_id for escalation
      const { data: wsClient } = await supabase
        .from("clients")
        .select("org_id")
        .eq("id", (clientService as Record<string, string>).client_id)
        .single();

      await supabase.from("escalations").insert({
        client_id: (clientService as Record<string, string>).client_id,
        org_id: wsClient?.org_id,
        reason: `New niche template needed: "${data.niche}" for ${data.business_name}`,
        context: { build_data: data, task_id: taskId },
        channel: "system" as const,
        status: "open" as const,
      });
    }

    return { ...(task as ServiceTask), status: "waiting_external" };
  }

  try {
    // Step 1: Generate customized HTML with Claude
    const htmlContent = await generateWebsiteContent(template, data);

    // Step 2: Deploy to Vercel
    const slug = slugify(data.business_name);
    const deployment = await deployToVercel(slug, htmlContent);

    // Step 3: Set up custom domain
    let customDomain: string | null = null;
    try {
      customDomain = await setupCustomDomain(slug, slug);
    } catch {
      // Custom domain setup is optional — deployment URL still works
    }

    const previewUrl = customDomain
      ? `https://${customDomain}`
      : deployment.url;

    // Update task with deployment info
    await supabase
      .from("service_tasks")
      .update({
        status: "waiting_external" as ServiceTaskStatus,
        external_ref: deployment.deploymentId,
        last_result: {
          build_data: data,
          template_id: template.id,
          step: "preview_sent",
          deployment_id: deployment.deploymentId,
          deployment_url: deployment.url,
          custom_domain: customDomain,
          preview_url: previewUrl,
          adjustments_remaining: 3,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    return {
      ...(task as ServiceTask),
      status: "waiting_external",
      external_ref: deployment.deploymentId,
    };
  } catch (err) {
    await supabase
      .from("service_tasks")
      .update({
        status: "failed" as ServiceTaskStatus,
        last_result: {
          build_data: data,
          template_id: template.id,
          error: err instanceof Error ? err.message : String(err),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    throw err;
  }
}

/**
 * Handles a website adjustment request from the client.
 * Regenerates the site with the requested changes (max 3 adjustments).
 */
export async function handleWebsiteAdjustment(
  supabase: SupabaseClient,
  task: ServiceTask,
  adjustmentRequest: string
): Promise<{ success: boolean; message: string; preview_url?: string }> {
  const lastResult = task.last_result as Record<string, unknown> | null;
  if (!lastResult) return { success: false, message: "No build data found" };

  const adjustmentsRemaining = (lastResult.adjustments_remaining as number) || 0;

  if (adjustmentsRemaining <= 0) {
    return {
      success: false,
      message: "Maximum adjustments (3) reached. The website has been finalized.",
    };
  }

  const buildData = lastResult.build_data as WebsiteBuildData;
  const templateId = lastResult.template_id as string;

  // Get the template
  const { data: template } = await supabase
    .from("niche_templates")
    .select()
    .eq("id", templateId)
    .single();

  if (!template) {
    return { success: false, message: "Template not found" };
  }

  try {
    // Regenerate with adjustment instructions
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

    const currentHtml = (lastResult.current_html as string) || "";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        messages: [
          {
            role: "user",
            content: `You are a website builder. Modify this website based on the client's feedback.

CURRENT WEBSITE HTML:
${currentHtml}

CLIENT FEEDBACK:
${adjustmentRequest}

BUSINESS DATA:
- Business Name: ${buildData.business_name}
- Niche: ${buildData.niche}
- Phone: ${buildData.phone}
- Email: ${buildData.email}

INSTRUCTIONS:
1. Apply the requested changes while maintaining overall design quality
2. Only change what was requested — don't redesign the whole site
3. Return ONLY the complete HTML document — no markdown, no explanation`,
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`Claude API error: ${response.status}`);

    const result = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const newHtml = result.content[0]?.text
      ?.replace(/^```html?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim() || "";

    // Redeploy
    const slug = slugify(buildData.business_name);
    const deployment = await deployToVercel(slug, newHtml);

    const previewUrl = (lastResult.custom_domain as string)
      ? `https://${lastResult.custom_domain}`
      : deployment.url;

    // Update task
    await supabase
      .from("service_tasks")
      .update({
        external_ref: deployment.deploymentId,
        last_result: {
          ...lastResult,
          step: "adjustment_applied",
          deployment_id: deployment.deploymentId,
          deployment_url: deployment.url,
          preview_url: previewUrl,
          current_html: newHtml,
          adjustments_remaining: adjustmentsRemaining - 1,
          adjustment_history: [
            ...((lastResult.adjustment_history as string[]) || []),
            adjustmentRequest,
          ],
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);

    return {
      success: true,
      message: `Adjustment applied. ${adjustmentsRemaining - 1} adjustments remaining.`,
      preview_url: previewUrl,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Adjustment failed",
    };
  }
}

/**
 * Approves the website and marks the service as delivered.
 */
export async function approveWebsite(
  supabase: SupabaseClient,
  task: ServiceTask
): Promise<void> {
  await supabase
    .from("service_tasks")
    .update({
      status: "completed" as ServiceTaskStatus,
      last_result: {
        ...(task.last_result as Record<string, unknown>),
        step: "approved",
        approved_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id);

  await supabase
    .from("client_services")
    .update({
      status: "delivered",
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.client_service_id);
}
