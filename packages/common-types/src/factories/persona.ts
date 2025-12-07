/**
 * Validated Mock Factories for Persona API Responses
 *
 * These factories create mock data that is VALIDATED against the Zod schemas.
 * If a test tries to mock an invalid shape, it will CRASH immediately.
 *
 * Usage in tests:
 *   import { mockSetOverrideResponse } from '@tzurot/common-types/factories';
 *
 *   mockCallGatewayApi.mockResolvedValue({
 *     ok: true,
 *     data: mockSetOverrideResponse({ persona: { name: 'Custom Name' } }),
 *   });
 */

import {
  OverrideInfoResponseSchema,
  SetOverrideResponseSchema,
  ClearOverrideResponseSchema,
  CreateOverrideResponseSchema,
  CreatePersonaResponseSchema,
  type OverrideInfoResponse,
  type SetOverrideResponse,
  type ClearOverrideResponse,
  type CreateOverrideResponse,
  type CreatePersonaResponse,
} from '../schemas/api/persona.js';

// Default UUIDs for consistent test data
const DEFAULT_PERSONALITY_ID = '11111111-1111-1111-1111-111111111111';
const DEFAULT_PERSONA_ID = '22222222-2222-2222-2222-222222222222';

/**
 * Create a validated mock for GET /user/persona/override/:slug
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockOverrideInfoResponse(
  overrides?: DeepPartial<OverrideInfoResponse>
): OverrideInfoResponse {
  const base: OverrideInfoResponse = {
    personality: {
      id: DEFAULT_PERSONALITY_ID,
      name: 'TestPersonality',
      displayName: 'Test Personality',
    },
  };
  return OverrideInfoResponseSchema.parse(deepMerge(base, overrides));
}

/**
 * Create a validated mock for PUT /user/persona/override/:slug
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockSetOverrideResponse(
  overrides?: DeepPartial<SetOverrideResponse>
): SetOverrideResponse {
  const base: SetOverrideResponse = {
    success: true,
    personality: {
      id: DEFAULT_PERSONALITY_ID,
      name: 'TestPersonality',
      displayName: 'Test Personality',
    },
    persona: {
      id: DEFAULT_PERSONA_ID,
      name: 'TestPersona',
      preferredName: 'Tester',
    },
  };
  return SetOverrideResponseSchema.parse(deepMerge(base, overrides));
}

/**
 * Create a validated mock for DELETE /user/persona/override/:slug
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockClearOverrideResponse(
  overrides?: DeepPartial<ClearOverrideResponse>
): ClearOverrideResponse {
  const base: ClearOverrideResponse = {
    success: true,
    personalityName: 'TestPersonality',
  };
  return ClearOverrideResponseSchema.parse(deepMerge(base, overrides));
}

/**
 * Create a validated mock for POST /user/persona/override/by-id/:id
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockCreateOverrideResponse(
  overrides?: DeepPartial<CreateOverrideResponse>
): CreateOverrideResponse {
  const base: CreateOverrideResponse = {
    success: true,
    persona: {
      id: DEFAULT_PERSONA_ID,
      name: 'NewPersona',
      preferredName: 'Tester',
      description: 'Test description',
      pronouns: 'they/them',
      content: 'Test content',
    },
    personality: {
      name: 'TestPersonality',
      displayName: 'Test Personality',
    },
  };
  return CreateOverrideResponseSchema.parse(deepMerge(base, overrides));
}

/**
 * Create a validated mock for POST /user/persona
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockCreatePersonaResponse(
  overrides?: DeepPartial<CreatePersonaResponse>
): CreatePersonaResponse {
  const base: CreatePersonaResponse = {
    persona: {
      id: DEFAULT_PERSONA_ID,
      name: 'NewPersona',
      preferredName: 'Tester',
      description: 'Test description',
      pronouns: 'they/them',
      content: 'Test content',
      isDefault: false,
      createdAt: new Date().toISOString(),
    },
  };
  return CreatePersonaResponseSchema.parse(deepMerge(base, overrides));
}

// ============================================================================
// Utility Types and Functions
// ============================================================================

/** Deep partial type for nested object overrides */
type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

/** Deep merge two objects (simplified for type safety) */
function deepMerge<T>(base: T, overrides?: DeepPartial<T>): T {
  if (!overrides) {
    return base;
  }
  if (typeof base !== 'object' || base === null) {
    return base;
  }

  const result = { ...base } as Record<string, unknown>;

  for (const key in overrides) {
    const overrideValue = overrides[key as keyof typeof overrides];
    if (overrideValue !== undefined) {
      const baseValue = result[key];
      if (
        typeof overrideValue === 'object' &&
        overrideValue !== null &&
        !Array.isArray(overrideValue) &&
        typeof baseValue === 'object' &&
        baseValue !== null
      ) {
        result[key] = deepMerge(baseValue, overrideValue as DeepPartial<typeof baseValue>);
      } else {
        result[key] = overrideValue;
      }
    }
  }

  return result as T;
}
