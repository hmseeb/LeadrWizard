// ============================================================
// LeadrWizard Domain Types
// ============================================================

// --- Enums ---

export type OrgMemberRole = "owner" | "admin" | "member";

export type ServiceStatus =
  | "pending_onboarding"
  | "onboarding"
  | "ready_to_deliver"
  | "in_progress"
  | "delivered"
  | "paused";

export type SessionStatus = "active" | "paused" | "completed" | "abandoned";

export type ChannelType = "sms" | "email" | "voice_call" | "widget" | "system";

export type InteractionDirection = "inbound" | "outbound";

export type ContentType = "text" | "voice" | "system_event";

export type AnswerMethod = "click" | "voice" | "sms" | "voice_call";

export type OutreachStatus = "pending" | "sent" | "failed" | "cancelled";

export type OutreachPriority = "normal" | "urgent";

export type EscalationStatus = "open" | "assigned" | "resolved";

export type ServiceTaskStatus =
  | "pending"
  | "in_progress"
  | "waiting_external"
  | "completed"
  | "failed";

export type ServiceTaskType =
  | "a2p_registration"
  | "gmb_access_request"
  | "website_generation"
  | "ghl_snapshot_deploy"
  | "ghl_sub_account_provision";

// --- Core Entities ---

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  settings: OrgSettings;
  created_at: string;
  updated_at: string;
  // Per-org encrypted credentials (Phase 4)
  twilio_account_sid_encrypted: string | null;
  twilio_auth_token_encrypted: string | null;
  twilio_phone_number: string | null;
  ghl_api_key_encrypted: string | null;
  ghl_location_id: string | null;
  ghl_company_id: string | null;
  ghl_snapshot_id: string | null;
  vapi_api_key_encrypted: string | null;
  vapi_assistant_id: string | null;
  elevenlabs_agent_id: string | null;
  vercel_token_encrypted: string | null;
  vercel_team_id: string | null;
  linked2checkout_api_key_encrypted: string | null;
  linked2checkout_webhook_secret_encrypted: string | null;
  linked2checkout_merchant_id: string | null;
  linked2checkout_product_id_ignite: string | null;
}

export interface OrgSettings {
  outreach_cadence: OutreachCadenceConfig;
  escalation_webhook_url: string | null;
  escalation_channel: "slack" | "google_chat" | null;
}

export interface OutreachCadenceConfig {
  steps: OutreachCadenceStep[];
}

export interface OutreachCadenceStep {
  delay_minutes: number;
  channel: ChannelType;
  message_template: string;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgMemberRole;
  created_at: string;
}

// --- Service Definitions ---

