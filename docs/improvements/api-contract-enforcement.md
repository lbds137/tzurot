# API Contract Enforcement Plan

> **Status**: Planning
> **Priority**: High (prevents production bugs)
> **Triggered by**: Post-mortem from v3.0.0-beta.9 bugs (profile override-set, character creation)

## Problem Statement

Two production bugs shipped because:

1. Bot-client expected response shapes that didn't match what gateway returned
2. Bot-client tests mocked gateway responses with **assumed** shapes
3. Tests passed on both sides, but they tested different contracts
4. No shared types or runtime validation between services

**Current state**:

- 106 mocked gateway responses in bot-client tests
- 83 actual gateway response points
- No shared response schemas
- No runtime validation of responses

## Solution: Zod Schemas + Validated Factories

Based on Gemini consultation, we'll implement:

1. **Shared Zod Schemas** in `common-types` for all API responses
2. **Validated Mock Factories** that crash tests if mock shapes are invalid
3. **Runtime Validation** in gateway to prevent returning wrong shapes
4. **Incremental Adoption** - start with buggy endpoints, expand as we touch code

## Implementation Plan

### Phase 1: Foundation (This Sprint)

#### 1.1 Create Schema Directory Structure

```
packages/common-types/src/
├── schemas/
│   ├── api/                     # NEW: API response schemas
│   │   ├── persona.ts           # Persona endpoint responses
│   │   ├── personality.ts       # Personality endpoint responses
│   │   ├── wallet.ts            # Wallet endpoint responses
│   │   └── index.ts             # Re-exports all
│   ├── index.ts                 # Updated exports
│   └── llmAdvancedParams.ts     # Existing
├── factories/                   # NEW: Validated mock factories
│   ├── persona.ts
│   ├── personality.ts
│   └── index.ts
```

#### 1.2 Create Schemas for Buggy Endpoints

**`schemas/api/persona.ts`**:

```typescript
import { z } from 'zod';

// Shared sub-schemas
export const PersonalityRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  displayName: z.string().nullable(),
});

export const PersonaRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  preferredName: z.string().nullable(),
});

// GET /user/persona/override/:slug (for modal prep)
export const OverrideInfoResponseSchema = z.object({
  personality: PersonalityRefSchema,
});
export type OverrideInfoResponse = z.infer<typeof OverrideInfoResponseSchema>;

// PUT /user/persona/override/:slug
export const SetOverrideResponseSchema = z.object({
  success: z.literal(true),
  personality: PersonalityRefSchema,
  persona: PersonaRefSchema,
});
export type SetOverrideResponse = z.infer<typeof SetOverrideResponseSchema>;

// POST /user/persona/override/by-id/:id (create + set override)
export const CreateOverrideResponseSchema = z.object({
  success: z.literal(true),
  persona: PersonaRefSchema.extend({
    description: z.string().nullable(),
    pronouns: z.string().nullable(),
    content: z.string().nullable(),
  }),
  personality: z.object({
    name: z.string(),
    displayName: z.string().nullable(),
  }),
});
export type CreateOverrideResponse = z.infer<typeof CreateOverrideResponseSchema>;
```

**`schemas/api/personality.ts`**:

```typescript
import { z } from 'zod';

// POST /user/personality response
export const CreatePersonalityResponseSchema = z.object({
  success: z.literal(true),
  personality: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    displayName: z.string().nullable(),
    characterInfo: z.string().nullable(),
    personalityTraits: z.string().nullable(),
    personalityTone: z.string().nullable(),
    personalityAge: z.string().nullable(),
    personalityAppearance: z.string().nullable(),
    personalityLikes: z.string().nullable(),
    personalityDislikes: z.string().nullable(),
    conversationalGoals: z.string().nullable(),
    conversationalExamples: z.string().nullable(),
    errorMessage: z.string().nullable(),
    birthMonth: z.number().nullable(),
    birthDay: z.number().nullable(),
    birthYear: z.number().nullable(),
    isPublic: z.boolean(),
    voiceEnabled: z.boolean(),
    imageEnabled: z.boolean(),
    ownerId: z.string(),
    hasAvatar: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
});
export type CreatePersonalityResponse = z.infer<typeof CreatePersonalityResponseSchema>;
```

#### 1.3 Create Validated Factories

**`factories/persona.ts`**:

```typescript
import {
  OverrideInfoResponseSchema,
  SetOverrideResponseSchema,
  CreateOverrideResponseSchema,
  type OverrideInfoResponse,
  type SetOverrideResponse,
  type CreateOverrideResponse,
} from '../schemas/api/persona.js';

/**
 * Create a validated mock for GET /user/persona/override/:slug
 * Throws if the mock doesn't match the schema!
 */
export function mockOverrideInfoResponse(
  overrides?: Partial<OverrideInfoResponse>
): OverrideInfoResponse {
  const base: OverrideInfoResponse = {
    personality: {
      id: 'personality-uuid-123',
      name: 'TestPersonality',
      displayName: 'Test Personality',
    },
  };
  return OverrideInfoResponseSchema.parse({ ...base, ...overrides });
}

/**
 * Create a validated mock for PUT /user/persona/override/:slug
 */
export function mockSetOverrideResponse(
  overrides?: Partial<SetOverrideResponse>
): SetOverrideResponse {
  const base: SetOverrideResponse = {
    success: true,
    personality: {
      id: 'personality-uuid-123',
      name: 'TestPersonality',
      displayName: 'Test Personality',
    },
    persona: {
      id: 'persona-uuid-456',
      name: 'TestPersona',
      preferredName: 'Tester',
    },
  };
  return SetOverrideResponseSchema.parse({ ...base, ...overrides });
}
```

