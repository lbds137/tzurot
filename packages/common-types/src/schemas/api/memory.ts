/**
 * Zod schemas for /user/memory API endpoint inputs
 *
 * Validates request bodies for memory management operations.
 */

import { z } from 'zod';

const PERSONALITY_ID_REQUIRED = 'personalityId is required';

// ============================================================================
// Branded token types (preview / purge confirmation)
// ============================================================================

/**
 * Branded type for previewed-then-execute batch operations.
 *
 * `GET /memory/delete/preview` issues a `PreviewToken` (short-lived,
 * server-side Redis-backed) along with the impact summary. `POST
 * /memory/delete` consumes the token — the filter that produced the
 * preview is stored server-side under the token key, so the execute path
 * can't drift from the preview path.
 *
 * Branding means callers can't accidentally pass an arbitrary string —
 * they must obtain a real token from the preview endpoint first.
 */
export const PreviewTokenSchema = z
  .string()
  .regex(/^preview_[A-Za-z0-9_-]{16,64}$/, 'Invalid preview token format')
  .brand<'PreviewToken'>();
/**
 * Branded type for purge confirmation. Same shape as `PreviewToken` but
 * a distinct brand so callers can't pass a delete-preview token to a
 * purge endpoint (or vice versa) by accident.
 */
export const PurgeTokenSchema = z
  .string()
  .regex(/^purge_[A-Za-z0-9_-]{16,64}$/, 'Invalid purge token format')
  .brand<'PurgeToken'>();
// ============================================================================
// POST /user/memory/focus
// ============================================================================

export const FocusModeSchema = z.object({
  personalityId: z.string().min(1, PERSONALITY_ID_REQUIRED),
  enabled: z.boolean({ error: 'enabled must be a boolean' }),
});
// ============================================================================
// PUT /user/memory/:id/lock
// Sets the lock state explicitly (idempotent on retry, unlike the prior
// toggle-on-POST shape).
// ============================================================================

export const SetMemoryLockSchema = z.object({
  locked: z.boolean({ error: 'locked must be a boolean' }),
});
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
// ============================================================================
// POST /user/memory/purge/token
// Issues a short-lived PurgeToken after validating the confirmation phrase.
// ============================================================================

export const IssuePurgeTokenSchema = z.object({
  personalityId: z.string().min(1, PERSONALITY_ID_REQUIRED),
  confirmationPhrase: z.string().min(1, 'confirmationPhrase is required'),
});
// ============================================================================
// POST /user/memory/purge
// Body is a token previously obtained from /memory/purge/token. The
// personality binding is server-side under the token key.
// ============================================================================

export const PurgeMemoriesSchema = z.object({
  purgeToken: PurgeTokenSchema,
});
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
  // ISO-8601 datetime with timezone offset (Z or ±HH:MM required — Zod's
  // `{ offset: true }` accepts non-Z offsets but the offset itself is
  // mandatory). Caller's bad-date input fails Zod at the gateway before
  // reaching the handler's own validateDateFilters — the handler still
  // defends against the (now-impossible) bad-date path with a friendlier
  // 400 wording.
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
  preferTextSearch: z.boolean().optional(),
});
// ============================================================================
// Response schemas — used by RouteDef.output to give generated clients
// runtime validation + correct return-type inference.
// ============================================================================

/** Shared shape for a single memory row in responses (single, list, search). */
export const MemoryItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  // ISO-8601 timestamps — handlers always emit via `.toISOString()`; the
  // schema constraint self-documents that contract and catches any future
  // regression where a raw Date or non-ISO string slips into the response.
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
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

/** POST /user/memory/focus */
export const SetFocusResponseSchema = z.object({
  personalityId: z.string(),
  personalityName: z.string(),
  focusModeEnabled: z.boolean(),
  message: z.string(),
});

/** Search result row: MemoryItem extended with a per-row similarity score
 *  (null when the response falls back to text search). The wrapping
 *  `MemorySearchResponseSchema` carries `searchType` for the whole batch. */
export const MemorySearchResultSchema = MemoryItemSchema.extend({
  similarity: z.number().nullable(),
});

/** POST /user/memory/search */
export const MemorySearchResponseSchema = z.object({
  results: z.array(MemorySearchResultSchema),
  count: z.number(),
  hasMore: z.boolean(),
  searchType: z.enum(['semantic', 'text']).optional(),
});

/** POST /user/memory/delete/preview */
export const BatchDeletePreviewResponseSchema = z.object({
  wouldDelete: z.number(),
  lockedWouldSkip: z.number(),
  personalityId: z.string(),
  personalityName: z.string(),
  timeframe: z.string(),
  // Brand here so the round-trip preview-token → batchDelete call site is
  // type-checked end-to-end: the response carries a `PreviewToken`, and
  // BatchDeleteSchema's input expects the same brand. Plain `z.string()`
  // would let a caller paste any string into the next call.
  previewToken: PreviewTokenSchema,
});

/** POST /user/memory/delete */
export const BatchDeleteResponseSchema = z.object({
  deletedCount: z.number(),
  skippedLocked: z.number(),
  personalityId: z.string().optional(),
  personalityName: z.string().optional(),
  message: z.string(),
});

/** POST /user/memory/purge/token */
export const IssuePurgeTokenResponseSchema = z.object({
  // Branded so the round-trip purge-token → purge call site is type-checked
  // end-to-end (mirrors the batchDelete/previewToken pair above).
  purgeToken: PurgeTokenSchema,
  personalityId: z.string(),
  personalityName: z.string(),
});

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

/** DELETE /user/memory/:id */
export const DeleteMemoryResponseSchema = z.object({
  success: z.boolean(),
});
