# API Contract Enforcement Plan

> **Status**: ✅ Phase 1 Complete (Schemas & Factories) — Phase 2 Optional
> **Updated**: 2026-01-17
> **Priority**: Low (Phase 1 achieved the goal)
> **Triggered by**: Post-mortem from v3.0.0-beta.9 bugs (profile override-set, character creation)

## Problem Statement

Two production bugs shipped because:

1. Bot-client expected response shapes that didn't match what gateway returned
2. Bot-client tests mocked gateway responses with **assumed** shapes
3. Tests passed on both sides, but they tested different contracts
4. No shared types or runtime validation between services

**Original state**:

- 106 mocked gateway responses in bot-client tests
- 83 actual gateway response points
- No shared response schemas
- No runtime validation of responses

## Solution: Zod Schemas + Validated Factories

Based on Gemini consultation, we implemented:

1. **Shared Zod Schemas** in `common-types` for all API responses
2. **Validated Mock Factories** that crash tests if mock shapes are invalid
3. **Incremental Adoption** - started with buggy endpoints, expanded to all user-facing APIs

## Current Coverage

### ✅ Fully Covered (Zod Schemas + Validated Factories)

| Domain             | Endpoints                                                          | Schema File         | Factory File        |
| ------------------ | ------------------------------------------------------------------ | ------------------- | ------------------- |
| **Persona**        | GET/POST/PUT/DELETE `/user/persona/*`, override, settings, default | `persona.ts`        | `persona.ts`        |
| **Personality**    | GET/POST/PUT/PATCH `/user/personality/*`                           | `personality.ts`    | `personality.ts`    |
| **LLM Config**     | GET/POST/DELETE `/user/llm-config`                                 | `llm-config.ts`     | `llm-config.ts`     |
| **Model Override** | GET/PUT/DELETE `/user/model-override/*`, default                   | `model-override.ts` | `model-override.ts` |
| **Timezone**       | GET/PUT `/user/timezone`                                           | `timezone.ts`       | `timezone.ts`       |
| **Usage**          | GET `/user/usage`, `/admin/usage`                                  | `usage.ts`          | `usage.ts`          |
| **Wallet**         | GET/POST/DELETE `/user/wallet/*`, test                             | `wallet.ts`         | `wallet.ts`         |

### ⚠️ Lower-Risk Gaps (Acceptable)

| Endpoint                               | Risk    | Reason                                                               |
| -------------------------------------- | ------- | -------------------------------------------------------------------- |
| `/models/text,vision,image-generation` | **Low** | Read-only autocomplete, uses existing `ModelAutocompleteOption` type |
| `/admin/db-sync`                       | **Low** | Admin-only endpoint, rarely used, has local `SyncResult` interface   |
| `/admin/llm-config`                    | **Low** | Shares structure with user llm-config (already has schemas)          |

### ✅ No Schema Needed (Internal/Public)

- `/ai/generate`, `/ai/transcribe`, `/ai/jobStatus` - Service-to-service only
- `/health`, `/metrics`, `/avatars/*` - Public endpoints
- `/admin/invalidateCache` - Internal cache operations

## File Structure

```
packages/common-types/src/
├── schemas/
│   ├── api/
│   │   ├── index.ts           # Re-exports all schemas
│   │   ├── persona.ts         # Persona endpoint responses
│   │   ├── personality.ts     # Personality endpoint responses
│   │   ├── wallet.ts          # Wallet endpoint responses
│   │   ├── model-override.ts  # Model override responses
│   │   ├── llm-config.ts      # LLM config responses
│   │   ├── timezone.ts        # Timezone responses
│   │   └── usage.ts           # Usage statistics responses
│   └── index.ts               # Updated exports
├── factories/
│   ├── index.ts               # Re-exports all factories
│   ├── persona.ts             # Persona mock factories
│   ├── personality.ts         # Personality mock factories
│   ├── wallet.ts              # Wallet mock factories
│   ├── model-override.ts      # Model override mock factories
│   ├── llm-config.ts          # LLM config mock factories
│   ├── timezone.ts            # Timezone mock factories
│   └── usage.ts               # Usage mock factories
```

