import { describe, it, expect } from "vitest";
import { buildAgentContext, contextToSystemPrompt } from "../agent-context";
import type {
  Client,
  OnboardingSession,
  ClientService,
  ServiceDefinition,
  SessionResponse,
} from "../../types";

const client: Client = {
  id: "c1",
  org_id: "org1",
  name: "Jane Doe",
  email: "jane@test.com",
  phone: "+15551234567",
  business_name: "Jane's Coffee",
  payment_ref: "pay_123",
  ghl_sub_account_id: null,
  ghl_contact_id: null,
  metadata: {},
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const session: OnboardingSession = {
  id: "s1",
  client_id: "c1",
  org_id: "org1",
  status: "active",
  current_channel: "widget",
  completion_pct: 0,
  last_interaction_at: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const serviceDefinition: ServiceDefinition = {
  id: "svc1",
  org_id: "org1",
  name: "AI Website",
  slug: "ai-website",
  description: null,
  required_data_fields: [
    { key: "domain", label: "Domain", type: "text", required: true },
    { key: "color", label: "Brand Color", type: "text", required: true },
    { key: "notes", label: "Notes", type: "textarea", required: false },
  ],
  setup_steps: [],
  is_active: true,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const clientService: ClientService = {
  id: "cs1",
  client_id: "c1",
  service_id: "svc1",
  client_package_id: "pkg1",
  status: "onboarding",
  opted_out: false,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

describe("buildAgentContext", () => {
  it("builds context with correct missing fields", () => {
    const responses: SessionResponse[] = [
      {
        id: "r1",
        session_id: "s1",
        client_service_id: "cs1",
        field_key: "domain",
        field_value: "janescoffee.com",
        answered_via: "click",
        created_at: "2024-01-01T00:00:00Z",
      },
    ];

    const context = buildAgentContext({
      client,
      session,
      clientServices: [clientService],
      serviceDefinitions: [serviceDefinition],
      responses,
      tasks: [],
      recentInteractions: [],
      currentChannel: "widget",
    });

    expect(context.services).toHaveLength(1);
    expect(context.services[0].missing_fields).toHaveLength(1);
    expect(context.services[0].missing_fields[0].key).toBe("color");
    expect(context.services[0].responses).toHaveLength(1);
  });

  it("excludes opted-out services", () => {
    const optedOut: ClientService = {
      ...clientService,
      id: "cs2",
      service_id: "svc2",
      opted_out: true,
    };

    const context = buildAgentContext({
      client,
      session,
      clientServices: [clientService, optedOut],
      serviceDefinitions: [serviceDefinition],
      responses: [],
      tasks: [],
      recentInteractions: [],
      currentChannel: "widget",
    });

    expect(context.services).toHaveLength(1);
    expect(context.services[0].client_service.id).toBe("cs1");
  });

  it("throws when service definition is missing", () => {
    expect(() =>
      buildAgentContext({
        client,
        session,
        clientServices: [{ ...clientService, service_id: "nonexistent" }],
        serviceDefinitions: [serviceDefinition],
        responses: [],
        tasks: [],
        recentInteractions: [],
        currentChannel: "widget",
      })
    ).toThrow("Service definition not found");
  });
});

describe("contextToSystemPrompt", () => {
  it("includes client name and business in the prompt", () => {
    const context = buildAgentContext({
      client,
      session,
      clientServices: [clientService],
      serviceDefinitions: [serviceDefinition],
      responses: [],
      tasks: [],
      recentInteractions: [],
      currentChannel: "widget",
    });

    const prompt = contextToSystemPrompt(context);
    expect(prompt).toContain("Jane Doe");
    expect(prompt).toContain("Jane's Coffee");
    expect(prompt).toContain("jane@test.com");
    expect(prompt).toContain("AI Website");
    expect(prompt).toContain("Missing 2 fields");
  });

  it("shows 'All data collected' when no missing fields", () => {
    const responses: SessionResponse[] = [
      {
        id: "r1",
        session_id: "s1",
        client_service_id: "cs1",
        field_key: "domain",
        field_value: "test.com",
        answered_via: "click",
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "r2",
        session_id: "s1",
        client_service_id: "cs1",
        field_key: "color",
        field_value: "#6366f1",
        answered_via: "click",
        created_at: "2024-01-01T00:00:00Z",
      },
    ];

    const context = buildAgentContext({
      client,
      session,
      clientServices: [clientService],
      serviceDefinitions: [serviceDefinition],
      responses,
      tasks: [],
      recentInteractions: [],
      currentChannel: "widget",
    });

    const prompt = contextToSystemPrompt(context);
    expect(prompt).toContain("All data collected");
  });
});
