/**
 * Validated Mock Factories for Model Override API Responses
 *
 * These factories create mock data that is VALIDATED against the Zod schemas.
 * If a test tries to mock an invalid shape, it will CRASH immediately.
 *
 * Usage in tests:
 *   import { mockListModelOverridesResponse } from '@tzurot/common-types/factories';
 *
 *   mockCallGatewayApi.mockResolvedValue({
 *     ok: true,
 *     data: mockListModelOverridesResponse([{ personalityName: 'Custom' }]),
 *   });
 */

import type { ModelOverrideSummary } from '../types/byok.js';
import {
  ListModelOverridesResponseSchema,
  SetModelOverrideResponseSchema,
  SetDefaultConfigResponseSchema,
  ClearDefaultConfigResponseSchema,
  DeleteModelOverrideResponseSchema,
  type ListModelOverridesResponse,
  type SetModelOverrideResponse,
  type SetDefaultConfigResponse,
  type ClearDefaultConfigResponse,
  type DeleteModelOverrideResponse,
  type UserDefaultConfig,
} from '../schemas/api/model-override.js';

// Default UUIDs for consistent test data (RFC 4122 compliant v5 UUIDs)
const DEFAULT_PERSONALITY_ID = '11111111-1111-5111-8111-111111111111';
const DEFAULT_CONFIG_ID = '33333333-3333-5333-8333-333333333333';

// ============================================================================
// Helper Functions
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

/** Create a base model override summary object */
function createBaseModelOverrideSummary(
  overrides?: DeepPartial<ModelOverrideSummary>
): ModelOverrideSummary {
  const base: ModelOverrideSummary = {
    personalityId: DEFAULT_PERSONALITY_ID,
    personalityName: 'TestPersonality',
    configId: DEFAULT_CONFIG_ID,
    configName: 'TestConfig',
  };
  return deepMerge(base, overrides);
}

/** Create a base user default config object */
function createBaseUserDefaultConfig(
  overrides?: DeepPartial<UserDefaultConfig>
): UserDefaultConfig {
  const base: UserDefaultConfig = {
    configId: DEFAULT_CONFIG_ID,
    configName: 'TestConfig',
  };
  return deepMerge(base, overrides);
}

// ============================================================================
// List Model Overrides (GET /user/model-override)
// ============================================================================

/**
 * Create a validated mock for GET /user/model-override
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockListModelOverridesResponse(
  overrides?: DeepPartial<ModelOverrideSummary>[]
): ListModelOverridesResponse {
  const defaultList = [createBaseModelOverrideSummary()];

  return ListModelOverridesResponseSchema.parse({
    overrides: overrides?.map(o => createBaseModelOverrideSummary(o)) ?? defaultList,
  });
}

// ============================================================================
// Set Model Override (PUT /user/model-override)
// ============================================================================

/**
 * Create a validated mock for PUT /user/model-override
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockSetModelOverrideResponse(
  overrides?: DeepPartial<SetModelOverrideResponse>
): SetModelOverrideResponse {
  const base: SetModelOverrideResponse = {
    override: createBaseModelOverrideSummary(),
  };
  return SetModelOverrideResponseSchema.parse(deepMerge(base, overrides));
}

// ============================================================================
// Set Default Config (PUT /user/model-override/default)
// ============================================================================

/**
 * Create a validated mock for PUT /user/model-override/default
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockSetDefaultConfigResponse(
  overrides?: DeepPartial<SetDefaultConfigResponse>
): SetDefaultConfigResponse {
  const base: SetDefaultConfigResponse = {
    default: createBaseUserDefaultConfig(),
  };
  return SetDefaultConfigResponseSchema.parse(deepMerge(base, overrides));
}

// ============================================================================
// Clear Default Config (DELETE /user/model-override/default)
// ============================================================================

/**
 * Create a validated mock for DELETE /user/model-override/default
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockClearDefaultConfigResponse(): ClearDefaultConfigResponse {
  return ClearDefaultConfigResponseSchema.parse({
    deleted: true,
  });
}

// ============================================================================
// Delete Model Override (DELETE /user/model-override/:personalityId)
// ============================================================================

/**
 * Create a validated mock for DELETE /user/model-override/:personalityId
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockDeleteModelOverrideResponse(): DeleteModelOverrideResponse {
  return DeleteModelOverrideResponseSchema.parse({
    deleted: true,
  });
}
