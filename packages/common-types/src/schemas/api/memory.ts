/**
 * Zod schemas for /user/memory API endpoint inputs
 *
 * Validates request bodies for memory management operations.
 */

import { z } from 'zod';

const PERSONALITY_ID_REQUIRED = 'personalityId is required';

// ============================================================================
// POST /user/memory/focus
// ============================================================================

export const FocusModeSchema = z.object({
  personalityId: z.string().min(1, PERSONALITY_ID_REQUIRED),
  enabled: z.boolean({ error: 'enabled must be a boolean' }),
});
export type FocusModeInput = z.infer<typeof FocusModeSchema>;

// ============================================================================
// PATCH /user/memory/:id
// ============================================================================

/** Maximum content length for memory updates */
const MAX_MEMORY_CONTENT_LENGTH = 2000;

export const MemoryUpdateSchema = z.object({
  content: z
    .string()
    .min(1, 'Content is required')
    .max(
      MAX_MEMORY_CONTENT_LENGTH,
      `Content exceeds maximum length of ${MAX_MEMORY_CONTENT_LENGTH}`
    )
    .transform(s => s.trim())
    .pipe(z.string().min(1, 'Content is required')),
});
export type MemoryUpdateInput = z.infer<typeof MemoryUpdateSchema>;

// ============================================================================
// POST /user/memory/delete
// ============================================================================

export const BatchDeleteSchema = z.object({
  personalityId: z.string().min(1, PERSONALITY_ID_REQUIRED),
  personaId: z.string().optional(),
  timeframe: z.string().optional(),
});
export type BatchDeleteInput = z.infer<typeof BatchDeleteSchema>;

// ============================================================================
// POST /user/memory/purge
// ============================================================================

export const PurgeMemoriesSchema = z.object({
  personalityId: z.string().min(1, PERSONALITY_ID_REQUIRED),
  confirmationPhrase: z.string().optional(),
});
export type PurgeMemoriesInput = z.infer<typeof PurgeMemoriesSchema>;

// ============================================================================
// POST /user/memory/search
// ============================================================================

const MAX_QUERY_LENGTH = 500;

export const MemorySearchSchema = z.object({
  query: z
    .string()
    .min(1, 'query is required')
    .max(MAX_QUERY_LENGTH, `query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`),
  personalityId: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  preferTextSearch: z.boolean().optional(),
});
export type MemorySearchInput = z.infer<typeof MemorySearchSchema>;
