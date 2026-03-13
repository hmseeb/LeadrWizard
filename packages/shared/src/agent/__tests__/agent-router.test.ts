import { describe, it, expect } from "vitest";
import { decideNextAction, getAgentSystemPrompt } from "../agent-router";
import type { AgentContext } from "../../types";

function makeContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    client: {
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
    },
    session: {
      id: "s1",
      client_id: "c1",
      org_id: "org1",
      status: "active",
      current_channel: "widget",
      completion_pct: 50,
      last_interaction_at: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
    services: [],
    interaction_history: [],
    current_channel: "widget",
    ...overrides,
  };
}

describe("decideNextAction", () => {
  it("returns 'complete' when all services have no missing fields and no pending tasks", async () => {
    const context = makeContext({
      services: [
        {
          client_service: {
            id: "cs1",
            client_id: "c1",
            service_id: "svc1",
            client_package_id: "pkg1",
            status: "delivered",
            opted_out: false,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
          definition: {
            id: "svc1",
            org_id: "org1",
            name: "AI Website",
            slug: "ai-website",
            description: null,
            required_data_fields: [
              { key: "domain", label: "Domain", type: "text", required: true },
            ],
            setup_steps: [],
            is_active: true,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
          responses: [
            {
              id: "r1",
              session_id: "s1",
              client_service_id: "cs1",
              field_key: "domain",
              field_value: "janescoffee.com",
              answered_via: "click",
              created_at: "2024-01-01T00:00:00Z",
            },
          ],
          missing_fields: [],
          tasks: [
            {
              id: "t1",
              client_service_id: "cs1",
              task_type: "website_generation",
              status: "completed",
              external_ref: null,
              next_check_at: null,
              attempt_count: 1,
              last_result: null,
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-01T00:00:00Z",
            },
          ],
        },
      ],
    });

    const decision = await decideNextAction(context);
    expect(decision.action).toBe("complete");
    expect(decision.message).toContain("Everything is set up");
  });

  it("asks a question when there are missing fields", async () => {
    const context = makeContext({
      services: [
        {
          client_service: {
            id: "cs1",
            client_id: "c1",
            service_id: "svc1",
            client_package_id: "pkg1",
            status: "pending_onboarding",
            opted_out: false,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
          definition: {
            id: "svc1",
            org_id: "org1",
            name: "AI Website",
            slug: "ai-website",
            description: null,
            required_data_fields: [
              { key: "domain", label: "Domain Name", type: "text", required: true },
            ],
            setup_steps: [],
            is_active: true,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
          responses: [],
          missing_fields: [
            { key: "domain", label: "Domain Name", type: "text", required: true },
          ],
          tasks: [],
        },
      ],
    });

    const decision = await decideNextAction(context);
    expect(decision.action).toBe("ask_question");
    expect(decision.field_key).toBe("domain");
    expect(decision.service_id).toBe("svc1");
    expect(decision.message).toContain("domain name");
  });

  it("returns waiting message when all data collected but tasks pending", async () => {
    const context = makeContext({
      services: [
        {
          client_service: {
            id: "cs1",
            client_id: "c1",
            service_id: "svc1",
            client_package_id: "pkg1",
            status: "in_progress",
            opted_out: false,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
          definition: {
            id: "svc1",
            org_id: "org1",
            name: "A2P Registration",
            slug: "a2p",
            description: null,
            required_data_fields: [],
            setup_steps: [],
            is_active: true,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
          responses: [],
          missing_fields: [],
          tasks: [
            {
              id: "t1",
              client_service_id: "cs1",
              task_type: "a2p_registration",
              status: "pending",
              external_ref: null,
              next_check_at: null,
              attempt_count: 0,
              last_result: null,
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-01T00:00:00Z",
            },
          ],
        },
      ],
    });

    const decision = await decideNextAction(context);
    expect(decision.action).toBe("ask_question");
    expect(decision.message).toContain("processing");
  });

  it("uses SMS-friendly wording when channel is sms", async () => {
    const context = makeContext({
      current_channel: "sms",
      services: [
        {
          client_service: {
            id: "cs1",
            client_id: "c1",
            service_id: "svc1",
            client_package_id: "pkg1",
            status: "pending_onboarding",
            opted_out: false,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
          definition: {
            id: "svc1",
            org_id: "org1",
            name: "AI Website",
            slug: "ai-website",
            description: null,
            required_data_fields: [
              { key: "color", label: "Brand Color", type: "text", required: true },
            ],
            setup_steps: [],
            is_active: true,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
          responses: [],
          missing_fields: [
            { key: "color", label: "Brand Color", type: "text", required: true },
          ],
          tasks: [],
        },
      ],
    });

    const decision = await decideNextAction(context);
    expect(decision.message).toContain("For your AI Website setup");
  });
});

describe("getAgentSystemPrompt", () => {
  it("generates a system prompt containing client info", () => {
    const context = makeContext();
    const prompt = getAgentSystemPrompt(context);
    expect(prompt).toContain("Jane Doe");
    expect(prompt).toContain("Jane's Coffee");
    expect(prompt).toContain("jane@test.com");
  });
});
