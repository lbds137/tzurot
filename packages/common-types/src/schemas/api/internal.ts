/**
 * Internal API endpoints
 *
 * Service-to-service endpoints under /internal/. Not for user-scoped traffic.
 * Service-auth protected by the global middleware in api-gateway/src/index.ts.
 */

import { z } from 'zod';
import { loadedPersonalitySchema } from '../../types/schemas/personality.js';
import { SYNC_LIMITS } from '../../constants/timing.js';

// ============================================================================
// GET /internal/users/recent
// Returns Discord IDs of users with usage_logs activity in the last N days.
// Used by bot-client at startup to pre-populate the Discord.js DM channel
// cache (Layer 1 of the post-deploy DM-silence fix).
// ============================================================================

/**
 * Discord snowflake IDs are 17–20 digit strings per Discord's ID format spec.
 * Validating the format here catches DB corruption or test-data drift early
 * rather than letting bad IDs propagate to `client.users.fetch()` calls.
 *
 * Exported for reuse by future schemas that need to validate Discord IDs
 * against the same canonical format.
 */
export const DiscordSnowflakeSchema = z.string().regex(/^\d{17,20}$/);

export const RecentUsersResponseSchema = z.object({
  discordIds: z.array(DiscordSnowflakeSchema),
  sinceDays: z.number().int().positive(),
});
export type RecentUsersResponse = z.infer<typeof RecentUsersResponseSchema>;

// ============================================================================
// POST /internal/channel/dm-session/set
// Records active personality in a DM session. Called by bot-client after a
// multi-tag reply selects a personality; the gateway stores it so subsequent
// messages in the DM channel route to the same personality without re-running
// the tag-matching logic.
// ============================================================================

export const DmSessionSetRequestSchema = z.object({
  channelId: z.string(),
  personalitySlug: z.string(),
});
export type DmSessionSetRequest = z.infer<typeof DmSessionSetRequestSchema>;

export const DmSessionSetResponseSchema = z.object({
  channelId: z.string(),
  personalitySlug: z.string(),
});
export type DmSessionSetResponse = z.infer<typeof DmSessionSetResponseSchema>;

// ============================================================================
// GET /internal/conversation/message-personality (reclassified from /user/*)
// Looks up the personality that owns a given Discord message ID. Used by
// bot-client's reply-resolution path to route reply targeting correctly.
//
// Currently mounted at /user/conversation/message-personality but has no
// human-actor auth — it's a service-to-service lookup. The route manifest
// reclassifies it under /internal/* so the audience is explicit.
// ============================================================================

export const MessagePersonalityResponseSchema = z.object({
  personalityId: z.string(),
  // Personality display name is optional — the historical conversation_history
  // row may have only the personality UUID without the display-name denormalized.
  personalityName: z.string().nullable().optional(),
});
export type MessagePersonalityResponse = z.infer<typeof MessagePersonalityResponseSchema>;

// ============================================================================
// POST /internal/conversation/assistant-message
// Persists the assistant conversation-history row after bot-client confirms
// Discord delivery. The gateway owns the write: it derives the assistant
// timestamp (user message + 1ms), the deterministic row UUID, and the token
// count — bot-client only reports what was delivered. Idempotent upsert: when
// the row already exists (the dual-write window, where bot-client's legacy
// Prisma write is authoritative), the gateway compares instead of writing and
// reports the match so divergence is observable.
// ============================================================================

export const PersistAssistantMessageRequestSchema = z.object({
  channelId: z.string().min(1),
  guildId: z.string().nullable(),
  personalityId: z.string().uuid(),
  personaId: z.string().uuid(),
  content: z.string().min(1),
  /** Discord message IDs of the delivered chunks, in send order. */
  chunkMessageIds: z.array(DiscordSnowflakeSchema).min(1).max(SYNC_LIMITS.MAX_MESSAGE_BATCH),
  /** ISO timestamp of the triggering user message; the assistant row is persisted at +1ms. */
  userMessageTime: z.string().datetime(),
});
export type PersistAssistantMessageRequest = z.infer<typeof PersistAssistantMessageRequestSchema>;

export const PersistAssistantMessageResponseSchema = z.object({
  /** Deterministic conversation-history row ID. */
  id: z.string(),
  /** True when this call created the row; false when it already existed. */
  created: z.boolean(),
  /**
   * Present only when the row already existed: whether the existing row's
   * content and chunk IDs match this request. False = divergence between the
   * legacy write path and this endpoint — the burn-in signal.
   */
  matched: z.boolean().optional(),
});
export type PersistAssistantMessageResponse = z.infer<typeof PersistAssistantMessageResponseSchema>;

// ============================================================================
// POST /internal/conversation/sync
// Opportunistic edit/delete sync. bot-client ships the Discord snapshot it
// fetched for a channel+personality; the gateway runs the diff against DB
// state (detecting edited content and deleted messages) and applies the
// writes (content updates, soft-deletes + tombstones). Replaces bot-client's
// direct-Prisma SyncExecutor path. Idempotent: re-posting an already-applied
// snapshot finds zero work.
// ============================================================================

export const ConversationSyncRequestSchema = z.object({
  channelId: z.string().min(1),
  personalityId: z.string().uuid(),
  observedMessages: z
    .array(
      z.object({
        discordMessageId: DiscordSnowflakeSchema,
        /** Raw Discord content. May be empty (e.g. voice messages). */
        content: z.string(),
        createdAt: z.string().datetime(),
      })
    )
    .min(1)
    .max(SYNC_LIMITS.MAX_DISCORD_ID_LOOKUP),
});
export type ConversationSyncRequest = z.infer<typeof ConversationSyncRequestSchema>;

export const ConversationSyncResponseSchema = z.object({
  /** Messages whose content was updated (edit detected). */
  updated: z.number().int().nonnegative(),
  /** Messages soft-deleted (present in DB window, absent from the snapshot). */
  deleted: z.number().int().nonnegative(),
});
export type ConversationSyncResponse = z.infer<typeof ConversationSyncResponseSchema>;

// ============================================================================
// GET /internal/personality/load
// Routing read: resolves a personality by name/slug/alias/ID with the same
// access-control semantics as PersonalityService.loadPersonality. Used by
// bot-client's pre-job routing paths (mention parsing, reply resolution,
// channel activation) once those stop reading the DB directly. Not-found is a
// normal outcome (mention candidates mostly miss), so the response carries
// null rather than a 404.
// ============================================================================

export const LoadPersonalityInternalResponseSchema = z.object({
  personality: loadedPersonalitySchema.nullable(),
});
export type LoadPersonalityInternalResponse = z.infer<typeof LoadPersonalityInternalResponseSchema>;
