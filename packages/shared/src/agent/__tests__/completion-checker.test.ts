import { describe, it, expect } from "vitest";
import { checkCompletion, getMissingSummary } from "../completion-checker";
import type { AgentContext } from "../../types";

function makeContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    client: {
      id: "c1",
      org_id: "org1",
      name: "Test Client",
      email: "test@test.com",
      phone: null,
      business_name: null,
      payment_ref: null,
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
      current_channel: null,
      completion_pct: 0,
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

describe("checkCompletion", () => {
  it("returns 100% when no services", () => {
    const result = checkCompletion(makeContext());
    expect(result.overall_pct).toBe(100);
    expect(result.fully_complete).toBe(true);
  });

  it("calculates correct percentage across services", () => {
    const context = makeContext({
      services: [
        {
          client_service: {
            id: "cs1",
            client_id: "c1",
            service_id: "svc1",
            client_package_id: "pkg1",
            status: "onboarding",
            opted_out: false,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
          definition: {
            id: "svc1",
            org_id: "org1",
            name: "Website",
            slug: "website",
            description: null,
            required_data_fields: [
              { key: "a", label: "A", type: "text", required: true },
              { key: "b", label: "B", type: "text", required: true },
              { key: "c", label: "C", type: "text", required: false },
            ],
            setup_steps: [],
            is_active: true,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
          responses: [],
          missing_fields: [
            { key: "b", label: "B", type: "text", required: true },
          ],
          tasks: [],
        },
      ],
    });

    const result = checkCompletion(context);
    expect(result.overall_pct).toBe(50); // 1 of 2 required fields
    expect(result.services[0].pct).toBe(50);
    expect(result.all_data_collected).toBe(false);
    expect(result.fully_complete).toBe(false);
  });

  it("marks fully complete when all data collected and tasks done", () => {
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
            name: "Website",
            slug: "website",
            description: null,
            required_data_fields: [
              { key: "a", label: "A", type: "text", required: true },
            ],
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

    const result = checkCompletion(context);
    expect(result.overall_pct).toBe(100);
    expect(result.all_data_collected).toBe(true);
    expect(result.all_tasks_done).toBe(true);
    expect(result.fully_complete).toBe(true);
  });

  it("counts pending/in_progress/waiting_external tasks as not done", () => {
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
            name: "A2P",
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
              status: "waiting_external",
              external_ref: "ext_123",
              next_check_at: "2024-06-01T00:00:00Z",
              attempt_count: 1,
              last_result: null,
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-01T00:00:00Z",
            },
          ],
        },
      ],
    });

    const result = checkCompletion(context);
    expect(result.all_tasks_done).toBe(false);
    expect(result.fully_complete).toBe(false);
  });
});

describe("getMissingSummary", () => {
  it("returns all collected message when nothing missing", () => {
    const status = checkCompletion(makeContext());
    expect(getMissingSummary(status)).toBe("All information has been collected!");
  });

  it("lists missing fields per service", () => {
    const context = makeContext({
      services: [
        {
          client_service: {
            id: "cs1",
            client_id: "c1",
            service_id: "svc1",
            client_package_id: "pkg1",
            status: "onboarding",
            opted_out: false,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
          definition: {
            id: "svc1",
            org_id: "org1",
            name: "Website",
            slug: "website",
            description: null,
            required_data_fields: [
              { key: "domain", label: "Domain", type: "text", required: true },
              { key: "color", label: "Brand Color", type: "text", required: true },
            ],
            setup_steps: [],
            is_active: true,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
          responses: [],
          missing_fields: [
            { key: "domain", label: "Domain", type: "text", required: true },
            { key: "color", label: "Brand Color", type: "text", required: true },
          ],
          tasks: [],
        },
      ],
    });

    const status = checkCompletion(context);
    const summary = getMissingSummary(status);
    expect(summary).toContain("Still needed:");
    expect(summary).toContain("Website: Domain, Brand Color");
  });
});
