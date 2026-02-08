/**
 * History API Schemas
 *
 * Zod schemas for user history management endpoints (/user/history/*).
 */

import { z } from 'zod';

// ============================================================================
// User History API Schemas (/user/history/*)
// ============================================================================

/**
 * Request schema for POST /user/history/clear
 * Sets a context epoch to soft-reset conversation history
 */
export const historyClearRequestSchema = z.object({
  personalitySlug: z.string().min(1),
});

/**
 * Response schema for POST /user/history/clear
 */
export const historyClearResponseSchema = z.object({
  success: z.boolean(),
  epoch: z.string(), // ISO 8601 timestamp
  canUndo: z.boolean(),
  message: z.string(),
});

/**
 * Request schema for POST /user/history/undo
 * Restores the previous context epoch
 */
export const historyUndoRequestSchema = z.object({
  personalitySlug: z.string().min(1),
});

/**
 * Response schema for POST /user/history/undo
 */
export const historyUndoResponseSchema = z.object({
  success: z.boolean(),
  restoredEpoch: z.string().nullable(), // ISO 8601 timestamp or null
  message: z.string(),
});

/**
 * Query parameters schema for GET /user/history/stats
 */
export const historyStatsQuerySchema = z.object({
  personalitySlug: z.string().min(1),
  channelId: z.string().min(1),
});

/**
 * Response schema for GET /user/history/stats
 */
export const historyStatsResponseSchema = z.object({
  channelId: z.string(),
  personalitySlug: z.string(),
  visible: z.object({
    totalMessages: z.number(),
    userMessages: z.number(),
    assistantMessages: z.number(),
    oldestMessage: z.string().nullable(), // ISO 8601 timestamp or null
    newestMessage: z.string().nullable(), // ISO 8601 timestamp or null
  }),
  hidden: z.object({
    count: z.number(),
  }),
  total: z.object({
    totalMessages: z.number(),
    oldestMessage: z.string().nullable(), // ISO 8601 timestamp or null
  }),
  contextEpoch: z.string().nullable(), // ISO 8601 timestamp or null
  canUndo: z.boolean(),
});

/**
 * Request schema for DELETE /user/history/hard-delete
 * Permanently deletes conversation history
 */
export const historyHardDeleteRequestSchema = z.object({
  personalitySlug: z.string().min(1),
  channelId: z.string().min(1),
});

/**
 * Response schema for DELETE /user/history/hard-delete
 */
export const historyHardDeleteResponseSchema = z.object({
  success: z.boolean(),
  deletedCount: z.number(),
  message: z.string(),
});

// Infer TypeScript types from schemas
export type HistoryClearRequest = z.infer<typeof historyClearRequestSchema>;
export type HistoryClearResponse = z.infer<typeof historyClearResponseSchema>;
export type HistoryUndoRequest = z.infer<typeof historyUndoRequestSchema>;
export type HistoryUndoResponse = z.infer<typeof historyUndoResponseSchema>;
export type HistoryStatsQuery = z.infer<typeof historyStatsQuerySchema>;
export type HistoryStatsResponse = z.infer<typeof historyStatsResponseSchema>;
export type HistoryHardDeleteRequest = z.infer<typeof historyHardDeleteRequestSchema>;
export type HistoryHardDeleteResponse = z.infer<typeof historyHardDeleteResponseSchema>;
