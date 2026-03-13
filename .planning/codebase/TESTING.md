# Testing Patterns

**Analysis Date:** 2026-03-13

## Test Framework

**Runner:**
- Vitest 4.1.0
- Config: `vitest.config.ts` (root level)
- Environment: Node.js

**Assertion Library:**
- Vitest built-in expect API

**Run Commands:**
```bash
pnpm test              # Run all tests once
pnpm test:watch       # Watch mode
pnpm test --coverage  # Coverage report (v8 provider)
```

## Test File Organization

**Location:**
- Co-located in `__tests__/` subdirectory alongside source files
- Pattern: `packages/shared/src/comms/__tests__/twilio-sms.test.ts` for `packages/shared/src/comms/twilio-sms.ts`

**Naming:**
- `.test.ts` suffix: `agent-context.test.ts`, `message-templates.test.ts`
- Matches source file name when possible

**Structure:**
```
packages/shared/src/
├── agent/
│   ├── agent-context.ts
│   ├── agent-router.ts
│   ├── __tests__/
│   │   ├── agent-context.test.ts
│   │   ├── agent-router.test.ts
│   │   └── completion-checker.test.ts
├── comms/
│   ├── twilio-sms.ts
│   ├── message-templates.ts
│   ├── __tests__/
│   │   ├── twilio-sms.test.ts
│   │   └── message-templates.test.ts
└── utils/
    ├── index.ts
    └── __tests__/
        └── utils.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect } from "vitest";
import { buildAgentContext } from "../agent-context";

describe("buildAgentContext", () => {
  it("builds context with correct missing fields", () => {
    // Arrange
    const responses: SessionResponse[] = [{ ... }];

    // Act
    const context = buildAgentContext({
      client,
      session,
      responses,
      // ...
    });

    // Assert
    expect(context.services).toHaveLength(1);
    expect(context.services[0].missing_fields).toHaveLength(1);
  });

  it("excludes opted-out services", () => {
    // Test specific behavior
  });
});

describe("contextToSystemPrompt", () => {
  // Test second function in same module
});
```

**Patterns:**
- One `describe()` block per exported function
- Multiple test cases within each describe block
- Implicit setup (no `beforeEach`/`afterEach` hooks found)
- Clear test names describing behavior, not implementation
- Comments with "Arrange, Act, Assert" pattern (implicit)

## Mocking

**Framework:** None detected; tests use direct function calls and test data

**Patterns:**
```typescript
// Test data factories (inline in test file)
function makeContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    client: { /* full object */ },
    session: { /* full object */ },
    services: [],
    interaction_history: [],
    ...overrides,
  };
}

// Usage in test
const context = makeContext({
  services: [{ /* service override */ }],
});
```

**What to Mock:**
- Database calls (Supabase) - not mocked in unit tests reviewed; unit tests focus on pure functions
- External API calls (Twilio) - async functions tested with direct calls in integration scenarios

**What NOT to Mock:**
- Pure utility functions - tested directly: `formatPhoneE164()`, `slugify()`, `truncate()`
- Domain logic functions - tested with real data objects: `buildAgentContext()`, `decideNextAction()`
- Type-safe data structures - prefer real objects over partial mocks

## Fixtures and Factories

**Test Data:**
```typescript
const client: Client = {
  id: "c1",
  org_id: "org1",
  name: "Jane Doe",
  email: "jane@test.com",
  phone: "+15551234567",
  business_name: "Jane's Coffee",
  payment_ref: "pay_123",
  // ... all required fields
};

const session: OnboardingSession = { /* full object */ };

const serviceDefinition: ServiceDefinition = { /* full object */ };
```

**Location:**
- Defined at top of test file after imports
- Reused across multiple test cases
- Overridden using object spread for variations:
  ```typescript
  const optedOut: ClientService = {
    ...clientService,
    id: "cs2",
    service_id: "svc2",
    opted_out: true,
  };
  ```

**Factory Pattern:**
- `makeContext(overrides)` function generates complete AgentContext with defaults
- Allows tests to specify only what matters for that test
- Reduces boilerplate and improves readability

## Coverage

**Requirements:** No explicit coverage thresholds enforced

**View Coverage:**
```bash
pnpm test --coverage
```

**Configuration:**
```javascript
// vitest.config.ts
coverage: {
  provider: "v8",
  include: ["packages/shared/src/**/*.ts"],
  exclude: ["**/index.ts", "**/types/**"],
}
```

- Only measures `packages/shared/src/`
- Excludes barrel files (`index.ts`) and type definitions
- Uses v8 provider for native coverage

## Test Types

**Unit Tests:**
- Pure function tests: `formatPhoneE164()`, `calculateCompletionPct()`, `slugify()`, `truncate()`
- Scope: Single function with isolated test data
- Approach: Direct function call, assert return value
- Example: `expect(slugify("Hello World")).toBe("hello-world")`

**Integration Tests:**
- Not yet in codebase; would test multiple functions together
- Future: Database operations (Supabase), external API calls (Twilio)

**E2E Tests:**
- Not detected; likely handled separately in apps (widget, admin)
- Widget app likely has E2E tests for user flows (not in scope of shared package tests)

## Common Patterns

**Async Testing:**
```typescript
it("returns 'complete' when all services have no missing fields", async () => {
  const context = makeContext({ /* ... */ });
  const decision = await decideNextAction(context);
  expect(decision.action).toBe("complete");
});
```

- Use `async` and `await` naturally
- Vitest handles async test detection
- No explicit Promise chaining

**Error Testing:**
```typescript
it("throws when service definition is missing", () => {
  expect(() =>
    buildAgentContext({
      clientServices: [{ ...clientService, service_id: "nonexistent" }],
      serviceDefinitions: [serviceDefinition],
      // ...
    })
  ).toThrow("Service definition not found");
});
```

- Wrap throwing function in arrow function
- Use `.toThrow()` to assert error message
- Test both error condition and message content

**Boundary Cases:**
```typescript
describe("calculateCompletionPct", () => {
  it("returns 100 when total is 0", () => {
    expect(calculateCompletionPct(0, 0)).toBe(100);
  });

  it("rounds to nearest integer", () => {
    expect(calculateCompletionPct(1, 3)).toBe(33);
    expect(calculateCompletionPct(2, 3)).toBe(67);
  });
});
```

- Test edge cases: empty arrays, zero denominators, rounding
- Multiple assertions in one test when testing same function boundary

**Graceful Degradation:**
```typescript
it("handles empty/missing fields gracefully", () => {
  const result = parseInboundSMS({});
  expect(result.messageSid).toBe("");
  expect(result.from).toBe("");
  expect(result.body).toBe("");
  expect(result.numMedia).toBe(0);
});
```

- Test that functions handle missing/invalid input
- Assert expected defaults or empty values

## Test Statistics

**Current Coverage:**
- 6 test files total
- Primary focus: `packages/shared/src/` utilities and domain logic
- High coverage on pure functions and business logic
- Lower coverage on I/O operations (async functions with external deps)

**Gap Areas:**
- No mocking framework setup (would need `vi.mock()` for external deps)
- Database operations not tested (would require Supabase mock or test database)
- Webhook signature validation tested only with valid signatures

---

*Testing analysis: 2026-03-13*
