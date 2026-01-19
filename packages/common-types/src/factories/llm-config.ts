/**
 * Validated Mock Factories for LLM Config API Endpoints
 *
 * These factories create mock data that is VALIDATED against Zod schemas.
 * If a test tries to mock an invalid shape, the test will CRASH immediately.
 *
 * Usage:
 *   import { mockListLlmConfigsResponse } from '@tzurot/common-types/factories';
 *   mockCallGatewayApi.mockResolvedValue({
 *     ok: true,
 *     data: mockListLlmConfigsResponse({ configs: [{ name: 'My Config' }] }),
 *   });
 */

import {
  LlmConfigSummarySchema,
  ListLlmConfigsResponseSchema,
  CreateLlmConfigResponseSchema,
  DeleteLlmConfigResponseSchema,
  type ListLlmConfigsResponse,
  type CreateLlmConfigResponse,
  type DeleteLlmConfigResponse,
} from '../schemas/api/llm-config.js';
import { z } from 'zod';

type LlmConfigSummary = z.infer<typeof LlmConfigSummarySchema>;

// ============================================================================
// Type Utilities
// ============================================================================

type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

// ============================================================================
// Shared Defaults
// ============================================================================

const defaultLlmConfigSummary: LlmConfigSummary = {
  id: 'config-123',
  name: 'Default Config',
  description: null,
  provider: 'openrouter',
  model: 'openai/gpt-4o-mini',
  visionModel: null,
  isGlobal: true,
  isDefault: true,
  isOwned: false,
  permissions: { canEdit: false, canDelete: false },
};

/**
 * Create a validated mock LLM config summary
 */
export function mockLlmConfigSummary(
  overrides: DeepPartial<LlmConfigSummary> = {}
): LlmConfigSummary {
  // Handle permissions merge specifically to avoid DeepPartial making fields optional
  const permissions = {
    ...defaultLlmConfigSummary.permissions,
    ...(overrides.permissions ?? {}),
  };

  const merged: LlmConfigSummary = {
    ...defaultLlmConfigSummary,
    ...overrides,
    permissions,
  };
  return LlmConfigSummarySchema.parse(merged);
}

// ============================================================================
// GET /user/llm-config
// ============================================================================

/**
 * Create a validated mock for GET /user/llm-config response
 * @param configs - Array of config summaries or partial overrides
 * @returns Validated ListLlmConfigsResponse
 * @throws ZodError if the resulting object doesn't match the schema
 */
export function mockListLlmConfigsResponse(
  configs: DeepPartial<LlmConfigSummary>[] = []
): ListLlmConfigsResponse {
  const response: ListLlmConfigsResponse = {
    configs: configs.map((c, i) =>
      mockLlmConfigSummary({
        id: `config-${i}`,
        ...c,
      })
    ),
  };
  return ListLlmConfigsResponseSchema.parse(response);
}

// ============================================================================
// POST /user/llm-config
// ============================================================================

/**
 * Create a validated mock for POST /user/llm-config response
 * @param overrides - Partial overrides for the config
 * @returns Validated CreateLlmConfigResponse
 * @throws ZodError if the resulting object doesn't match the schema
 */
export function mockCreateLlmConfigResponse(
  overrides: DeepPartial<LlmConfigSummary> = {}
): CreateLlmConfigResponse {
  const response: CreateLlmConfigResponse = {
    config: mockLlmConfigSummary({
      isGlobal: false,
      isDefault: false,
      isOwned: true,
      permissions: { canEdit: true, canDelete: true }, // User owns their created config
      ...overrides,
    }),
  };
  return CreateLlmConfigResponseSchema.parse(response);
}

// ============================================================================
// DELETE /user/llm-config/:id
// ============================================================================

/**
 * Create a validated mock for DELETE /user/llm-config/:id response
 * @returns Validated DeleteLlmConfigResponse
 * @throws ZodError if the resulting object doesn't match the schema
 */
export function mockDeleteLlmConfigResponse(): DeleteLlmConfigResponse {
  return DeleteLlmConfigResponseSchema.parse({ deleted: true });
}
