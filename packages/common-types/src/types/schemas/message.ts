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
 * Referenced message schema
 * Used when a user references other messages via replies or message links
 */
export const referencedMessageSchema = z.object({
  referenceNumber: z.number(),
  discordMessageId: z.string(), // Discord message ID (for webhook detection)
  webhookId: z.string().optional(), // Discord webhook ID if message was sent via webhook
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
  // Ephemeral — set by hydration in ai-worker before prompt formatting
  resolvedPersonaId: z.string().optional(),
  resolvedPersonaName: z.string().optional(),
  resolvedImageDescriptions: z
    .array(z.object({ filename: z.string(), description: z.string() }))
    .optional(),
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
 * Message metadata schema
 * Structured metadata stored in conversation_history.message_metadata JSONB column
 * Separates semantic content (in 'content' column) from contextual data
 */
export const messageMetadataSchema = z.object({
  // Referenced messages (replies, message links) - snapshot at time of message
  referencedMessages: z.array(storedReferencedMessageSchema).optional(),
  // Processed attachment descriptions (voice transcriptions, image descriptions)
  attachmentDescriptions: z
    .array(
      z.object({
        type: z.enum(['audio', 'image', 'file']),
        description: z.string(),
        originalUrl: z.string(),
        name: z.string().optional(),
      })
    )
    .optional(),
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
export type ReactionReactor = z.infer<typeof reactionReactorSchema>;
export type MessageReaction = z.infer<typeof messageReactionSchema>;
export type MessageMetadata = z.infer<typeof messageMetadataSchema>;
export type CrossChannelMessage = z.infer<typeof crossChannelMessageSchema>;
export type CrossChannelHistoryGroupEntry = z.infer<typeof crossChannelHistoryGroupSchema>;
