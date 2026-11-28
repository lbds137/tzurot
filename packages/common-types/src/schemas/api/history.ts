/**
 * Zod schemas for /user/history API endpoint inputs
 *
 * Validates request bodies for conversation history operations.
 */

import { z } from 'zod';
import { incognitoKindSchema } from '../../types/schemas/message.js';
import {
  EDIT_RESPONSE_MAX_CONTENT_LENGTH,
  MAX_REPLY_CHUNKS,
  REROLL_MAX_CONTENT_LENGTH,
  REROLL_MAX_THINKING_LENGTH,
} from '../../constants/discord.js';

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

/** A reroll's new reply text: model output, bound by the chunk plan rather than the modal limit. */
const RerollContentSchema = z
  .string()
  .min(1)
  .max(REROLL_MAX_CONTENT_LENGTH)
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
    .max(MAX_REPLY_CHUNKS)
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

/** A Discord snowflake list: the chunk ids a reply was delivered as. */
const DiscordMessageIdListSchema = z
  .array(z.string().regex(/^\d{17,20}$/, 'Must be a Discord snowflake'))
  .min(1)
  .max(MAX_REPLY_CHUNKS)
  .refine(ids => new Set(ids).size === ids.length, {
    message: 'Message ids must be unique',
  });

/** Memory row ids a reroll names (bounded: a reply has a handful of memories). */
const RerollMemoryIdsSchema = z.array(z.string().min(1)).max(100);

/**
 * POST /user/history/message/:messageId/reroll-check
 *
 * The body is optional: the post-generation re-check passes the ids of the
 * memories the new reply just wrote, so the plan does not mistake them for
 * memories of the OLD reply.
 */
export const RerollCheckRequestSchema = z.object({
  excludeMemoryIds: RerollMemoryIdsSchema.optional(),
  excludePendingIds: RerollMemoryIdsSchema.optional(),
});

/**
 * What a reroll will remove from long-term memory. `remove` names the rows
 * (the bot echoes them back to the abort route so it never deletes them);
 * `blocked` forbids the reroll before any model call.
 */
export const RerollMemoryPlanSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('remove'),
    memoryIds: z.array(z.string()),
    pendingIds: z.array(z.string()),
  }),
  z.object({ kind: z.literal('blocked'), reason: MemorySyncBlockReasonSchema }),
]);

/** POST /user/history/message/:messageId/reroll-check response (reads only). */
export const RerollCheckResponseSchema = z.object({
  rowId: z.string(),
  personalityId: z.string(),
  personaId: z.string(),
  /** Discord id of the persona's owner: the user a reroll bills and speaks as. */
  ownerDiscordId: z.string(),
  /** The row's stored incognito state (`messageMetadata.incognito`); sticky on a reroll. */
  incognito: z.boolean(),
  /** The row's stored anonymity kind; absent on legacy rows (a reroll then runs anonymous). */
  incognitoKind: incognitoKindSchema.optional(),
  /** The stored reply text, without bot-added footers or DM prefixes. */
  content: z.string(),
  discordMessageIds: z.array(z.string()).min(1),
  /** The user row the reply answered; null when the reply was not triggered by a message. */
  trigger: z
    .object({
      discordMessageId: z.string(),
      content: z.string(),
      createdAt: z.string().datetime(),
    })
    .nullable(),
  memoryPlan: RerollMemoryPlanSchema,
});

/**
 * POST /user/history/message/:messageId/reroll
 *
 * Commits a reroll after the bot has edited the Discord message(s): the old
 * row is soft-deleted, the new one written, and the old reply's memories
 * removed, in one transaction.
 */
export const RerollAssistantMessageRequestSchema = z.object({
  rowId: z.string().min(1),
  attemptId: z.string().min(1),
  /** The generation job: the gateway reads the attempt's memory ids from its stored result. */
  jobId: z.string().min(1),
  content: RerollContentSchema,
  discordMessageIds: DiscordMessageIdListSchema,
  thinkingContent: z.string().max(REROLL_MAX_THINKING_LENGTH).nullable().optional(),
  incognito: z.boolean().optional(),
  /** How the incognito reply was anonymous; copied onto the new row. */
  incognitoKind: incognitoKindSchema.optional(),
  /**
   * Memories the new reply wrote; the commit must not treat them as the old
   * reply's. Fallback only: when the job's stored result vouches for this row
   * and attempt, the gateway uses its lists instead of these.
   */
  newMemoryIds: RerollMemoryIdsSchema,
  newPendingIds: RerollMemoryIdsSchema,
});

/** POST /user/history/message/:messageId/reroll response. */
export const RerollAssistantMessageResponseSchema = z.object({
  id: z.string(),
  removedMemories: z.number().int().nonnegative(),
});

/**
 * POST /user/history/message/:messageId/reroll-abort
 *
 * Undoes what a failed reroll left behind: the memories its new reply wrote.
 * `keepMemoryIds` are the rows the preflight planned to remove; they stay
 * (a reply identical to the old one dedupes onto the old memory's id).
 * `attemptId` lets the gateway tell a failed attempt from one whose commit
 * landed after the client gave up on the response.
 */
export const RerollAbortRequestSchema = z.object({
  rowId: z.string().min(1),
  attemptId: z.string().min(1),
  /** The generation job: the gateway reads the attempt's memory ids from its stored result. */
  jobId: z.string().min(1),
  /**
   * Fallback only: used (limited to the requesting user's personas) when the
   * job's stored result is missing or belongs to another attempt.
   */
  newMemoryIds: RerollMemoryIdsSchema,
  newPendingIds: RerollMemoryIdsSchema,
  keepMemoryIds: RerollMemoryIdsSchema,
});

/** POST /user/history/message/:messageId/reroll-abort response. */
export const RerollAbortResponseSchema = z.object({
  removedMemories: z.number().int().nonnegative(),
  /** True when this attempt's commit had already landed: nothing was removed. */
  committed: z.boolean(),
  /**
   * Whether the OLD row is still live (not soft-deleted), read under the row
   * lock the abort holds. False when the commit landed, or a later reroll or
   * Edit Response replaced the row.
   */
  oldRowLive: z.boolean(),
  /**
   * SHA-256 hex (`sha256Hex`) of the old row's stored content when it is live,
   * else null. A recovering client compares it with the digest of the text it
   * would restore, so it never writes old text over a row that moved on.
   */
  oldRowContentDigest: z.string().length(64).nullable(),
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
