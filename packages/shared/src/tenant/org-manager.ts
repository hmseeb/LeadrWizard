import type { Organization, OrgMember } from "../types";
import type { SupabaseClient } from "../supabase/client";

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
