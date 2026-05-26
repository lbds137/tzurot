/**
 * Zod schemas for /user/history API endpoint inputs
 *
 * Validates request bodies for conversation history operations.
 */

import { z } from 'zod';

const PERSONALITY_SLUG_REQUIRED = 'personalitySlug is required';

// ============================================================================
// POST /user/history/clear
// ============================================================================

export const ClearHistorySchema = z.object({
  personalitySlug: z.string().min(1, PERSONALITY_SLUG_REQUIRED),
  personaId: z.string().optional(),
});
export type ClearHistoryInput = z.infer<typeof ClearHistorySchema>;

// ============================================================================
// POST /user/history/undo
// ============================================================================

export const UndoHistorySchema = z.object({
  personalitySlug: z.string().min(1, PERSONALITY_SLUG_REQUIRED),
  personaId: z.string().optional(),
});
export type UndoHistoryInput = z.infer<typeof UndoHistorySchema>;

// ============================================================================
// DELETE /user/history/hard-delete
// ============================================================================

export const HardDeleteHistorySchema = z.object({
  personalitySlug: z.string().min(1, PERSONALITY_SLUG_REQUIRED),
  channelId: z.string().min(1, 'channelId is required'),
  personaId: z.string().optional(),
});
export type HardDeleteHistoryInput = z.infer<typeof HardDeleteHistorySchema>;

// ============================================================================
// GET /user/history/stats (query params)
// ============================================================================

export const HistoryStatsQuerySchema = z.object({
  personalitySlug: z.string().min(1, 'personalitySlug query parameter is required'),
  channelId: z.string().min(1, 'channelId query parameter is required'),
  personaId: z.string().optional(),
});
export type HistoryStatsQueryInput = z.infer<typeof HistoryStatsQuerySchema>;

// ============================================================================
// Response schemas
// ============================================================================

/** POST /user/history/clear */
export const ClearHistoryResponseSchema = z.object({
  success: z.literal(true),
  epoch: z.string(),
  personaId: z.string(),
  canUndo: z.boolean(),
  message: z.string(),
});
export type ClearHistoryResponse = z.infer<typeof ClearHistoryResponseSchema>;

/** POST /user/history/undo */
export const UndoHistoryResponseSchema = z.object({
  success: z.literal(true),
  restoredEpoch: z.string().nullable(),
  personaId: z.string(),
  message: z.string(),
});
export type UndoHistoryResponse = z.infer<typeof UndoHistoryResponseSchema>;

/** GET /user/history/stats */
export const HistoryStatsResponseSchema = z.object({
  channelId: z.string(),
  personalitySlug: z.string(),
  personaId: z.string(),
  personaName: z.string(),
  visible: z.object({
    totalMessages: z.number().int().nonnegative(),
    userMessages: z.number().int().nonnegative(),
    assistantMessages: z.number().int().nonnegative(),
    oldestMessage: z.string().nullable(),
    newestMessage: z.string().nullable(),
  }),
  hidden: z.object({
    count: z.number().int().nonnegative(),
  }),
  total: z.object({
    totalMessages: z.number().int().nonnegative(),
    oldestMessage: z.string().nullable(),
  }),
  contextEpoch: z.string().nullable(),
  canUndo: z.boolean(),
});
export type HistoryStatsResponse = z.infer<typeof HistoryStatsResponseSchema>;

/** DELETE /user/history/hard-delete */
export const HardDeleteHistoryResponseSchema = z.object({
  success: z.literal(true),
  deletedCount: z.number().int().nonnegative(),
  personaId: z.string(),
  message: z.string(),
});
export type HardDeleteHistoryResponse = z.infer<typeof HardDeleteHistoryResponseSchema>;
