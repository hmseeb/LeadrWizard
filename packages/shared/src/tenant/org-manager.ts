import type { Organization, OrgMember, OrgCredentials } from "../types";
import type { SupabaseClient } from "../supabase/client";
import { decrypt } from "../crypto";

/**
 * Multi-tenant organization management.
 * Handles org creation, member management, and tenant isolation.
 */

export interface CreateOrgParams {
  name: string;
  ownerUserId: string;
  ownerEmail: string;
}

export interface InviteMemberParams {
  orgId: string;
  email: string;
  role: "admin" | "member";
  invitedBy: string;
}

/**
 * Creates a new organization and sets the creator as owner.
 */
export async function createOrganization(
  supabase: SupabaseClient,
  params: CreateOrgParams
): Promise<{ org: Organization; membership: OrgMember }> {
  const slug = params.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);

  // Check for slug collision
  const { data: existing } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();

  const finalSlug = existing
    ? `${slug}-${Date.now().toString(36)}`
    : slug;

  // Create org
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({
      name: params.name,
      slug: finalSlug,
    })
    .select()
    .single();

  if (orgError) throw new Error(`Failed to create org: ${orgError.message}`);

  // Add creator as owner
  const { data: membership, error: memberError } = await supabase
    .from("org_members")
    .insert({
      org_id: org.id,
      user_id: params.ownerUserId,
      role: "owner",
    })
    .select()
    .single();

  if (memberError) throw new Error(`Failed to add owner: ${memberError.message}`);

  return {
    org: org as Organization,
    membership: membership as OrgMember,
  };
}

/**
 * Gets the user's organization. Returns null if they don't belong to one.
 */
export async function getUserOrg(
  supabase: SupabaseClient,
  userId: string
): Promise<{ org: Organization; role: string } | null> {
  const { data: membership } = await supabase
    .from("org_members")
    .select(`
      role,
      org:organizations(*)
    `)
    .eq("user_id", userId)
    .limit(1)
    .single();

  if (!membership) return null;

  return {
    org: (membership as Record<string, unknown>).org as Organization,
    role: membership.role as string,
  };
}

/**
 * Invites a team member to the organization via email.
 * Generates a unique invite token that can be used to accept the invitation.
 */