## Usage

### In Bot-Client Tests

```typescript
// BEFORE (dangerous - assumed shapes)
mockCallGatewayApi.mockResolvedValue({
  ok: true,
  data: {
    success: true,
    personality: { id: 'personality-uuid', name: 'Lilith', displayName: 'Lilith' },
    persona: { id: 'persona-123', name: 'Work Persona', preferredName: 'Alice' },
  },
});

// AFTER (validated - crashes if schema changes)
import { mockSetOverrideResponse } from '@tzurot/common-types';

mockCallGatewayApi.mockResolvedValue({
  ok: true,
  data: mockSetOverrideResponse({
    personality: { id: 'personality-uuid', name: 'Lilith', displayName: 'Lilith' },
    persona: { id: 'persona-123', name: 'Work Persona', preferredName: 'Alice' },
  }),
});
```

### Factory Function Pattern

All factories follow this pattern:

```typescript
import { SomeResponseSchema, type SomeResponse } from '../schemas/api/some.js';

type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T;

export function mockSomeResponse(overrides?: DeepPartial<SomeResponse>): SomeResponse {
  const base: SomeResponse = {
    // Default valid values
  };

  // Deep merge overrides
  const merged = deepMerge(base, overrides);

  // Validate against schema - throws ZodError if invalid!
  return SomeResponseSchema.parse(merged);
}
```

## Implementation History

### Session 1 (2025-12-05)

- [x] Created `schemas/api/persona.ts` with buggy endpoint schemas
- [x] Created `schemas/api/personality.ts` with personality schemas
- [x] Created `factories/persona.ts` and `factories/personality.ts`
- [x] Fixed DELETE /user/persona/override/:slug contract mismatch
- [x] Updated affected bot-client tests

### Session 2 (2025-12-06)

- [x] Created `schemas/api/model-override.ts` - All model override endpoints
- [x] Created `schemas/api/wallet.ts` - All wallet endpoints
- [x] Created `factories/model-override.ts` and `factories/wallet.ts`
- [x] Converted wallet and model override tests to use factories

### Session 3 (2025-12-06)

- [x] Created `schemas/api/timezone.ts` - GET/PUT timezone
- [x] Created `schemas/api/llm-config.ts` - LLM config CRUD
- [x] Created `schemas/api/usage.ts` - Usage statistics
- [x] Created `factories/timezone.ts`, `factories/llm-config.ts`, `factories/usage.ts`
- [x] Converted timezone, preset, and model autocomplete tests to use factories
- [x] Completed comprehensive audit of all gateway endpoints

## Remaining Work

### Phase 2: Gateway Integration (Optional Enhancement)

- [ ] Add `validateResponse()` helper to gateway
- [ ] Use in routes for development-time validation
- [ ] Graceful degradation in production (log but don't crash)

```typescript
// api-gateway/src/utils/validateResponse.ts
export function validateResponse<T>(schema: ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      logger.error({ issues: error.issues }, 'Response validation failed');
      if (process.env.NODE_ENV === 'development') {
        throw error; // Fail fast in dev
      }
    }
    return data as T;
  }
}
```

### Ongoing Maintenance

- [ ] New endpoints MUST have Zod schemas in common-types
- [ ] PR checklist item: "API changes have schema updates"
- [ ] Convert remaining test files as code is touched

## Success Metrics

1. ✅ **Zero** contract mismatch bugs since implementation
2. ✅ **100%** of user-facing endpoints have Zod schemas
3. ✅ Test failures when mocks drift from actual responses
4. ⚠️ Most bot-client tests use factories (some legacy remain)

## Related Documents

- Post-mortem in CLAUDE.md (2025-12-05, 2025-12-06)
- Gemini consultation (2025-12-06)
- Original bugs: commits `4484120e`, `c6cac403`
