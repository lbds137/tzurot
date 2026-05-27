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

// ============================================================================
// Response schemas — used by RouteDef.output to give generated clients
// runtime validation + correct return-type inference.
// ============================================================================

/** Shared shape for a single memory row in responses (single, list, search). */
export const MemoryItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  personalityId: z.string(),
  personalityName: z.string(),
  isLocked: z.boolean(),
});
export type MemoryItem = z.infer<typeof MemoryItemSchema>;

/** GET /user/memory/stats */
export const MemoryStatsResponseSchema = z.object({
  personalityId: z.string(),
  personalityName: z.string(),
  personaId: z.string().nullable(),
  totalCount: z.number(),
  lockedCount: z.number(),
  oldestMemory: z.string().nullable(),
  newestMemory: z.string().nullable(),
  focusModeEnabled: z.boolean(),
});
export type MemoryStatsResponse = z.infer<typeof MemoryStatsResponseSchema>;

/** GET /user/memory/list */
export const MemoryListResponseSchema = z.object({
  memories: z.array(MemoryItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});
export type MemoryListResponse = z.infer<typeof MemoryListResponseSchema>;

/** GET /user/memory/focus */
export const FocusModeStatusResponseSchema = z.object({
  personalityId: z.string(),
  focusModeEnabled: z.boolean(),
});
export type FocusModeStatusResponse = z.infer<typeof FocusModeStatusResponseSchema>;

/** POST /user/memory/focus */
export const SetFocusResponseSchema = z.object({
  personalityId: z.string(),
  personalityName: z.string(),
  focusModeEnabled: z.boolean(),
  message: z.string(),
});
export type SetFocusResponse = z.infer<typeof SetFocusResponseSchema>;

/** Search result row: MemoryItem extended with similarity + search type. */
export const MemorySearchResultSchema = MemoryItemSchema.extend({
  similarity: z.number().nullable(),
});
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>;

/** POST /user/memory/search */
export const MemorySearchResponseSchema = z.object({
  results: z.array(MemorySearchResultSchema),
  count: z.number(),
  hasMore: z.boolean(),
  searchType: z.enum(['semantic', 'text']).optional(),
});
export type MemorySearchResponse = z.infer<typeof MemorySearchResponseSchema>;

/** POST /user/memory/delete/preview */
export const BatchDeletePreviewResponseSchema = z.object({
  wouldDelete: z.number(),
  lockedWouldSkip: z.number(),
  personalityId: z.string(),
  personalityName: z.string(),
  timeframe: z.string(),
  previewToken: z.string(),
});
export type BatchDeletePreviewResponse = z.infer<typeof BatchDeletePreviewResponseSchema>;

/** POST /user/memory/delete */
export const BatchDeleteResponseSchema = z.object({
  deletedCount: z.number(),
  skippedLocked: z.number(),
  personalityId: z.string().optional(),
  personalityName: z.string().optional(),
  message: z.string(),
});
export type BatchDeleteResponse = z.infer<typeof BatchDeleteResponseSchema>;

/** POST /user/memory/purge/token */
export const IssuePurgeTokenResponseSchema = z.object({
  purgeToken: z.string(),
  personalityId: z.string(),
  personalityName: z.string(),
});
export type IssuePurgeTokenResponse = z.infer<typeof IssuePurgeTokenResponseSchema>;

/** POST /user/memory/purge */
export const PurgeMemoriesResponseSchema = z.object({
  deletedCount: z.number(),
  lockedPreserved: z.number(),
  personalityId: z.string(),
  personalityName: z.string(),
  message: z.string(),
});
export type PurgeMemoriesResponse = z.infer<typeof PurgeMemoriesResponseSchema>;

/**
 * GET /user/memory/:id  ·  PATCH /user/memory/:id  ·  PUT /user/memory/:id/lock
 * All three return the same `{ memory }` envelope.
 */
export const SingleMemoryResponseSchema = z.object({
  memory: MemoryItemSchema,
});
export type SingleMemoryResponse = z.infer<typeof SingleMemoryResponseSchema>;

/** DELETE /user/memory/:id */
export const DeleteMemoryResponseSchema = z.object({
  success: z.boolean(),
});
export type DeleteMemoryResponse = z.infer<typeof DeleteMemoryResponseSchema>;
