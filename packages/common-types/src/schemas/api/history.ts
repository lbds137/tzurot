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

// ============================================================================
// POST /user/history/undo
// ============================================================================

export const UndoHistorySchema = z.object({
  personalitySlug: z.string().min(1, PERSONALITY_SLUG_REQUIRED),
  personaId: z.string().optional(),
});

// ============================================================================
// DELETE /user/history/hard-delete
// ============================================================================

export const HardDeleteHistorySchema = z.object({
  personalitySlug: z.string().min(1, PERSONALITY_SLUG_REQUIRED),
  channelId: z.string().min(1, 'channelId is required'),
  personaId: z.string().optional(),
  /**
   * Whose history to delete. 'own' (the default) deletes only the caller's
   * persona's rows; 'everyone' deletes every user's rows for this character in
   * this channel. Discord permissions are not visible here — bot-client owns
   * the authorization for 'everyone' (see the route's design note).
   */
  scope: z.enum(['own', 'everyone']).default('own'),
});

// ============================================================================
// GET /user/history/stats (query params)
// ============================================================================

export const HistoryStatsQuerySchema = z.object({
  personalitySlug: z.string().min(1, 'personalitySlug query parameter is required'),
  channelId: z.string().min(1, 'channelId query parameter is required'),
  personaId: z.string().optional(),
});

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

/** POST /user/history/undo */
export const UndoHistoryResponseSchema = z.object({
  success: z.literal(true),
  restoredEpoch: z.string().nullable(),
  personaId: z.string(),
  message: z.string(),
});

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

/**
 * GET /user/history/reasoning/:messageId
 *
 * The persisted reasoning trace for one assistant turn, looked up by any of
 * the turn's Discord chunk message IDs. `thinkingContent` is null when the row
 * exists but carries no trace (the model produced none, or the row predates
 * trace persistence) — distinct from a 404, which means no row matched OR the
 * row is not the caller's. That 404-not-403 collapse is deliberate: it hides
 * the existence of other users' turns.
 */
export const MessageReasoningResponseSchema = z.object({
  thinkingContent: z.string().nullable(),
  /** ISO timestamp of the assistant row — the trace's age, for the retention hint. */
  createdAt: z.string().datetime(),
});

/** DELETE /user/history/hard-delete */
export const HardDeleteHistoryResponseSchema = z.object({
  success: z.literal(true),
  deletedCount: z.number().int().nonnegative(),
  /**
   * The persona whose history was deleted. NULL means the purge was
   * channel-wide (`scope: 'everyone'`) — no single persona describes it.
   */
  personaId: z.string().nullable(),
  message: z.string(),
  scope: z.enum(['own', 'everyone']),
});
