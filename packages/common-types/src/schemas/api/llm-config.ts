/**
 * Zod schemas for /user/llm-config API endpoints
 *
 * These schemas define the contract between api-gateway and bot-client.
 * BOTH services should import these to ensure type safety.
 *
 * Usage:
 * - Gateway: Use schema.parse(response) before sending
 * - Bot-client tests: Use factories from @tzurot/common-types/factories
 */

import { z } from 'zod';
import { EntityPermissionsSchema } from './shared.js';

// ============================================================================
// Shared Sub-schemas
// ============================================================================

/**
 * Summary of an LLM configuration
 * Matches LlmConfigSummary type from types/byok.ts
 */
export const LlmConfigSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  visionModel: z.string().nullable(),
  isGlobal: z.boolean(),
  isDefault: z.boolean(),
  isOwned: z.boolean(),
  permissions: EntityPermissionsSchema,
});

// ============================================================================
// GET /user/llm-config
// Returns list of visible configs (global + user-owned)
// ============================================================================

export const ListLlmConfigsResponseSchema = z.object({
  configs: z.array(LlmConfigSummarySchema),
});
export type ListLlmConfigsResponse = z.infer<typeof ListLlmConfigsResponseSchema>;

// ============================================================================
// POST /user/llm-config
// Creates a new user-owned config
// ============================================================================

export const CreateLlmConfigResponseSchema = z.object({
  config: LlmConfigSummarySchema,
});
export type CreateLlmConfigResponse = z.infer<typeof CreateLlmConfigResponseSchema>;

// ============================================================================
// DELETE /user/llm-config/:id
// Deletes a user-owned config
// ============================================================================

export const DeleteLlmConfigResponseSchema = z.object({
  deleted: z.literal(true),
});
export type DeleteLlmConfigResponse = z.infer<typeof DeleteLlmConfigResponseSchema>;