### Phase 2: Gateway Integration

#### 2.1 Add Response Validation Helper

**`api-gateway/src/utils/validateResponse.ts`**:

```typescript
import { ZodSchema, ZodError } from 'zod';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('response-validator');

/**
 * Validate response data against schema before sending.
 * In development: throws on mismatch (fail fast)
 * In production: logs error and returns data anyway (graceful degradation)
 */
export function validateResponse<T>(schema: ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      logger.error(
        { issues: error.issues, data },
        '[API] Response validation failed - contract mismatch!'
      );
      // In production, we log but don't crash
      // The bug will be visible in logs and tests will catch it
      if (process.env.NODE_ENV === 'development') {
        throw error; // Fail fast in dev
      }
    }
    return data as T;
  }
}
```

#### 2.2 Use in Routes

```typescript
// In persona.ts PUT /override/:slug handler
import { SetOverrideResponseSchema } from '@tzurot/common-types';
import { validateResponse } from '../../utils/validateResponse.js';

// Before sending:
const responseData = validateResponse(SetOverrideResponseSchema, {
  success: true,
  personality: { id: personality.id, name: personality.name, displayName: personality.displayName },
  persona: { id: persona.id, name: persona.name, preferredName: persona.preferredName },
});
sendCustomSuccess(res, responseData);
```

### Phase 3: Update Bot-Client Tests

Replace inline mocks with validated factories:

```typescript
// BEFORE (in override-set.test.ts)
mockCallGatewayApi.mockResolvedValue({
  ok: true,
  data: {
    success: true,
    personality: { id: 'personality-uuid', name: 'Lilith', displayName: 'Lilith' },
    persona: { id: 'persona-123', name: 'Work Persona', preferredName: 'Alice' },
  },
});

// AFTER
import { mockSetOverrideResponse } from '@tzurot/common-types/factories';

mockCallGatewayApi.mockResolvedValue({
  ok: true,
  data: mockSetOverrideResponse({
    personality: { id: 'personality-uuid', name: 'Lilith', displayName: 'Lilith' },
    persona: { id: 'persona-123', name: 'Work Persona', preferredName: 'Alice' },
  }),
});
```

### Phase 4: CLAUDE.md Updates

Add to lessons learned:

```markdown
### 2025-12-06 - API Contract Mismatch in /me Commands

**What Happened**: Bot-client tests mocked gateway responses with assumed shapes.
Gateway returned different shapes. Tests passed, production broke.

**Prevention**:

1. ALWAYS use validated factories from `@tzurot/common-types/factories` for mocks
2. NEVER manually construct JSON objects for API response mocks
3. When writing both sides of an API, READ the actual response code
4. New/changed endpoints MUST have Zod schemas in common-types
```

Add to code style:

```markdown
**API Response Contracts**:

- All API responses MUST have Zod schemas in `common-types/src/schemas/api/`
- Bot-client tests MUST use validated factories, never inline mock objects
- Gateway routes SHOULD use `validateResponse()` before sending
```

## Rollout Strategy

### Immediate (This Session) ✅ COMPLETE

- [x] Create `schemas/api/persona.ts` with buggy endpoint schemas
- [x] Create `schemas/api/personality.ts` with create personality schema
- [x] Create `factories/persona.ts` and `factories/personality.ts`
- [x] Update the two buggy endpoint tests to use factories
- [x] **BONUS**: Found and fixed DELETE /user/persona/override/:slug contract mismatch
  - Gateway was returning `{message, personalitySlug}` but bot-client expected `{success, personality, hadOverride}`
  - This would have broken `/me profile override-clear` in production!

### Short-term (Next Few Sessions)

- [ ] Add `validateResponse()` to gateway
- [ ] Audit high-risk endpoints (all POST/PUT that return data used by UI)
- [ ] Convert remaining 18 test files (incrementally, as code is touched):
  - Profile: create, default, edit, list, share-ltm, view
  - Model: handlers, clear-default
  - Timezone: get, set
  - Preset: create, delete, list
  - Wallet: list, test
  - Autocomplete: me/autocomplete, character/autocomplete, personalityAutocomplete

### Ongoing

- [ ] Require schemas for all new endpoints
- [ ] Convert remaining endpoints as we touch them
- [ ] Add to PR checklist: "API changes have schema updates"

## Success Metrics

1. **Zero** contract mismatch bugs in production
2. **100%** of new endpoints have Zod schemas
3. Test failures when mocks drift from actual responses
4. Bot-client tests use factories, not inline mocks

## Related Documents

- Post-mortem in CLAUDE.md
- Gemini consultation (2025-12-06)
- Original bugs: commits `4484120e`, `c6cac403`
