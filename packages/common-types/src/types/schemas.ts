/**
 * Validation Schemas
 *
 * Zod schemas for API requests and shared data structures.
 * Types are derived from schemas using z.infer to ensure they stay in sync.
 */

import { z } from 'zod';
import { MessageRole } from '../constants/index.js';

/**
 * Discord environment context schema
 * Describes where a conversation is taking place
 */
export const discordEnvironmentSchema = z.object({
  type: z.enum(['dm', 'guild']),
  guild: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
  category: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
  channel: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
  }),
  thread: z
    .object({
      id: z.string(),
      name: z.string(),
      parentChannel: z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
      }),
    })
    .optional(),
});

/**
 * Attachment metadata schema
 */
export const attachmentMetadataSchema = z.object({
  url: z.string(),
  originalUrl: z.string().optional(), // Discord CDN URL (preserved for caching)
  contentType: z.string(),
  name: z.string().optional(),
  size: z.number().optional(),
  isVoiceMessage: z.boolean().optional(),
  duration: z.number().optional(),
  waveform: z.string().optional(),
});

/**
 * API conversation message schema
 * Used in conversation history
 */
export const apiConversationMessageSchema = z.object({
  id: z.string().optional(),
  role: z.nativeEnum(MessageRole),
  content: z.string(),
  createdAt: z.string().optional(),
  // Persona info for multi-participant conversations
  personaId: z.string().optional(),
  personaName: z.string().optional(),
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
});

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
  maxTokens: z.number(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
  contextWindowTokens: z.number(),

  // Memory configuration
  memoryScoreThreshold: z.number().optional(),
  memoryLimit: z.number().optional(),

  // Avatar
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
 * Request context schema
 * Includes all contextual information about a message
 */
export const requestContextSchema = z.object({
  userId: z.string(), // Discord ID (for BYOK API key resolution)
  userInternalId: z.string().optional(), // Internal UUID (for usage logging)
  userName: z.string().optional(),
  channelId: z.string().optional(),
  serverId: z.string().optional(),
  sessionId: z.string().optional(),
  isProxyMessage: z.boolean().optional(),
  // Active speaker persona
  activePersonaId: z.string().optional(),
  activePersonaName: z.string().optional(),
  // Conversation history
  conversationHistory: z.array(apiConversationMessageSchema).optional(),
  // Attachments
  attachments: z.array(attachmentMetadataSchema).optional(),
  // Discord environment
  environment: discordEnvironmentSchema.optional(),
  // Referenced messages (from replies and message links)
  referencedMessages: z.array(referencedMessageSchema).optional(),
  // Mentioned users (from @mentions in message content)
  mentionedPersonas: z.array(mentionedPersonaSchema).optional(),
  // Referenced channels (from #channel mentions - used for LTM scoping)
  referencedChannels: z.array(referencedChannelSchema).optional(),
});

/**
 * Generate request schema
 * Full validation schema for /ai/generate endpoint
 */
export const generateRequestSchema = z.object({
  personality: loadedPersonalitySchema,
  message: z.union([z.string(), z.object({}).passthrough()]),
  context: requestContextSchema,
  userApiKey: z.string().optional(),
});

/**
 * Generation Payload Schema
 *
 * SINGLE SOURCE OF TRUTH for the core AI generation result payload.
 * This is the shared contract between:
 * - HTTP API responses (GenerateResponse.result)
 * - Internal job results (LLMGenerationResult)
 *
 * Following DRY principle while maintaining proper decoupling between
 * API contracts and internal formats.
 */
export const generationPayloadSchema = z.object({
  content: z.string(),
  attachmentDescriptions: z.string().optional(),
  referencedMessagesDescriptions: z.string().optional(),
  metadata: z
    .object({
      retrievedMemories: z.number().optional(),
      /** Input/prompt tokens consumed */
      tokensIn: z.number().optional(),
      /** Output/completion tokens consumed */
      tokensOut: z.number().optional(),
      processingTimeMs: z.number().optional(),
      modelUsed: z.string().optional(),
    })
    .optional(),
});

/**
 * LLM Generation Result Schema
 *
 * SINGLE SOURCE OF TRUTH for internal job results passed through Redis streams.
 * Extends GenerationPayload with success/error fields for internal processing.
 */
export const llmGenerationResultSchema = generationPayloadSchema.extend({
  requestId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  // Override content to be optional when success=false
  content: z.string().optional(),
  // Custom error message from personality (for webhook response on failures)
  personalityErrorMessage: z.string().optional(),
});

// Infer TypeScript types from schemas
export type CustomFields = z.infer<typeof customFieldsSchema>;
export type DiscordEnvironment = z.infer<typeof discordEnvironmentSchema>;
export type AttachmentMetadata = z.infer<typeof attachmentMetadataSchema>;
export type ApiConversationMessage = z.infer<typeof apiConversationMessageSchema>;
export type ReferencedMessage = z.infer<typeof referencedMessageSchema>;
export type MentionedPersona = z.infer<typeof mentionedPersonaSchema>;
export type ReferencedChannel = z.infer<typeof referencedChannelSchema>;
export type LoadedPersonality = z.infer<typeof loadedPersonalitySchema>;
export type RequestContext = z.infer<typeof requestContextSchema>;
export type GenerateRequest = z.infer<typeof generateRequestSchema>;
export type GenerationPayload = z.infer<typeof generationPayloadSchema>;
export type LLMGenerationResult = z.infer<typeof llmGenerationResultSchema>;
