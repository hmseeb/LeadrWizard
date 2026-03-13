# Coding Conventions

**Analysis Date:** 2026-03-13

## Naming Patterns

**Files:**
- All lowercase with hyphens: `agent-context.ts`, `twilio-sms.ts`, `message-templates.ts`
- Test files use `__tests__/` directory structure and `.test.ts` suffix: `__tests__/agent-context.test.ts`
- Index files export submodules: `index.ts` re-exports from domain folders

**Functions:**
- camelCase: `buildAgentContext()`, `contextToSystemPrompt()`, `sendSMS()`, `parseInboundSMS()`
- Private functions use leading underscore or nested helper functions
- Event handlers and callbacks: `decideNextAction()`, `validateTwilioSignature()`

**Variables:**
- camelCase for values: `accountSid`, `authToken`, `fromNumber`, `normalizedPhone`
- SCREAMING_SNAKE_CASE for constants: Used sparingly in utility modules
- Single-letter iterators acceptable in tight loops: `for (let i = 0; i < numMedia; i++)`

**Types:**
- PascalCase for interfaces and types: `AgentContext`, `Client`, `TwilioConfig`, `SendSMSParams`, `SendSMSResult`
- Type exports: `export interface`, `export type` at module level
- Union types for status enums: `type SessionStatus = "active" | "paused" | "completed" | "abandoned"`
- Postfixed config types: `TwilioConfig`, interfaces for params: `SendSMSParams`, `InviteMemberParams`

**Exports:**
- Use named exports: `export function buildAgentContext()`, `export interface SendSMSParams`
- Barrel files aggregate exports: `packages/shared/src/index.ts` re-exports from submodules
- Type imports use `import type` when appropriate: `import type { AgentContext, Client } from "../types"`

## Code Style

**Formatting:**
- Tool: Prettier (implicit, formatting is consistent)
- 2-space indentation observed throughout
- Line length appears to be ~100-120 characters
- Objects and function signatures format across multiple lines when needed

**Linting:**
- TypeScript strict mode enabled: `"strict": true` in `tsconfig.json`
- ESLint configuration not present; relies on TypeScript for type safety
- Comments indicate expected standards but no `.eslintrc` file found

## Import Organization

**Order:**
1. External packages: `import { describe, it, expect } from "vitest"`
2. Type imports: `import type { AgentContext, Client, ... } from "../types"`
3. Local imports: `import { buildAgentContext } from "../agent-context"`
4. Relative path imports: Always use relative paths: `../types`, `./agent-context`

**Path Aliases:**
- Workspace alias defined: `@leadrwizard/shared` → `packages/shared/src` in `vitest.config.ts`
- Used in test setup but prefer explicit relative imports in source
- Configured in `vitest.config.ts` and `packages/tsconfig/base.json`

## Error Handling

**Patterns:**
- Throw explicit Error objects with clear messages: `throw new Error("Service definition not found for ${cs.service_id}")`
- Null checks before access: `if (!definition) { throw ... }`
- Array bounds checking: `if (!clients || clients.length === 0) { return null }`
- HTTP error responses checked: `if (!response.ok) { const errorBody = await response.text(); throw new Error(...) }`
- Graceful degradation with fallbacks: `const result = parseInboundSMS(body); if (!result) return null`

**Function return patterns:**
- Functions return concrete types or null: `Promise<SendSMSResult>`, `Promise<{ clientId, sessionId } | null>`
- No silent failures; errors propagate or are explicitly handled
- Array empty state handled explicitly: `if (totalFields === 0) return 100`

## Logging

**Framework:** console (implicit)

**Patterns:**
- No explicit logging observed in source; debug/trace would use `console.log()` or `console.error()`
- Future logging should use structured format with context
- Error logging implied in error messages: `throw new Error(...)`

## Comments

**When to Comment:**
- Used for module-level purpose documentation
- Clarify algorithm or business logic intent
- Explain why, not what (code shows what)

**JSDoc/TSDoc:**
```typescript
/**
 * Builds the full context the AI agent needs to make decisions.
 * This context is passed to Claude to determine the next question/action.
 */
export function buildAgentContext(params: {...}): AgentContext {
```

Pattern observed:
- Brief one-line summary
- Multi-line description if needed
- No @param or @returns tags (rely on TypeScript types)
- Used for exported functions and complex logic

## Function Design

**Size:** Functions range 5-50 lines; larger functions decomposed into helpers
- Example: `decideNextAction()` is ~40 lines but uses helper `buildQuestionMessage()`
- Preference for pure functions with clear inputs/outputs

**Parameters:**
- Use object destructuring for multiple params: `params: { client, session, responses, ... }`
- Single param objects preferred over positional args
- Named imports/exports for clarity

**Return Values:**
- Functions return specific types: `SendSMSResult`, `AgentDecision`
- Async functions return Promises: `Promise<SendSMSResult>`
- Optional returns use union with null: `Promise<{ clientId, sessionId } | null>`
- No implicit undefined returns; explicit null when absent

## Module Design

**Exports:**
- One primary function per file or namespace of related functions
- Example: `twilio-sms.ts` exports `sendSMS()`, `parseInboundSMS()`, `logInboundSMS()`, `validateTwilioSignature()`
- Interfaces/types exported alongside functions they use

**Barrel Files:**
- `packages/shared/src/index.ts` re-exports from submodules for public API
- Workspace exports configured in `package.json`:
  ```json
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types/index.ts",
    "./agent": "./src/agent/index.ts"
  }
  ```
- Allows consumers to `import { fn } from "@leadrwizard/shared/agent"`

## Type Safety

**Strict TypeScript:**
- No `any` types observed
- Explicit `Record<>` for maps: `Record<string, (params: TemplateParams) => string>`
- Union types for known sets: `type ChannelType = "sms" | "email" | "voice_call" | "widget" | "system"`
- Optional properties marked: `title?: string`, `description: string | null`

---

*Convention analysis: 2026-03-13*
