/**
 * Personality Schemas
 *
 * Zod schemas for loaded personality configuration, mentioned personas,
 * referenced channels, guild member info, and request context.
 */

import { z } from 'zod';
import { discordEnvironmentSchema, attachmentMetadataSchema } from './discord.js';
import { apiConversationMessageSchema, referencedMessageSchema } from './message.js';

/**
 * Custom Fields Schema
 * Validates custom JSON fields for personality metadata
 * Allows arbitrary key-value pairs for extensibility
 */
export const customFieldsSchema = z.record(z.string(), z.unknown()).nullable();

/**
 * Loaded Personality Schema
 *
 * This is the SINGLE SOURCE OF TRUTH for the LoadedPersonality type.
 * The TypeScript type is inferred from this schema using z.infer.
 *
 * Represents a personality loaded from the database with all configuration.
 */
export const loadedPersonalitySchema = z.object({
  // Identity
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  slug: z.string(),

  // Core configuration
  systemPrompt: z.string(),
  model: z.string(),
  visionModel: z.string().optional(),

  // LLM parameters
  temperature: z.number(),
  maxTokens: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
  repetitionPenalty: z.number().optional(),
  contextWindowTokens: z.number(),

  // Reasoning/thinking display
  showThinking: z.boolean().optional(), // Display <think> blocks as separate messages

  // Advanced sampling parameters (from user LLM config)
  minP: z.number().optional(),
  topA: z.number().optional(),
  seed: z.number().optional(),

  // Output control
  stop: z.array(z.string()).optional(),
  logitBias: z.record(z.string(), z.number()).optional(),
  responseFormat: z
    .object({
      type: z.enum(['text', 'json_object']),
    })
    .optional(),

  // Reasoning configuration (for thinking models: o1/o3, Claude, DeepSeek R1)
  reasoning: z
    .object({
      effort: z.enum(['xhigh', 'high', 'medium', 'low', 'minimal', 'none']).optional(),
      maxTokens: z.number().optional(),
      exclude: z.boolean().optional(),
      enabled: z.boolean().optional(),
    })
    .optional(),

  // OpenRouter-specific routing/transform params
  transforms: z.array(z.string()).optional(),
  route: z.literal('fallback').optional(),
  verbosity: z.enum(['low', 'medium', 'high']).optional(),

  // Memory configuration
  memoryScoreThreshold: z.number().optional(),
  memoryLimit: z.number().optional(),

  // Context settings (conversation history limits from LlmConfig)
  maxMessages: z.number().optional(), // Max messages to fetch from history
  maxAge: z.number().nullable().optional(), // Max age in seconds (null = no limit)
  maxImages: z.number().optional(), // Max images to process from extended context

  // Avatar URL with path-based cache-busting (timestamp embedded in filename)
  // e.g., /avatars/cold-1705827727111.png
  avatarUrl: z.string().optional(),

  // Character definition fields
  characterInfo: z.string(),
  personalityTraits: z.string(),
  personalityTone: z.string().optional(),
  personalityAge: z.string().optional(),
  personalityAppearance: z.string().optional(),
  personalityLikes: z.string().optional(),
  personalityDislikes: z.string().optional(),
  conversationalGoals: z.string().optional(),
  conversationalExamples: z.string().optional(),

  // Custom error message for this personality (shown to users on LLM failures)
  errorMessage: z.string().optional(),
});

/**
 * Mentioned persona schema
 * Information about a user mentioned in the message via @mention
 */
export const mentionedPersonaSchema = z.object({
  personaId: z.string(),
  personaName: z.string(),
});

/**
 * Referenced channel schema
 * Information about a channel mentioned in the message via #channel
 * Used for LTM scoping (retrieving memories from specific channels)
 */
export const referencedChannelSchema = z.object({
  channelId: z.string(),
  channelName: z.string(),
  topic: z.string().optional(),
  guildId: z.string().optional(),
});

/**
 * Guild member info schema
 * Discord server-specific information about a user
 * Used for enriching participant context in prompts
 */
export const guildMemberInfoSchema = z.object({
  /** User's top server roles (sorted by position, excluding @everyone). Limit: MESSAGE_LIMITS.MAX_GUILD_ROLES */
  roles: z.array(z.string()).max(5),
  /** Display color from highest colored role (hex, e.g., '#FF00FF') */
  displayColor: z.string().optional(),
  /** When user joined the server (ISO 8601) */
  joinedAt: z.string().optional(),
});

/**
 * Request context schema
 * Includes all contextual information about a message
 */
export const requestContextSchema = z.object({
  userId: z.string(), // Discord ID (for BYOK API key resolution)
  userInternalId: z.string().optional(), // Internal UUID (for usage logging)
  userName: z.string().optional(),
  // Discord message ID that triggered this request (for diagnostic lookup)
  triggerMessageId: z.string().optional(),
  // Discord username (e.g., 'lbds137') - for disambiguation when persona name matches personality name
  discordUsername: z.string().optional(),
  // User's preferred timezone (IANA format, e.g., 'America/New_York')
  userTimezone: z.string().optional(),
  channelId: z.string().optional(),
  serverId: z.string().optional(),
  sessionId: z.string().optional(),
  isProxyMessage: z.boolean().optional(),
  // Active speaker persona
  activePersonaId: z.string().optional(),
  activePersonaName: z.string().optional(),
  // Guild-specific info about the active speaker (roles, color, join date)
  activePersonaGuildInfo: guildMemberInfoSchema.optional(),
  // Guild info for other participants (from extended context, keyed by personaId)
  // Note: Only available for extended context participants; DB history doesn't store guild info
  participantGuildInfo: z.record(z.string(), guildMemberInfoSchema).optional(),
  // Conversation history
  conversationHistory: z.array(apiConversationMessageSchema).optional(),
  // Attachments (from triggering message)
  attachments: z.array(attachmentMetadataSchema).optional(),
  // Extended context attachments (proactively fetched images, limited by maxImages setting)
  extendedContextAttachments: z.array(attachmentMetadataSchema).optional(),
  // Discord environment
  environment: discordEnvironmentSchema.optional(),
  // Referenced messages (from replies and message links)
  referencedMessages: z.array(referencedMessageSchema).optional(),
  // Mentioned users (from @mentions in message content)
  mentionedPersonas: z.array(mentionedPersonaSchema).optional(),
  // Referenced channels (from #channel mentions - used for LTM scoping)
  referencedChannels: z.array(referencedChannelSchema).optional(),
});

// Infer TypeScript types from schemas
export type LoadedPersonality = z.infer<typeof loadedPersonalitySchema>;
export type MentionedPersona = z.infer<typeof mentionedPersonaSchema>;
export type ReferencedChannel = z.infer<typeof referencedChannelSchema>;
export type GuildMemberInfo = z.infer<typeof guildMemberInfoSchema>;
export type RequestContext = z.infer<typeof requestContextSchema>;
