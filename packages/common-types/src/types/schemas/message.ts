/**
 * Message Schemas
 *
 * Zod schemas for conversation messages, referenced messages, reactions,
 * and message metadata.
 */

import { z } from 'zod';
import { MessageRole } from '../../constants/index.js';
import { attachmentMetadataSchema, discordEnvironmentSchema } from './discord.js';

/**
 * API conversation message schema
 * Used in conversation history
 */
export const apiConversationMessageSchema = z.object({
  id: z.string().optional(),
  role: z.nativeEnum(MessageRole),
  content: z.string(),
  createdAt: z.string().optional(),
  tokenCount: z.number().optional(),
  // Persona info for multi-participant conversations
  personaId: z.string().optional(),
  personaName: z.string().optional(),
  // Discord username for disambiguation when persona name matches personality name
  discordUsername: z.string().optional(),
  // Discord message IDs (snowflakes) for quote deduplication
  // Array because long messages may be split into multiple Discord messages (chunks)
  discordMessageId: z.array(z.string()).optional(),
  // Whether this message was forwarded from another channel
  isForwarded: z.boolean().optional(),
  // AI personality info for multi-AI channel attribution
  // Allows correct attribution when multiple AI personalities respond in the same channel
  personalityId: z.string().optional(),
  personalityName: z.string().optional(),
  // Structured metadata (referenced messages, attachments, etc.)
  // Separates semantic content from contextual data
  messageMetadata: z.record(z.string(), z.unknown()).optional(), // Flexible JSON, validated when needed
});

/**
 * How a referenced message's author relates to the model — drives the
 * `<quote role>` signal. `assistant` = one of our own personas (our bot's
 * webhook); `user` = a human (incl. proxy-system-relayed humans); `bot` = a
 * non-persona bot/webhook. Classified once in bot-client (which has the Discord
 * message's `applicationId`) and carried to both the live prompt and the
 * stored-history snapshot.
 */
export const referenceAuthorRoleSchema = z.enum(['assistant', 'user', 'bot']);

export type ReferenceAuthorRole = z.infer<typeof referenceAuthorRoleSchema>;

/**
 * Referenced message schema
 * Used when a user references other messages via replies or message links
 */
export const referencedMessageSchema = z.object({
  referenceNumber: z.number(),
  discordMessageId: z.string(), // Discord message ID (for webhook detection)
  webhookId: z.string().optional(), // Discord webhook ID if message was sent via webhook
  // Presence-encoded (true or omitted — literal(true) rejects an accidental
  // `false` at parse time). Together with webhookId this gates the time-based
  // dedup fallback, which the worker-side assembler re-runs from raw
  // reference snapshots — it cannot ask Discord about the author itself.
  authorIsBot: z.literal(true).optional(),
  // Precomputed authorship role (bot-client classifies via applicationId, which the
  // worker can't see). Absent on legacy refs → worker falls back to name-based role.
  authorRole: referenceAuthorRoleSchema.optional(),
  /**
   * Internal personality UUID when one of OUR personas authored the quoted
   * message — the value the rendered `from_id` carries for a `role="character"`
   * quote, and what decides self-vs-sibling without a name comparison.
   *
   * Resolved in bot-client after the reference set is built — the
   * webhook-message cache it reads is bot-client's own, written when it posts
   * as a persona — so the pure synchronous `buildRawReference` stays pure.
   * Absent when the author is a human, a foreign bot, or one of our webhooks
   * whose cache entry has aged out; every consumer then falls back to the name
   * match, which is the pre-existing behaviour rather than a degradation.
   *
   * Deliberately NOT access-gated here, unlike `forwardedOriginSchema.authorPersonalityId`:
   * a reference only exists if the message was FETCHED, and both fetch paths
   * already verify the invoker's access (a reply is same-channel by
   * construction; a link goes through `LinkExtractor.verifyInvokerCanAccessSource`).
   * A forward has no such fetch — Discord hands over the snapshot text with no
   * access check at all — which is exactly why that field needs its own gate
   * and this one does not.
   */
  authorPersonalityId: z.string().optional(),
  discordUserId: z.string(), // Discord user ID for persona lookup
  authorUsername: z.string(),
  authorDisplayName: z.string(),
  content: z.string(),
  embeds: z.string(),
  timestamp: z.string(), // ISO 8601 timestamp string (serialized from Date)
  locationContext: z.string(), // Rich formatted location context (Server/Category/Channel/Thread)
  attachments: z.array(attachmentMetadataSchema).optional(), // Attachments from referenced message
  isForwarded: z.boolean().optional(), // True if this is a forwarded message (author info unavailable)
  isDeduplicated: z.boolean().optional(), // True when full content is already in conversation history (stub)
});

