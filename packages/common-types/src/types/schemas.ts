/**
 * Validation Schemas
 *
 * Zod schemas for API requests and shared data structures.
 * Types are derived from schemas using z.infer to ensure they stay in sync.
 */

import { z } from 'zod';
import { MessageRole } from '../config/constants.js';

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
 * Personality configuration schema
 * Used in GenerateRequest
 */
export const personalityConfigSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  displayName: z.string().optional(),
  slug: z.string().optional(),
  systemPrompt: z.string(),
  model: z.string().optional(),
  visionModel: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
  contextWindowTokens: z.number().optional(),
  memoryEnabled: z.boolean().optional(),
  memoryScoreThreshold: z.number().optional(),
  memoryLimit: z.number().optional(),
  contextWindow: z.number().optional(),
  avatarUrl: z.string().optional(),
  // Character fields
  characterInfo: z.string().optional(),
  personalityTraits: z.string().optional(),
  personalityTone: z.string().optional(),
  personalityAge: z.string().optional(),
  personalityAppearance: z.string().optional(),
  personalityLikes: z.string().optional(),
  personalityDislikes: z.string().optional(),
  conversationalGoals: z.string().optional(),
  conversationalExamples: z.string().optional(),
});

/**
 * Request context schema
 * Includes all contextual information about a message
 */
export const requestContextSchema = z.object({
  userId: z.string(),
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
});

/**
 * Generate request schema
 * Full validation schema for /ai/generate endpoint
 */
export const generateRequestSchema = z.object({
  personality: personalityConfigSchema,
  message: z.union([z.string(), z.object({}).passthrough()]),
  context: requestContextSchema,
  userApiKey: z.string().optional(),
});

// Infer TypeScript types from schemas
export type DiscordEnvironment = z.infer<typeof discordEnvironmentSchema>;
export type AttachmentMetadata = z.infer<typeof attachmentMetadataSchema>;
export type ApiConversationMessage = z.infer<typeof apiConversationMessageSchema>;
export type ReferencedMessage = z.infer<typeof referencedMessageSchema>;
export type PersonalityConfig = z.infer<typeof personalityConfigSchema>;
export type RequestContext = z.infer<typeof requestContextSchema>;
export type GenerateRequest = z.infer<typeof generateRequestSchema>;
