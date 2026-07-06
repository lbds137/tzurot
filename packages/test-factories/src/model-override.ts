/**
 * Validated mock factories for model-override API responses. Each factory
 * runs the produced mock through its Zod schema, so a stale-shape mock
 * fails at test time instead of silently passing.
 */

import {
  type ModelOverrideSummary,
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
} from '@tzurot/common-types/schemas/api/model-override';

// Default UUIDs for consistent test data (RFC 4122 compliant v5 UUIDs)
const DEFAULT_PERSONALITY_ID = '11111111-1111-5111-8111-111111111111';
const DEFAULT_CONFIG_ID = '33333333-3333-5333-8333-333333333333';

import { type DeepPartial, deepMerge } from './factoryUtils.js';

// ============================================================================
// Helper Functions
// ============================================================================

/** Create a base model override summary object */
function createBaseModelOverrideSummary(
  overrides?: DeepPartial<ModelOverrideSummary>
): ModelOverrideSummary {
  const base: ModelOverrideSummary = {
    personalityId: DEFAULT_PERSONALITY_ID,
    personalityName: 'TestPersonality',
    configId: DEFAULT_CONFIG_ID,
    configName: 'TestConfig',
    slot: 'text',
    supportsVision: false,
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
 * Create a validated mock for DELETE /user/model-override/default.
 * Default is `newEffectiveDefaults: {}` (no slot cleared) — pass overrides to
 * populate per-slot fallbacks, e.g. `{ newEffectiveDefaults: { text: null } }`.
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockClearDefaultConfigResponse(
  overrides: Partial<ClearDefaultConfigResponse> = {}
): ClearDefaultConfigResponse {
  return ClearDefaultConfigResponseSchema.parse({
    deleted: true,
    newEffectiveDefaults: {},
    ...overrides,
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
