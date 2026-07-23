/**
 * Internal API endpoints
 *
 * Service-to-service endpoints under /internal/. Not for user-scoped traffic.
 * Service-auth protected by the global middleware in api-gateway/src/index.ts.
 */

import { z } from 'zod';
import { loadedPersonalitySchema } from '../../types/schemas/personality.js';
import { messageMetadataSchema } from '../../types/schemas/message.js';
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

// ============================================================================
// POST /internal/users/activity
// Fire-and-forget activity stamp for pure-client slash commands (e.g. /help)
// that never otherwise reach the gateway. Refreshes last_active_at and clears
// dm_undeliverable_since for the user, keyed by Discord ID (best-effort; a
// no-op when the user isn't provisioned yet). Mirrors the getOrCreateUser
// activity stamp — a raw UPDATE, so updated_at stays off the sync LWW resolver.
// ============================================================================

export const StampUserActivityRequestSchema = z.object({
  discordId: DiscordSnowflakeSchema,
});

export const StampUserActivityResponseSchema = z.object({
  /** True when a user row was updated; false when the user isn't provisioned yet. */
  stamped: z.boolean(),
});

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

export const DmSessionSetResponseSchema = z.object({
  channelId: z.string(),
  personalitySlug: z.string(),
});

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
// POST /internal/conversation/user-message
// Persists the trigger user message BEFORE job submission. A user message is
// a Discord event, so the gateway (the Discord-event data authority) owns the
// write — called synchronously by bot-client pre-submission, which preserves
// strict ordering (the next message's history query always sees this row)
// with no locks. Content arrives final (text + attachment placeholders —
// placeholder assembly is Discord-domain and stays bot-side); the gateway
// derives the deterministic row UUID and token count from what it persists.
// Idempotent upsert-with-compare, same dual-write semantics as the
// assistant-message endpoint.
// ============================================================================

export const PersistUserMessageRequestSchema = z.object({
  channelId: z.string().min(1),
  guildId: z.string().nullable(),
  personalityId: z.string().uuid(),
  personaId: z.string().uuid(),
  /** Final content: user text + attachment placeholders, assembled bot-side. */
  content: z.string().min(1),
  /** The triggering Discord message ID. */
  discordMessageId: DiscordSnowflakeSchema,
  /** Structured references / forwarded flags / embed XML — the stored shape. */
  messageMetadata: messageMetadataSchema.optional(),
  /** ISO timestamp of the Discord message (becomes the row's createdAt). */
  messageTime: z.string().datetime(),
});

/** Shape intentionally identical to the assistant-message response. */
export const PersistUserMessageResponseSchema = z.object({
  id: z.string(),
  created: z.boolean(),
  matched: z.boolean().optional(),
});

export type PersistUserMessageResponse = z.infer<typeof PersistUserMessageResponseSchema>;

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

// ============================================================================
// POST /internal/v1/routing-context
// Hot-path routing read: resolves the per-(user, personality) routing facts a
// message needs BEFORE the AI job is dispatched — internal user UUID, active
// persona (override → default cascade), persona display name, user timezone,
// and the STM context-epoch. Provisions the user + default persona on first
// contact (idempotent upsert keyed on discordId). Consolidated into one
// endpoint because the reads are sequentially dependent (UUID → cascade →
// epoch); per-read routes would cost ~4 serialized HTTP hops on the single
// most latency-sensitive path in the system. The persona cascade runs here,
// where Prisma is legal, instead of being reimplemented in bot-client.
//
// Versioned (/v1/) — the response is the routing contract bot-client depends
// on; evolve it additively only.
// ============================================================================

export const RoutingContextRequestSchema = z.object({
  /** Message author's Discord snowflake — the provisioning + cascade key. */
  discordId: DiscordSnowflakeSchema,
  /**
   * Discord username, for provisioning the user shell on first contact.
   * `.min(1)` enforces the caller contract — Discord usernames are always
   * non-empty, and an empty one would be stored verbatim as the user shell's
   * username.
   */
  username: z.string().min(1).max(255),
  /**
   * Display name, for seeding the default persona's name on first contact.
   * May legitimately be blank (a user without a global display name), so it is
   * intentionally NOT `.min(1)`-constrained.
   */
  displayName: z.string().max(255),
  /** True for bot authors; provisioning rejects them (returns 400). */
  isBot: z.boolean().optional(),
  /**
   * Target personality whose persona cascade to resolve. Always a deterministic
   * v5 UUID (`generatePersonalityUuid`), so the `.uuid()` constraint is exact —
   * the call-site (bot-client `MessageContextBuilder`) passes `personality.id`.
   */
  personalityId: z.string().uuid(),
});

export type RoutingContextRequest = z.infer<typeof RoutingContextRequestSchema>;

export const RoutingContextResponseSchema = z.object({
  /** Internal user UUID (FK for everything downstream). */
  userId: z.string().uuid(),
  /**
   * Resolved active persona (override → default cascade): a UUID, OR the empty
   * string for the system-default fallback (which the epoch lookup treats as a
   * non-matching key). The union encodes both cases so a malformed non-UUID,
   * non-empty id can't slip through.
   */
  personaId: z.union([z.string().uuid(), z.literal('')]),
  /** Persona display name; null when the cascade has no preferred name. */
  personaName: z.string().nullable(),
  /** IANA timezone; `getUserTimezone` falls back to 'UTC', so always present. */
  timezone: z.string(),
  /** STM context-epoch (last-reset) as ISO; null when no reset is recorded. */
  contextEpoch: z.string().datetime().nullable(),
});

export type RoutingContextResponse = z.infer<typeof RoutingContextResponseSchema>;

/**
 * One secret's rotation-ledger state, with overdue computed server-side so
 * the nag consumer never re-derives interval math.
 */
export const SecretRotationEntrySchema = z.object({
  /** Ledger key, e.g. 'byok-encryption-key'. */
  name: z.string().min(1).max(50),
  /** Last rotation as ISO datetime. */
  rotatedAt: z.string().datetime(),
  intervalDays: z.number().int().positive(),
  /** Days PAST the interval; 0 while still within it. */
  overdueDays: z.number().int().nonnegative(),
});

export const SecretRotationStatusResponseSchema = z.object({
  entries: z.array(SecretRotationEntrySchema),
  overdueCount: z.number().int().nonnegative(),
});