/**
 * Enrichment the worker computed for one of a referenced message's
 * attachments — a vision description or a voice transcript, whichever the
 * modality called for. One shape for both, because they are the same thing to
 * every consumer: the text that becomes the attachment element's content.
 *
 * Keyed by attachment URL. That is the key BOTH producers already correlate
 * on (`AttachmentProcessor.findPreprocessedByUrl`, `buildDedupedAttachments`),
 * whereas `id` is optional on `attachmentMetadataSchema` and a filename is not
 * unique within a message — two `image.png`s in one reply are ordinary.
 *
 * `kind` is the renderer's OWN classification, recorded at build time, so an
 * orphan entry (enrichment whose attachment row is missing from the snapshot)
 * replays under the right element instead of being guessed at from a content
 * type that isn't there.
 *
 * ABSENCE MEANS "never computed" — a retryable state — never "lookup failed".
 * There is no key derivation at replay and no miss mode, which is the property
 * that keeps a durable description from making a FAILURE permanent.
 */
export const attachmentEnrichmentSchema = z.object({
  url: z.string(),
  kind: z.enum(['image', 'voice']),
  description: z.string(),
});

/**
 * Stored referenced message schema
 * Snapshot of a referenced message stored in message_metadata JSONB column
 * Preserves the state of the message at the time it was referenced (receipt perspective)
 */
export const storedReferencedMessageSchema = z.object({
  discordMessageId: z.string(),
  authorUsername: z.string(),
  authorDisplayName: z.string(),
  content: z.string(),
  embeds: z.string().optional(),
  timestamp: z.string(), // ISO 8601 timestamp
  locationContext: z.string(),
  attachments: z.array(attachmentMetadataSchema).optional(),
  isForwarded: z.boolean().optional(),
  // Persistent — set by bot-client when resolving links
  authorDiscordId: z.string().optional(),
  // Persistent — carried from the live reference's classification (see
  // referenceAuthorRoleSchema). Absent on pre-classifier history → name fallback.
  authorRole: referenceAuthorRoleSchema.optional(),
  // Persistent — carried from the live reference (see the field's doc on
  // referencedMessageSchema). Absent on pre-resolver history → name fallback.
  authorPersonalityId: z.string().optional(),
  // Ephemeral — set by hydration in ai-worker before prompt formatting
  resolvedPersonaId: z.string().optional(),
  resolvedPersonaName: z.string().optional(),
  /**
   * Persistent — written by the worker at the moment it builds this reference
   * for the prompt, so a quoted image's description and a quoted voice note's
   * transcript live as long as the history row does rather than as long as a
   * cache entry. Also the target the replay hydrator heals into when a row
   * predates that write.
   */
  attachmentEnrichment: z.array(attachmentEnrichmentSchema).optional(),
});

/**
 * Reaction reactor schema
 * A user who reacted to a message with a specific emoji
 */
export const reactionReactorSchema = z.object({
  /** User's persona ID (e.g., 'discord:123456') */
  personaId: z.string(),
  /** User's display name in the server */
  displayName: z.string(),
});

/**
 * Message reaction schema
 * Represents one emoji reaction with all users who used it
 */
export const messageReactionSchema = z.object({
  /** The emoji (unicode character for standard, name:id for custom) */
  emoji: z.string(),
  /** Custom emoji flag (affects XML formatting) */
  isCustom: z.boolean().optional(),
  /** Users who reacted with this emoji */
  reactors: z.array(reactionReactorSchema),
});

/**
 * Origin of a forwarded message's quoted content.
 *
 * Discord's `message_snapshots` deliberately omit `author` and `id`, so a
 * forward's quoted text arrives with no speaker attached. The forwarding
 * message does carry `message_reference.message_id`, which bot-client resolves
 * at persist time; this schema is where the recovered identity survives the DB
 * round-trip.
 *
 * Every field is optional and every consumer must fail open: the original can
 * be deleted, in a channel the bot cannot read, or simply predate this field,
 * and a forward that renders unattributed is the status quo rather than a
 * regression.
 */