export async function inviteTeamMember(
  supabase: SupabaseClient,
  params: InviteMemberParams
): Promise<{ token: string; inviteId: string }> {
  // Check if already a member
  const { data: existingUser } = await supabase
    .from("org_members")
    .select("id")
    .eq("org_id", params.orgId)
    .limit(1);

  // Check if email already has a pending invite
  const { data: existingInvite } = await supabase
    .from("org_invitations")
    .select("id")
    .eq("org_id", params.orgId)
    .eq("email", params.email)
    .is("accepted_at", null)
    .single();

  if (existingInvite) {
    throw new Error("An invitation has already been sent to this email");
  }

  // Generate a random invite token
  const token = crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "");

  const { data: invite, error } = await supabase
    .from("org_invitations")
    .insert({
      org_id: params.orgId,
      email: params.email,
      role: params.role,
      invited_by: params.invitedBy,
      token,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create invitation: ${error.message}`);

  return {
    token,
    inviteId: (invite as Record<string, string>).id,
  };
}

/**
 * Accepts an organization invitation.
 */
export async function acceptInvitation(
  supabase: SupabaseClient,
  token: string,
  userId: string
): Promise<{ orgId: string; role: string }> {
  // Find the invitation
  const { data: invite, error } = await supabase
    .from("org_invitations")
    .select("*")
    .eq("token", token)
    .is("accepted_at", null)
    .single();

  if (error || !invite) {
    throw new Error("Invalid or expired invitation");
  }

  // Check if expired
  if (new Date(invite.expires_at) < new Date()) {
    throw new Error("This invitation has expired");
  }

  // Add user as member
  await supabase.from("org_members").insert({
    org_id: invite.org_id,
    user_id: userId,
    role: invite.role,
  });

  // Mark invitation as accepted
  await supabase
    .from("org_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  return {
    orgId: invite.org_id as string,
    role: invite.role as string,
  };
}

/**
 * Lists all members of an organization.
 */
export async function listOrgMembers(
  supabase: SupabaseClient,
  orgId: string
): Promise<Array<OrgMember & { email?: string }>> {
  const { data: members } = await supabase
    .from("org_members")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  return (members || []) as Array<OrgMember & { email?: string }>;
}

/**
 * Removes a member from an organization.
 */
export async function removeMember(
  supabase: SupabaseClient,
  orgId: string,
  memberId: string
): Promise<void> {
  // Prevent removing the last owner
  const { data: member } = await supabase
    .from("org_members")
    .select("role")
    .eq("id", memberId)
    .single();

  if (member?.role === "owner") {
    const { count } = await supabase
      .from("org_members")
      .select("*", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("role", "owner");

    if ((count ?? 0) <= 1) {
      throw new Error("Cannot remove the last owner");
    }
  }

  await supabase.from("org_members").delete().eq("id", memberId);
}

/**
 * Updates organization settings.
 */
export async function updateOrgSettings(
  supabase: SupabaseClient,
  orgId: string,
  settings: Record<string, unknown>
): Promise<void> {
  // Merge with existing settings
  const { data: org } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .single();

  const currentSettings = (org?.settings || {}) as Record<string, unknown>;
  const merged = { ...currentSettings, ...settings };

  await supabase
    .from("organizations")
    .update({
      settings: merged,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);
}

/**
 * Fetches and decrypts an organization's stored credentials.
 * Returns null for services without configured credentials.
 * Used by outreach-processor and task-processor to get per-org config.
 */
export async function getOrgCredentials(
  supabase: SupabaseClient,
  orgId: string
): Promise<OrgCredentials> {
  const { data: org, error } = await supabase
    .from("organizations")
    .select(
      "twilio_account_sid_encrypted, twilio_auth_token_encrypted, twilio_phone_number, ghl_api_key_encrypted, ghl_location_id, ghl_company_id, ghl_snapshot_id, vapi_api_key_encrypted, vapi_assistant_id, elevenlabs_agent_id, vercel_token_encrypted, vercel_team_id, anthropic_api_key_encrypted, goosekit_github_pat_encrypted, goosekit_vercel_token_encrypted, goosekit_claude_token_encrypted, goosekit_base_url, linked2checkout_api_key_encrypted, linked2checkout_webhook_secret_encrypted, linked2checkout_merchant_id, linked2checkout_product_id_ignite, default_website_builder"
    )
    .eq("id", orgId)
    .single();

  if (error || !org) {
    // Empty creds still needs `defaultWebsiteBuilder` populated —
    // downstream code treats it as non-nullable so it can skip a branch
    // on every read. `"ai"` is the safer default for orgs that haven't
    // opted into Goose Kit yet.
    return { defaultWebsiteBuilder: "ai" };
  }

  const row = org as Record<string, string | null>;
  const creds: OrgCredentials = {
    // Default to 'ai' if the column somehow isn't set (e.g. pre-migration
    // row that's been re-saved before the schema reload hit). Validated
    // against the enum; anything else falls back to 'ai'.
    defaultWebsiteBuilder:
      row.default_website_builder === "goosekit" ? "goosekit" : "ai",
  };

  // Helper: wrap a decrypt call so a single stale/unreadable blob doesn't
  // kill the entire function. The most common cause of failure here is an
  // ENCRYPTION_KEY rotation — any credential still encrypted with the old
  // key throws "Unsupported state or unable to authenticate data" from
  // Node's AES-GCM decipher. Treating that as "cred not configured" lets
  // callers fall back to env vars or a clear "please re-save this in
  // Settings" error, instead of a cryptic crypto failure that takes down
  // every automation that touches any org credential.
  function tryDecrypt(label: string, value: string): string | null {
    try {
      return decrypt(value);
    } catch (err) {
      console.warn(
        `[getOrgCredentials] failed to decrypt ${label} for org ${orgId} — likely an ENCRYPTION_KEY rotation; re-save this credential in Settings → Integrations:`,
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }

  // Twilio: all three fields required
  if (row.twilio_account_sid_encrypted && row.twilio_auth_token_encrypted && row.twilio_phone_number) {
    const sid = tryDecrypt("twilio.accountSid", row.twilio_account_sid_encrypted);
    const token = tryDecrypt("twilio.authToken", row.twilio_auth_token_encrypted);
    if (sid && token) {
      creds.twilio = {
        accountSid: sid,
        authToken: token,
        phoneNumber: row.twilio_phone_number,
      };
    }
  }

  // GHL: apiKey and locationId required; snapshotId optional but needed for IGNITE
  if (row.ghl_api_key_encrypted && row.ghl_location_id) {
    const apiKey = tryDecrypt("ghl.apiKey", row.ghl_api_key_encrypted);
    if (apiKey) {
      creds.ghl = {
        apiKey,
        locationId: row.ghl_location_id,
        companyId: row.ghl_company_id || undefined,
        snapshotId: row.ghl_snapshot_id || undefined,
      };
    }
  }

  // Vapi: both fields required
  if (row.vapi_api_key_encrypted && row.vapi_assistant_id) {
    const apiKey = tryDecrypt("vapi.apiKey", row.vapi_api_key_encrypted);
    if (apiKey) {
      creds.vapi = {
        apiKey,
        assistantId: row.vapi_assistant_id,
      };
    }
  }

  // ElevenLabs: agent ID only
  if (row.elevenlabs_agent_id) {
    creds.elevenlabs = {
      agentId: row.elevenlabs_agent_id,
    };
  }

  // Vercel: token required for client website deploys
  if (row.vercel_token_encrypted) {
    const token = tryDecrypt("vercel.token", row.vercel_token_encrypted);
    if (token) {
      creds.vercel = {
        token,
        teamId: row.vercel_team_id || undefined,
      };
    }
  }

  // Anthropic: API key only. Used by the AI website builder and any future
  // LLM-backed automations. Stored per-org so we aren't forced to ship a
  // single shared platform key.
  if (row.anthropic_api_key_encrypted) {
    const apiKey = tryDecrypt("anthropic.apiKey", row.anthropic_api_key_encrypted);
    if (apiKey) {
      creds.anthropic = {
        apiKey,
      };
    }
  }

  // Goose Kit: three downstream tokens required together (GitHub PAT,
  // Vercel token, Claude token). If any one is missing or fails to
  // decrypt, we treat the whole block as unconfigured — partial creds
  // would just produce a confusing upstream error from Goose Kit.
  if (
    row.goosekit_github_pat_encrypted &&
    row.goosekit_vercel_token_encrypted &&
    row.goosekit_claude_token_encrypted
  ) {
    const githubPat = tryDecrypt(
      "goosekit.githubPat",
      row.goosekit_github_pat_encrypted
    );
    const vercelToken = tryDecrypt(
      "goosekit.vercelToken",
      row.goosekit_vercel_token_encrypted
    );
    // The DB column is still `goosekit_claude_token_encrypted` (see
    // 00012), but we surface it as `claudeSetupToken` because that's
    // what Goose Kit's API body field is actually called — see
    // `packages/shared/src/automations/goosekit-builder.ts`.
    const claudeSetupToken = tryDecrypt(
      "goosekit.claudeSetupToken",
      row.goosekit_claude_token_encrypted
    );
    if (githubPat && vercelToken && claudeSetupToken) {
      creds.goosekit = {
        githubPat,
        vercelToken,
        claudeSetupToken,
        baseUrl: row.goosekit_base_url || undefined,
      };
    }
  }

  // Env-var fallback for Goose Kit: mirrors the Dropkit settings-store
  // pattern. If the org row didn't provide a complete set of tokens, fall
  // back to platform-wide env vars so Greg can configure Goose Kit once
  // at the Vercel project level during early testing (or when running a
  // single-tenant deploy). No encryption here because env vars are
  // already treated as secrets by the hosting platform.
  if (
    !creds.goosekit &&
    process.env.GOOSE_GITHUB_PAT &&
    process.env.GOOSE_VERCEL_TOKEN &&
    process.env.GOOSE_CLAUDE_TOKEN
  ) {
    creds.goosekit = {
      githubPat: process.env.GOOSE_GITHUB_PAT,
      vercelToken: process.env.GOOSE_VERCEL_TOKEN,
      claudeSetupToken: process.env.GOOSE_CLAUDE_TOKEN,
      baseUrl: process.env.GOOSE_BASE_URL || undefined,
    };
  }

  // Linked2Checkout: api key + webhook secret required
  if (
    row.linked2checkout_api_key_encrypted &&
    row.linked2checkout_webhook_secret_encrypted
  ) {
    const apiKey = tryDecrypt(
      "linked2checkout.apiKey",
      row.linked2checkout_api_key_encrypted
    );
    const webhookSecret = tryDecrypt(
      "linked2checkout.webhookSecret",
      row.linked2checkout_webhook_secret_encrypted
    );
    if (apiKey && webhookSecret) {
      creds.linked2checkout = {
        apiKey,
        webhookSecret,
        merchantId: row.linked2checkout_merchant_id || undefined,
        productIdIgnite: row.linked2checkout_product_id_ignite || undefined,
      };
    }
  }

  return creds;
}
