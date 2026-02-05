/**
 * Zod schemas for LLM Config API endpoints
 *
 * These schemas define the contract between api-gateway and bot-client.
 * BOTH services should import these to ensure type safety.
 *
 * Includes:
 * - Input schemas for create/update operations (shared between admin and user)
 * - Response schemas for GET operations
 *
 * Usage:
 * - Gateway: Use schema.parse(response) before sending
 * - Bot-client tests: Use factories from @tzurot/common-types/factories
 */

import { z } from 'zod';
import { EntityPermissionsSchema, optionalString, nullableString } from './shared.js';
import { AdvancedParamsSchema } from '../llmAdvancedParams.js';
import { MESSAGE_LIMITS, AI_DEFAULTS } from '../../constants/index.js';

// ============================================================================
// Context Settings Schema (shared validation for context history limits)
// ============================================================================

/**
 * Context settings sub-schema - used by both create and update handlers.
 * Validation bounds prevent DoS via excessive history fetch.
 *
 * Fields:
 * - maxMessages: 1-100 (capped at MAX_EXTENDED_CONTEXT)
 * - maxImages: 0-20 (0 disables image processing, capped at MAX_CONTEXT_IMAGES)
 * - maxAge: 1-2592000 (30 days) or null (null = no time limit)
 */
export const ContextSettingsSchema = z.object({
  maxMessages: z
    .number()
    .int()
    .min(1, 'maxMessages must be at least 1')
    .max(
      MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT,
      `maxMessages cannot exceed ${MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT}`
    )
    .optional(),
  maxAge: z
    .number()
    .int()
    .min(1, 'maxAge must be at least 1 second, or omit/set to null for no time limit')
    .max(
      MESSAGE_LIMITS.MAX_CONTEXT_AGE,
      `maxAge cannot exceed ${MESSAGE_LIMITS.MAX_CONTEXT_AGE} seconds (30 days)`
    )
    .optional()
    .nullable(),
  maxImages: z
    .number()
    .int()
    .min(0, 'maxImages must be at least 0 (0 disables image processing)')
    .max(
      MESSAGE_LIMITS.MAX_CONTEXT_IMAGES,
      `maxImages cannot exceed ${MESSAGE_LIMITS.MAX_CONTEXT_IMAGES}`
    )
    .optional(),
});

export type ContextSettings = z.infer<typeof ContextSettingsSchema>;

// ============================================================================
// Input Schemas (shared between admin and user endpoints)
// ============================================================================

/**
 * Schema for creating a new LLM config.
 *
 * This is the unified schema for both admin and user create operations.
 * The difference in behavior (isGlobal, ownerId) is handled by the service layer.
 *
 * All sampling/reasoning params go into advancedParameters JSONB.
 */
export const LlmConfigCreateSchema = z.object({
  // Required fields
  name: z.string().min(1, 'name is required').max(100, 'name must be 100 characters or less'),
  model: z.string().min(1, 'model is required').max(200),

  // Optional string fields
  description: z.string().max(500).optional().nullable(),
  provider: z.string().max(50).optional(),
  visionModel: z.string().max(200).optional().nullable(),

  // AI behavior settings
  maxReferencedMessages: z.number().int().positive().optional(),
  advancedParameters: AdvancedParamsSchema.optional(),

  // Memory settings (previously missing from admin endpoints)
  memoryScoreThreshold: z.number().min(0).max(1).optional().nullable(),
  memoryLimit: z.number().int().positive().optional().nullable(),
  // contextWindowTokens min(1000) is intentional - reasonable minimum for context windows
  contextWindowTokens: z.number().int().min(1000).optional(),

  // Context settings (conversation history limits)
  ...ContextSettingsSchema.shape,
});

export type LlmConfigCreateInput = z.infer<typeof LlmConfigCreateSchema>;

/**
 * Schema for updating an existing LLM config.
 *
 * Uses empty-to-undefined transforms so clients can send "" to "not update" a field.
 * This is the standard pattern for handling form inputs where clearing a field
 * sends empty string instead of omitting the field.
 */
export const LlmConfigUpdateSchema = z.object({
  // Required DB fields: empty string → undefined (preserve existing value)
  name: optionalString(100),
  provider: optionalString(50),
  model: optionalString(200),

  // Nullable DB fields: empty string → null (clear the value)
  description: nullableString(500),
  visionModel: nullableString(200),

  // AI behavior settings
  maxReferencedMessages: z.number().int().positive().optional(),
  advancedParameters: AdvancedParamsSchema.optional(),

  // Memory settings
  memoryScoreThreshold: z.number().min(0).max(1).optional().nullable(),
  memoryLimit: z.number().int().positive().optional().nullable(),
  contextWindowTokens: z.number().int().min(1000).optional(),

  // Context settings (shared validation)
  ...ContextSettingsSchema.shape,

  /** Toggle global visibility - users can share their presets */
  isGlobal: z.boolean().optional(),
});

export type LlmConfigUpdateInput = z.infer<typeof LlmConfigUpdateSchema>;

// ============================================================================
// Prisma SELECT constants
// ============================================================================

/**
 * Select fields for list queries (summary data).
 * Used when returning arrays of configs.
 */
export const LLM_CONFIG_LIST_SELECT = {
  id: true,
  name: true,
  description: true,
  provider: true,
  model: true,
  visionModel: true,
  isGlobal: true,
  isDefault: true,
  isFreeDefault: true,
  ownerId: true,
} as const;

/**
 * Select fields for detail queries (includes all editable fields).
 * Used when returning a single config with full details.
 */
export const LLM_CONFIG_DETAIL_SELECT = {
  ...LLM_CONFIG_LIST_SELECT,
  advancedParameters: true,
  maxReferencedMessages: true,
  // Memory settings
  memoryScoreThreshold: true,
  memoryLimit: true,
  contextWindowTokens: true,
  // Context settings
  maxMessages: true,
  maxAge: true,
  maxImages: true,
} as const;

// ============================================================================
// Default values (used when creating configs)
// ============================================================================

/**
 * Default values for LLM config fields.
 * Used by both admin and user routes for consistency.
 */
export const LLM_CONFIG_DEFAULTS = {
  provider: 'openrouter',
  maxReferencedMessages: AI_DEFAULTS.MAX_REFERENCED_MESSAGES,
  memoryScoreThreshold: AI_DEFAULTS.MEMORY_SCORE_THRESHOLD,
  memoryLimit: AI_DEFAULTS.MEMORY_LIMIT,
  contextWindowTokens: AI_DEFAULTS.CONTEXT_WINDOW_TOKENS,
  maxMessages: MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
  maxImages: MESSAGE_LIMITS.DEFAULT_MAX_IMAGES,
} as const;

// ============================================================================
// Response Schemas (existing - kept for backward compatibility)
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