export const forwardedOriginSchema = z.object({
  /**
   * Display name of the original author (a webhook name for a character).
   *
   * Resolved through the BOT's channel access, not the forwarder's — unlike
   * `authorPersonalityId` below, which gates on the forwarder to keep the
   * "Reply Loophole" closed. The asymmetry is deliberate and narrow: Discord's
   * own forward feature already shows the forwarder the message's full text,
   * so this adds a display name to something they can already read, whereas a
   * personality id would name a character they may have no access to.
   */
  authorName: z.string().optional(),
  /** Discord id of the original author — a webhook id for a character. */
  authorId: z.string().optional(),
  /** ISO-8601 post time of the ORIGINAL message, not of the forward. */
  timestamp: z.string().optional(),
  /**
   * Internal personality UUID when the original was authored by a CHARACTER.
   *
   * This is what the rendered `from_id` carries, NOT `authorId`. Every other
   * producer of that attribute emits an internal UUID, and the prompt
   * explicitly instructs the model to match `from_id` against the
   * `<participants>` roster — so a Discord snowflake there is an identity
   * token that can never resolve against anything.
   *
   * Absent for a forward authored by a human or an unrelated bot, and absent
   * when the personality could not be resolved. It binds to a
   * `<character_participant>` entry whenever that character has spoken in the
   * channel the roster is built from; outside that, it is an id the model
   * cannot expand, which a snowflake would never have been either.
   */
  authorPersonalityId: z.string().optional(),
  /**
   * Name of the channel the original message was posted in.
   *
   * Resolved through the FORWARDER's channel access, not the bot's, so a
   * forwarder never learns the name of a channel they cannot see. That is a
   * CHANNEL-visibility check and is deliberately not the gate
   * `authorPersonalityId` uses — a personality-visibility check, which is
   * `undefined` for every forward of a human message and so would suppress
   * this field in the common case.
   *
   * The two senses of "fail" here point opposite ways, so both are named. The
   * GATE fails CLOSED: anything it cannot verify yields no name. CONSUMERS
   * fail OPEN, per this schema's module docstring: absence renders an
   * unattributed quote rather than an error.
   *
   * Absence covers four cases this field cannot tell apart: the original was
   * a DM (no channel to name), the forwarder lacks `ViewChannel` on the origin
   * channel, they could not be resolved from cache, or the origin is a private
   * thread they are no longer a member of.
   */
  channelName: z.string().optional(),
});

/**
 * Message metadata schema
 * Structured metadata stored in conversation_history.message_metadata JSONB column
 * Separates semantic content (in 'content' column) from contextual data
 */
export const messageMetadataSchema = z.object({
  // Referenced messages (replies, message links) - snapshot at time of message
  referencedMessages: z.array(storedReferencedMessageSchema).optional(),
  // Extended context fields (not persisted to DB, used for prompt formatting)
  // These are populated by DiscordChannelFetcher for extended context messages
  /** Embed XML strings for extended context messages (already formatted by EmbedParser) */
  embedsXml: z.array(z.string()).optional(),
  /** Voice transcripts for extended context messages */
  voiceTranscripts: z.array(z.string()).optional(),
  /** Forwarded image attachment descriptors (fallback when vision isn't available) */
  forwardedAttachmentLines: z.array(z.string()).optional(),
  /** Reactions on this message (for extended context messages) */
  reactions: z.array(messageReactionSchema).optional(),
  /** Whether this message was forwarded from another channel (persisted to survive DB round-trip) */
  isForwarded: z.boolean().optional(),
  /**
   * Recovered identity of a forwarded message's original author. Absent on
   * rows written before this field existed, and on forwards whose original
   * could not be resolved — both render as before.
   */
  forwardedFrom: forwardedOriginSchema.optional(),
  // Future expansion: sentiment, mood, topic tags, etc.
});

/**
 * Cross-channel message schema
 * A message from cross-channel conversation history (subset of apiConversationMessageSchema)
 */
export const crossChannelMessageSchema = z.object({
  id: z.string().optional(),
  role: z.nativeEnum(MessageRole),
  content: z.string(),
  tokenCount: z.number().optional(),
  createdAt: z.string().optional(),
  personaId: z.string().optional(),
  personaName: z.string().optional(),
  discordUsername: z.string().optional(),
  personalityId: z.string().optional(),
  personalityName: z.string().optional(),
});

/**
 * Cross-channel history group schema
 * A group of messages from a single channel, used in cross-channel context
 */
export const crossChannelHistoryGroupSchema = z.object({
  channelEnvironment: discordEnvironmentSchema,
  messages: z.array(crossChannelMessageSchema),
});

// Infer TypeScript types from schemas
export type ReferencedMessage = z.infer<typeof referencedMessageSchema>;

export type StoredReferencedMessage = z.infer<typeof storedReferencedMessageSchema>;

export type AttachmentEnrichment = z.infer<typeof attachmentEnrichmentSchema>;

export type ReactionReactor = z.infer<typeof reactionReactorSchema>;

export type MessageReaction = z.infer<typeof messageReactionSchema>;

export type ForwardedOrigin = z.infer<typeof forwardedOriginSchema>;

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

export type CrossChannelMessage = z.infer<typeof crossChannelMessageSchema>;

export type CrossChannelHistoryGroupEntry = z.infer<typeof crossChannelHistoryGroupSchema>;
