/**
 * Zod schemas for /user/history API endpoint inputs
 *
 * Validates request bodies for conversation history operations.
 */

import { z } from 'zod';
import { EDIT_RESPONSE_MAX_CONTENT_LENGTH } from '../../constants/discord.js';

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
  /**
   * How many previously-hidden messages became visible again as a result of
   * the undo. Zero means the pre-clear history is gone (e.g. a channel-wide
   * purge by another user removed the rows the epoch swap would have
   * uncovered), even though the undo itself succeeded.
   * Soft-deleted rows are excluded, matching the predicates that decide
   * whether a message is visible in conversation history.
   * The count covers the epoch band only: a channel whose max-age window is
   * shorter than that band still hides some of these rows in that channel.
   */
  restoredCount: z.number().int().nonnegative(),
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

/**
 * Why an exchange's memory cannot be rewritten to follow an edit. `locked` is
 * the edited user's own memory; `other-locked` is another user's memory of the
 * same (coalesced) reply.
 */
export const MemorySyncBlockReasonSchema = z.enum([
  'locked',
  'other-locked',
  'chunked',
  'ambiguous',
  'off-template',
  'reply-off-template',
]);

/**
 * GET /user/history/editable/:messageId
 *
 * The stored text of an assistant reply the caller may edit, looked up by any
 * of the reply's Discord chunk message IDs. `discordMessageIds` is the full
 * chunk list in send order, so the bot can edit every chunk of a split reply.
 * A 404 means no row matched OR the row is not the caller's (existence is
 * deliberately hidden, as with the reasoning lookup).
 */
export const EditableMessageResponseSchema = z.object({
  /** The stored reply text, without bot-added footers or DM prefixes. */
  content: z.string(),
  /** Every Discord message id the reply was delivered as, in send order. */
  discordMessageIds: z.array(z.string()).min(1),
  personalityId: z.string(),
  /** Whether the exchange's memory can follow an edit; `blocked` forbids the edit. */
  memorySync: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('sync') }),
    z.object({ kind: z.literal('blocked'), reason: MemorySyncBlockReasonSchema }),
  ]),
});

/** A submitted reply text: shared by the edit-check and the PATCH. */
const EditContentSchema = z
  .string()
  .min(1)
  .max(EDIT_RESPONSE_MAX_CONTENT_LENGTH)
  .refine(s => s.trim().length > 0, { message: 'Content cannot be blank' });

/**
 * POST /user/history/message/:messageId/edit-check
 *
 * Asks, before Discord is touched, whether the exchange's memory can follow an
 * edit to `content`. Answers with the editable payload, its `memorySync`
 * planned against the real stored texts and the new content.
 */
export const EditCheckRequestSchema = z.object({
  content: EditContentSchema,
});

/**
 * PATCH /user/history/message/:messageId
 *
 * Replaces the stored text of an assistant reply after the bot has edited the
 * Discord message(s). `discordMessageIds` is the chunk list as it stands after
 * the edit (chunks may have been added or removed).
 */
export const EditAssistantMessageRequestSchema = z.object({
  content: EditContentSchema,
  discordMessageIds: z
    .array(z.string().regex(/^\d{17,20}$/, 'Must be a Discord snowflake'))
    .min(1)
    .max(20)
    .refine(ids => new Set(ids).size === ids.length, {
      message: 'Message ids must be unique',
    }),
});

/** PATCH /user/history/message/:messageId response. */
export const EditAssistantMessageResponseSchema = z.object({
  edited: z.literal(true),
  /**
   * `synced`: memory and/or pending memory rewritten; `none`: nothing to sync;
   * `blocked`: only reachable through a race after the preflight (the history
   * row is saved, the memory is left as-is); `failed`: the history row is
   * saved but a planned memory row could not be written (vanished, no longer
   * rewritable, or the write threw).
   */
  memory: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('synced') }),
    z.object({ kind: z.literal('failed') }),
    z.object({ kind: z.literal('blocked'), reason: MemorySyncBlockReasonSchema }),
  ]),
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
