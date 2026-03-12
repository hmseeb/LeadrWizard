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

export interface ServicePackage {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  price_cents: number | null;
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

export interface ClientPackage {
  id: string;
  client_id: string;
  package_id: string;
  purchased_at: string;
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
  session_id: string | null;
  reason: string;
  context: Record<string, unknown>;
  channel: ChannelType;
  status: EscalationStatus;
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string;
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
