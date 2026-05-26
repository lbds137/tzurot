/**
 * Zod schemas for /user/memory API endpoint inputs
 *
 * Validates request bodies for memory management operations.
 */

import { z } from 'zod';
import { PreviewTokenSchema, PurgeTokenSchema } from '../../routes/types.js';

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
// PUT /user/memory/:id/lock
// Sets the lock state explicitly (idempotent on retry, unlike the prior
// toggle-on-POST shape).
// ============================================================================

export const SetMemoryLockSchema = z.object({
  locked: z.boolean({ error: 'locked must be a boolean' }),
});
export type SetMemoryLockInput = z.infer<typeof SetMemoryLockSchema>;

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
// POST /user/memory/delete/preview
// Issues a short-lived PreviewToken bound to the supplied filter. The token
// is the only legal input to POST /user/memory/delete — the execute path
// then re-reads the filter server-side and cannot drift from the preview.
// ============================================================================

export const BatchDeletePreviewSchema = z.object({
  personalityId: z.string().min(1, PERSONALITY_ID_REQUIRED),
  personaId: z.string().optional(),
  timeframe: z.string().optional(),
});
export type BatchDeletePreviewInput = z.infer<typeof BatchDeletePreviewSchema>;

// ============================================================================
// POST /user/memory/delete
// Body is a token previously obtained from /memory/delete/preview. The
// filter that produced the preview is server-side under the token key.
// ============================================================================

export const BatchDeleteSchema = z.object({
  previewToken: PreviewTokenSchema,
});
export type BatchDeleteInput = z.infer<typeof BatchDeleteSchema>;

// ============================================================================
// POST /user/memory/purge/token
// Issues a short-lived PurgeToken after validating the confirmation phrase.
// ============================================================================

export const IssuePurgeTokenSchema = z.object({
  personalityId: z.string().min(1, PERSONALITY_ID_REQUIRED),
  confirmationPhrase: z.string().min(1, 'confirmationPhrase is required'),
});
export type IssuePurgeTokenInput = z.infer<typeof IssuePurgeTokenSchema>;

// ============================================================================
// POST /user/memory/purge
// Body is a token previously obtained from /memory/purge/token. The
// personality binding is server-side under the token key.
// ============================================================================

export const PurgeMemoriesSchema = z.object({
  purgeToken: PurgeTokenSchema,
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
