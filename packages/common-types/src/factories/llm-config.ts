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

import { type DeepPartial } from './factoryUtils.js';

// ============================================================================
// Shared Defaults
// ============================================================================

// Fixed RFC-4122-valid UUID used as the factory default. The response-schema
// tightening added in the same PR as this factory rejects non-UUID ids at
// `LlmConfigSummarySchema.parse()`, so `'config-123'` no longer works. A
// hardcoded shape (version=4, variant=8) keeps the factory deterministic
// without pulling in a generator dependency for test fixtures.
const MOCK_DEFAULT_ID = '00000000-0000-4000-8000-000000000000';

const defaultLlmConfigSummary: LlmConfigSummary = {
  id: MOCK_DEFAULT_ID,
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
 *
 * Permissions are derived from isOwned if not explicitly set:
 * - isOwned: true → canEdit: true, canDelete: true
 * - isOwned: false → canEdit: false, canDelete: false
 */
export function mockLlmConfigSummary(
  overrides: DeepPartial<LlmConfigSummary> = {}
): LlmConfigSummary {
  // Derive permissions from isOwned if not explicitly provided
  const isOwned = overrides.isOwned ?? defaultLlmConfigSummary.isOwned;
  const defaultPermissions = {
    canEdit: isOwned,
    canDelete: isOwned,
  };

  // Handle permissions merge specifically to avoid DeepPartial making fields optional
  const permissions = {
    ...defaultPermissions,
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
        // Stable per-index RFC-4122-valid UUID (variant=8, version=4,
        // last 12 hex digits derived from the index). Keeps list
        // fixtures deterministic across runs and unique per entry.
        id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
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
