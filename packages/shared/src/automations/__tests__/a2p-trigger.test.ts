import { describe, it, expect, vi, beforeEach } from "vitest";
import { maybeTriggerA2POnCompletion } from "../a2p-trigger";
import { submitA2PRegistration } from "../a2p-manager";

// Mock the Twilio-facing module so tests never hit real HTTP.
vi.mock("../a2p-manager", () => ({
  submitA2PRegistration: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Minimal fake Supabase client
//
// The real @supabase/supabase-js client returns a chained PostgrestBuilder
// that is thenable (await-able) at the end of any chain. This fake supports
// exactly the call shapes `maybeTriggerA2POnCompletion` uses:
//
//   from(t).select(...).eq(...).maybeSingle()
//   from(t).select(...).eq(...).eq(...)                 // awaited directly
//   from(t).select(...).eq(...)                         // awaited directly
//   from(t).update(patch).eq(...)                       // awaited directly
//   from(t).insert(row)                                 // awaited directly
//
// Updates actually mutate the fixture rows so idempotency can be tested
// end-to-end without hand-modifying state between calls.
// ---------------------------------------------------------------------------

type FixtureRow = Record<string, unknown>;
type Fixtures = Record<string, FixtureRow[]>;

type Recorded = {
  updates: Array<{ table: string; patch: FixtureRow; filters: Record<string, unknown> }>;
  inserts: Array<{ table: string; row: FixtureRow }>;
};

function makeFake(fixtures: Fixtures) {
  const recorded: Recorded = { updates: [], inserts: [] };

  const supabase = {
    from(table: string) {
      return createBuilder(table, fixtures, recorded);
    },
  };

  return { supabase, recorded, fixtures };
}

function createBuilder(table: string, fixtures: Fixtures, recorded: Recorded) {
  const filters: Record<string, unknown> = {};

  const runQuery = (): FixtureRow[] => {
    const rows = fixtures[table] || [];
    return rows.filter((row) =>
      Object.entries(filters).every(([col, val]) => row[col] === val)
    );
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api: any = {
    select(_cols: string) {
      return api;
    },
    eq(col: string, val: unknown) {
      filters[col] = val;
      return api;
    },
    maybeSingle() {
      const rows = runQuery();
      return Promise.resolve({ data: rows[0] || null, error: null });
    },
    single() {
      const rows = runQuery();
      return Promise.resolve({ data: rows[0] || null, error: null });
    },
    insert(row: FixtureRow) {
      recorded.inserts.push({ table, row });
      return Promise.resolve({ error: null });
    },
    update(patch: FixtureRow) {
      const updateFilters: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ub: any = {
        eq(col: string, val: unknown) {
          updateFilters[col] = val;
          return ub;
        },
        then(
          onResolve: (v: { error: null }) => unknown,
          onReject?: (e: unknown) => unknown
        ) {
          recorded.updates.push({
            table,
            patch,
            filters: { ...updateFilters },
          });
          // Apply the patch to matching fixture rows so subsequent reads
          // observe the new state (simulates real DB behavior).
          const rows = fixtures[table] || [];
          for (const row of rows) {
            const matches = Object.entries(updateFilters).every(
              ([col, val]) => row[col] === val
            );
            if (matches) {
              Object.assign(row, patch);
            }
          }
          return Promise.resolve({ error: null }).then(onResolve, onReject);
        },
      };
      return ub;
    },
    // Makes `api` itself thenable — `await from(t).select(...).eq(...)` works.
    then(
      onResolve: (v: { data: FixtureRow[]; error: null }) => unknown,
      onReject?: (e: unknown) => unknown
    ) {
      return Promise.resolve({ data: runQuery(), error: null }).then(
        onResolve,
        onReject
      );
    },
  };

  return api;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const A2P_REQUIRED_FIELDS = [
  { key: "legal_business_name", label: "Legal Business Name", type: "text", required: true },
  { key: "ein", label: "EIN", type: "text", required: true },
  { key: "business_address", label: "Address", type: "text", required: true },
  { key: "business_city", label: "City", type: "text", required: true },
  { key: "business_state", label: "State", type: "text", required: true },
  { key: "business_zip", label: "ZIP", type: "text", required: true },
  { key: "business_phone", label: "Phone", type: "phone", required: true },
  { key: "contact_name", label: "Contact", type: "text", required: true },
  { key: "contact_email", label: "Email", type: "email", required: true },
];

function buildA2PResponses(sessionId: string, clientServiceId: string): FixtureRow[] {
  return [
    { session_id: sessionId, client_service_id: clientServiceId, field_key: "legal_business_name", field_value: "Acme Corp" },
    { session_id: sessionId, client_service_id: clientServiceId, field_key: "ein", field_value: "12-3456789" },
    { session_id: sessionId, client_service_id: clientServiceId, field_key: "business_address", field_value: "123 Main St" },
    { session_id: sessionId, client_service_id: clientServiceId, field_key: "business_city", field_value: "Austin" },
    { session_id: sessionId, client_service_id: clientServiceId, field_key: "business_state", field_value: "TX" },
    { session_id: sessionId, client_service_id: clientServiceId, field_key: "business_zip", field_value: "78701" },
    { session_id: sessionId, client_service_id: clientServiceId, field_key: "business_phone", field_value: "+15125550100" },
    { session_id: sessionId, client_service_id: clientServiceId, field_key: "contact_name", field_value: "Jane Doe" },
    { session_id: sessionId, client_service_id: clientServiceId, field_key: "contact_email", field_value: "jane@acme.com" },
  ];
}

function baseFixtures(overrides: Partial<Fixtures> = {}): Fixtures {
  const a2pService: FixtureRow = {
    id: "cs_a2p",
    client_id: "c1",
    service_id: "svc_a2p",
    status: "pending_onboarding",
    opted_out: false,
    service: {
      slug: "a2p-registration",
      required_data_fields: A2P_REQUIRED_FIELDS,
    },
  };

  return {
    onboarding_sessions: [{ id: "s1", client_id: "c1", org_id: "org1" }],
    clients: [{ id: "c1", name: "Jane Doe", email: "jane@acme.com" }],
    client_services: [a2pService],
    session_responses: buildA2PResponses("s1", "cs_a2p"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("maybeTriggerA2POnCompletion", () => {
  beforeEach(() => {
    vi.mocked(submitA2PRegistration).mockReset();
    vi.mocked(submitA2PRegistration).mockResolvedValue({
      id: "task_1",
      client_service_id: "cs_a2p",
      task_type: "a2p_registration",
      status: "waiting_external",
      external_ref: "BNMOCK",
      next_check_at: new Date().toISOString(),
      attempt_count: 1,
      last_result: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  it("returns session_not_found for unknown session", async () => {
    const { supabase } = makeFake({
      onboarding_sessions: [],
      clients: [],
      client_services: [],
      session_responses: [],
    });

    const result = await maybeTriggerA2POnCompletion(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      "nope"
    );

    expect(result).toEqual({ triggered: false, reason: "session_not_found" });
    expect(submitA2PRegistration).not.toHaveBeenCalled();
  });

  it("returns no_a2p when the package has no A2P service", async () => {
    const { supabase } = makeFake(
      baseFixtures({
        client_services: [
          {
            id: "cs_web",
            client_id: "c1",
            service_id: "svc_web",
            status: "pending_onboarding",
            opted_out: false,
            service: { slug: "website-build", required_data_fields: [] },
          },
        ],
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await maybeTriggerA2POnCompletion(supabase as any, "s1");

    expect(result).toEqual({ triggered: false, reason: "no_a2p" });
    expect(submitA2PRegistration).not.toHaveBeenCalled();
  });

  it("returns already_triggered when A2P service is not pending_onboarding", async () => {
    const { supabase } = makeFake(
      baseFixtures({
        client_services: [
          {
            id: "cs_a2p",
            client_id: "c1",
            service_id: "svc_a2p",
            status: "in_progress",
            opted_out: false,
            service: {
              slug: "a2p-registration",
              required_data_fields: A2P_REQUIRED_FIELDS,
            },
          },
        ],
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await maybeTriggerA2POnCompletion(supabase as any, "s1");

    expect(result).toEqual({ triggered: false, reason: "already_triggered" });
    expect(submitA2PRegistration).not.toHaveBeenCalled();
  });

  it("returns incomplete when a non-A2P service still has missing fields", async () => {
    const a2p = baseFixtures().client_services[0];
    const { supabase } = makeFake(
      baseFixtures({
        client_services: [
          a2p,
          {
            id: "cs_web",
            client_id: "c1",
            service_id: "svc_web",
            status: "pending_onboarding",
            opted_out: false,
            service: {
              slug: "website-build",
              required_data_fields: [
                { key: "niche", label: "Niche", type: "text", required: true },
              ],
            },
          },
        ],
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await maybeTriggerA2POnCompletion(supabase as any, "s1");

    expect(result).toEqual({ triggered: false, reason: "incomplete" });
    expect(submitA2PRegistration).not.toHaveBeenCalled();
  });

  it("returns incomplete when an A2P required field is unanswered", async () => {
    const partial = buildA2PResponses("s1", "cs_a2p").slice(0, -1); // drop contact_email
    const { supabase } = makeFake(baseFixtures({ session_responses: partial }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await maybeTriggerA2POnCompletion(supabase as any, "s1");

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("incomplete");
  });

  it("happy path: fires submitA2PRegistration and promotes A2P service", async () => {
    const { supabase, recorded } = makeFake(baseFixtures());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await maybeTriggerA2POnCompletion(supabase as any, "s1");

    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("submitted");
    expect(result.taskId).toBe("task_1");
    expect(submitA2PRegistration).toHaveBeenCalledOnce();

    const call = vi.mocked(submitA2PRegistration).mock.calls[0];
    // Second arg is clientServiceId
    expect(call[1]).toBe("cs_a2p");
    // Third arg is the full A2PRegistrationData payload
    const data = call[2];
    expect(data.business_name).toBe("Acme Corp");
    expect(data.ein).toBe("12-3456789");
    expect(data.business_address).toBe("123 Main St");
    expect(data.business_city).toBe("Austin");
    expect(data.business_state).toBe("TX");
    expect(data.business_zip).toBe("78701");
    expect(data.business_phone).toBe("+15125550100");
    expect(data.contact_name).toBe("Jane Doe");
    expect(data.contact_email).toBe("jane@acme.com");

    // client_services.status flipped to in_progress
    const statusUpdate = recorded.updates.find(
      (u) => u.table === "client_services" && u.patch.status === "in_progress"
    );
    expect(statusUpdate).toBeDefined();
    expect(statusUpdate?.filters.id).toBe("cs_a2p");

    // interaction_log entry written
    const logInsert = recorded.inserts.find((i) => i.table === "interaction_log");
    expect(logInsert).toBeDefined();
    expect((logInsert?.row.content as string) || "").toContain(
      "A2P registration submitted"
    );
  });

  it("uses default widget message types when none stored in session_responses", async () => {
    const { supabase } = makeFake(baseFixtures());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await maybeTriggerA2POnCompletion(supabase as any, "s1");

    const call = vi.mocked(submitA2PRegistration).mock.calls[0];
    // Default set: appointment_reminders, service_updates, two_way_conversation
    expect(call[2].use_case_description).toContain("appointment reminders");
    expect(call[2].use_case_description).toContain("service status updates");
    expect(call[2].use_case_description).toContain("two-way customer support");
  });

  it("uses agency-provided message_types and sample_messages when stored", async () => {
    const responses: FixtureRow[] = [
      ...buildA2PResponses("s1", "cs_a2p"),
      {
        session_id: "s1",
        client_service_id: "cs_a2p",
        field_key: "message_types",
        field_value: JSON.stringify(["promotional", "review_requests"]),
      },
      {
        session_id: "s1",
        client_service_id: "cs_a2p",
        field_key: "sample_messages",
        field_value: JSON.stringify(["Hi! Sample one.", "Hi! Sample two."]),
      },
    ];
    const { supabase } = makeFake(baseFixtures({ session_responses: responses }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await maybeTriggerA2POnCompletion(supabase as any, "s1");

    const call = vi.mocked(submitA2PRegistration).mock.calls[0];
    expect(call[2].use_case_description).toContain("promotional offers");
    expect(call[2].use_case_description).toContain("review requests");
    expect(call[2].sample_messages).toEqual(["Hi! Sample one.", "Hi! Sample two."]);
  });

  it("falls back to default message types when stored JSON is malformed", async () => {
    const responses: FixtureRow[] = [
      ...buildA2PResponses("s1", "cs_a2p"),
      {
        session_id: "s1",
        client_service_id: "cs_a2p",
        field_key: "message_types",
        field_value: "not valid json",
      },
    ];
    const { supabase } = makeFake(baseFixtures({ session_responses: responses }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await maybeTriggerA2POnCompletion(supabase as any, "s1");

    expect(result.triggered).toBe(true);
    const call = vi.mocked(submitA2PRegistration).mock.calls[0];
    expect(call[2].use_case_description).toContain("appointment reminders");
  });

  it("is idempotent: second call after success returns already_triggered", async () => {
    // The fake's update() mutates the fixture, so after the first call the
    // A2P row's status is already 'in_progress' — just like real Supabase.
    const { supabase } = makeFake(baseFixtures());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = await maybeTriggerA2POnCompletion(supabase as any, "s1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const second = await maybeTriggerA2POnCompletion(supabase as any, "s1");

    expect(first.triggered).toBe(true);
    expect(second).toEqual({ triggered: false, reason: "already_triggered" });
    // submitA2PRegistration was called exactly once, not twice.
    expect(submitA2PRegistration).toHaveBeenCalledOnce();
  });
});