export interface ServiceDefinition {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  required_data_fields: DataFieldDefinition[];
  setup_steps: SetupStepDefinition[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DataFieldDefinition {
  key: string;
  label: string;
  type: "text" | "email" | "phone" | "url" | "textarea" | "select" | "file";
  required: boolean;
  options?: string[];
  placeholder?: string;
  help_text?: string;
}

export interface SetupStepDefinition {
  key: string;
  label: string;
  description: string;
  automated: boolean;
  task_type?: ServiceTaskType;
}

// --- Packages ---

export type PackagePriceInterval = "one_time" | "monthly" | "yearly";

export interface ServicePackage {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  price_interval: PackagePriceInterval;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PackageService {
  id: string;
  package_id: string;
  service_id: string;
}

// --- Niche Templates ---

export interface NicheTemplate {
  id: string;
  org_id: string;
  niche_name: string;
  description: string | null;
  template_data: Record<string, unknown>;
  preview_url: string | null;
  created_at: string;
  updated_at: string;
}

// --- Message Templates ---

export type MessageChannel = "sms" | "email" | "voice";

export interface MessageTemplate {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Available variables for message template interpolation.
 * These are injected at send time from client/session context.
 * Displayed as reference in the template editor UI.
 */
export const TEMPLATE_VARIABLES = [
  { key: "name", label: "Client Name", example: "Jane Doe" },
  { key: "businessName", label: "Business Name", example: "Jane's Bakery" },
  { key: "packageName", label: "Package Name", example: "Pro Bundle" },
  { key: "onboardingUrl", label: "Onboarding URL", example: "https://app.example.com/onboard?s=abc123" },
  { key: "itemsRemaining", label: "Items Remaining", example: "3" },
] as const;

// --- Clients ---

export interface Client {
  id: string;
  org_id: string;
  name: string;
  email: string;
  phone: string | null;
  business_name: string | null;
  payment_ref: string | null;
  ghl_sub_account_id: string | null;
  ghl_contact_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ClientPackageStatus =
  | "active"
  | "past_due"
  | "cancelled"
  | "suspended";

export interface ClientPackage {
  id: string;
  client_id: string;
  package_id: string;
  purchased_at: string;
  status: ClientPackageStatus;
  external_subscription_id: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
}

export interface ClientService {
  id: string;
  client_id: string;
  service_id: string;
  client_package_id: string;
  status: ServiceStatus;
  opted_out: boolean;
  created_at: string;
  updated_at: string;
}

// --- Onboarding Sessions ---

export interface OnboardingSession {
  id: string;
  client_id: string;
  org_id: string;
  status: SessionStatus;
  current_channel: ChannelType | null;
  completion_pct: number;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionResponse {
  id: string;
  session_id: string;
  client_service_id: string | null;
  field_key: string;
  field_value: string;
  answered_via: AnswerMethod;
  created_at: string;
}

// --- Service Tasks ---

export interface ServiceTask {
  id: string;
  client_service_id: string;
  task_type: ServiceTaskType;
  status: ServiceTaskStatus;
  external_ref: string | null;
  next_check_at: string | null;
  attempt_count: number;
  last_result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// --- Interaction Log ---

export interface InteractionLog {
  id: string;
  client_id: string;
  session_id: string | null;
  channel: ChannelType;
  direction: InteractionDirection;
  content_type: ContentType;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// --- Outreach Queue ---

export interface OutreachQueueItem {
  id: string;
  client_id: string;
  session_id: string | null;
  channel: ChannelType;
  message_template: string;
  message_params: Record<string, string>;
  scheduled_at: string;
  sent_at: string | null;
  status: OutreachStatus;
  attempt_count: number;
  priority: OutreachPriority;
  escalation_level: number;
  created_at: string;
}

// --- Escalations ---

export interface Escalation {
  id: string;
  client_id: string;
  org_id: string;
  session_id: string | null;
  reason: string;
  context: Record<string, unknown>;
  channel: ChannelType;
  status: EscalationStatus;
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string;
}

// --- Dead Letter Queue ---

export type DLQStatus = "active" | "retried" | "dismissed";

export interface DeadLetterQueueItem {
  id: string;
  original_table: string;
  original_id: string;
  task_type: string | null;
  org_id: string;
  client_id: string | null;
  last_error: string | null;
  attempt_count: number;
  payload: Record<string, unknown>;
  retried_at: string | null;
  dismissed_at: string | null;
  created_at: string;
}

/**
 * Decrypted org credentials for adapter consumption.
 * Built by decrypting the _encrypted columns on Organization.
 */
export interface OrgCredentials {
  twilio?: {
    accountSid: string;
    authToken: string;
    phoneNumber: string;
  };
  ghl?: {
    apiKey: string;
    locationId: string;
    companyId?: string;
    snapshotId?: string;
  };
  vapi?: {
    apiKey: string;
    assistantId: string;
  };
  elevenlabs?: {
    agentId: string;
  };
  vercel?: {
    token: string;
    teamId?: string;
  };
  anthropic?: {
    apiKey: string;
  };
  linked2checkout?: {
    apiKey: string;
    webhookSecret: string;
    merchantId?: string;
    productIdIgnite?: string;
  };
}

// --- Agent Types ---

export interface AgentContext {
  client: Client;
  session: OnboardingSession;
  services: Array<{
    client_service: ClientService;
    definition: ServiceDefinition;
    responses: SessionResponse[];
    missing_fields: DataFieldDefinition[];
    tasks: ServiceTask[];
  }>;
  interaction_history: InteractionLog[];
  current_channel: ChannelType;
}

export interface AgentDecision {
  action: "ask_question" | "confirm_answer" | "advance_service" | "complete" | "escalate" | "request_callback";
  service_id?: string;
  field_key?: string;
  message: string;
  options?: string[];
}

// --- Billing ---

export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  billing_interval: "monthly" | "yearly";
  max_clients: number | null;
  max_services: number | null;
  features: string[];
  stripe_price_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrgSubscription {
  id: string;
  org_id: string;
  plan_id: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  status: "active" | "past_due" | "cancelled" | "trialing";
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrgInvitation {
  id: string;
  org_id: string;
  email: string;
  role: OrgMemberRole;
  invited_by: string;
  token: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface UsageRecord {
  id: string;
  org_id: string;
  metric: string;
  quantity: number;
  period_start: string;
  period_end: string;
  created_at: string;
}

// --- Analytics ---

export interface AnalyticsSnapshot {
  id: string;
  snapshot_date: string;
  active_sessions: number;
  completed_sessions: number;
  abandoned_sessions: number;
  avg_completion_pct: number;
  total_interactions: number;
  sms_sent: number;
  voice_calls_made: number;
  emails_sent: number;
  escalations_opened: number;
  escalations_resolved: number;
  services_delivered: number;
  created_at: string;
}
