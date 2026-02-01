/**
 * Validation Schemas
 *
 * Zod schemas for API requests and shared data structures.
 * Types are derived from schemas using z.infer to ensure they stay in sync.
 */

import { z } from 'zod';
import { MessageRole, ApiErrorType, ApiErrorCategory } from '../constants/index.js';

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
    topic: z.string().optional(),
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
  /** Discord attachment ID (stable snowflake for caching - preferred over URL hash) */
  id: z.string().optional(),
  url: z.string(),
  originalUrl: z.string().optional(), // Discord CDN URL (preserved for caching)
  contentType: z.string(),
  name: z.string().optional(),
  size: z.number().optional(),
  isVoiceMessage: z.boolean().optional(),
  duration: z.number().optional(),
  waveform: z.string().optional(),
  /**
   * Discord message ID this attachment came from (for inline image descriptions).
   * Optional because attachments in direct/triggering messages don't need source tracking.
   */
  sourceDiscordMessageId: z.string().optional(),
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
  tokenCount: z.number().optional(),
  // Persona info for multi-participant conversations
  personaId: z.string().optional(),
  personaName: z.string().optional(),
  // Discord username for disambiguation when persona name matches personality name
  discordUsername: z.string().optional(),
  // Discord message IDs (snowflakes) for quote deduplication
  // Array because long messages may be split into multiple Discord messages (chunks)
  discordMessageId: z.array(z.string()).optional(),
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
  /** Reactions on this message (for extended context messages) */
  reactions: z.array(messageReactionSchema).optional(),
  // Future expansion: sentiment, mood, topic tags, etc.
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

  // Extended context configuration (tri-state: null=auto, true=on, false=off)
  extendedContext: z.boolean().nullable().optional(),
  extendedContextMaxMessages: z.number().nullable().optional(), // Override max messages limit
  extendedContextMaxAge: z.number().nullable().optional(), // Override max age (seconds)
  extendedContextMaxImages: z.number().nullable().optional(), // Override max images to process
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
 * Error Info Schema
 *
 * Structured error information for LLM generation failures.
 * Includes classification for retry logic and user-friendly messages.
 */
export const errorInfoSchema = z.object({
  /** Error type for retry logic (transient, permanent, unknown) */
  type: z.nativeEnum(ApiErrorType),
  /** Specific error category for user messaging */
  category: z.nativeEnum(ApiErrorCategory),
  /** HTTP status code if available */
  statusCode: z.number().optional(),
  /** User-friendly error message */
  userMessage: z.string(),
  /** Unique reference ID for support */
  referenceId: z.string(),
  /** Whether this error should have been retried */
  shouldRetry: z.boolean(),
  /** OpenRouter request ID for support (from x-request-id header) */
  requestId: z.string().optional(),
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
      /** AI provider used (from API key resolution) */
      providerUsed: z.string().optional(),
      /** Source of LLM config: 'personality' | 'user-personality' | 'user-default' */
      configSource: z.enum(['personality', 'user-personality', 'user-default']).optional(),
      /** Whether response was generated using guest mode (free model, no API key) */
      isGuestMode: z.boolean().optional(),
      /** Whether cross-turn duplication was detected (same response as previous turn) */
      crossTurnDuplicateDetected: z.boolean().optional(),
      /** Whether focus mode was active (LTM retrieval skipped) */
      focusModeEnabled: z.boolean().optional(),
      /** Whether incognito mode was active (LTM storage skipped) */
      incognitoModeActive: z.boolean().optional(),
      /**
       * Extracted thinking/reasoning content from <think> tags.
       * Only present if the model included thinking blocks in its response.
       * Display to users depends on showThinking setting.
       */
      thinkingContent: z.string().optional(),
      /**
       * Whether to display thinking content to users.
       * From the preset's show_thinking setting.
       */
      showThinking: z.boolean().optional(),
      /** Pipeline step that failed (only set on error) */
      failedStep: z.string().optional(),
      /** Last successfully completed pipeline step (only set on error) */
      lastSuccessfulStep: z.string().optional(),
      /** Error stack trace for debugging (only set on error) */
      errorStack: z.string().optional(),
      /** Discord message ID that triggered the request (for idempotency tracking) */
      triggerMessageId: z.string().optional(),
      /** Reason processing was skipped (e.g., 'idempotency_check_failed') */
      skipReason: z.string().optional(),
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
  // Structured error info for retry logic and user messaging
  errorInfo: errorInfoSchema.optional(),
});

// ============================================================================
// User History API Schemas (/user/history/*)
// ============================================================================

/**
 * Request schema for POST /user/history/clear
 * Sets a context epoch to soft-reset conversation history
 */
export const historyClearRequestSchema = z.object({
  personalitySlug: z.string().min(1),
});

/**
 * Response schema for POST /user/history/clear
 */
export const historyClearResponseSchema = z.object({
  success: z.boolean(),
  epoch: z.string(), // ISO 8601 timestamp
  canUndo: z.boolean(),
  message: z.string(),
});

/**
 * Request schema for POST /user/history/undo
 * Restores the previous context epoch
 */
export const historyUndoRequestSchema = z.object({
  personalitySlug: z.string().min(1),
});

/**
 * Response schema for POST /user/history/undo
 */
export const historyUndoResponseSchema = z.object({
  success: z.boolean(),
  restoredEpoch: z.string().nullable(), // ISO 8601 timestamp or null
  message: z.string(),
});

/**
 * Query parameters schema for GET /user/history/stats
 */
export const historyStatsQuerySchema = z.object({
  personalitySlug: z.string().min(1),
  channelId: z.string().min(1),
});

/**
 * Response schema for GET /user/history/stats
 */
export const historyStatsResponseSchema = z.object({
  channelId: z.string(),
  personalitySlug: z.string(),
  visible: z.object({
    totalMessages: z.number(),
    userMessages: z.number(),
    assistantMessages: z.number(),
    oldestMessage: z.string().nullable(), // ISO 8601 timestamp or null
    newestMessage: z.string().nullable(), // ISO 8601 timestamp or null
  }),
  hidden: z.object({
    count: z.number(),
  }),
  total: z.object({
    totalMessages: z.number(),
    oldestMessage: z.string().nullable(), // ISO 8601 timestamp or null
  }),
  contextEpoch: z.string().nullable(), // ISO 8601 timestamp or null
  canUndo: z.boolean(),
});

/**
 * Request schema for DELETE /user/history/hard-delete
 * Permanently deletes conversation history
 */
export const historyHardDeleteRequestSchema = z.object({
  personalitySlug: z.string().min(1),
  channelId: z.string().min(1),
});

/**
 * Response schema for DELETE /user/history/hard-delete
 */
export const historyHardDeleteResponseSchema = z.object({
  success: z.boolean(),
  deletedCount: z.number(),
  message: z.string(),
});

// Infer TypeScript types from schemas
export type CustomFields = z.infer<typeof customFieldsSchema>;
export type DiscordEnvironment = z.infer<typeof discordEnvironmentSchema>;
export type ErrorInfo = z.infer<typeof errorInfoSchema>;
export type AttachmentMetadata = z.infer<typeof attachmentMetadataSchema>;
export type ApiConversationMessage = z.infer<typeof apiConversationMessageSchema>;
export type ReferencedMessage = z.infer<typeof referencedMessageSchema>;
export type StoredReferencedMessage = z.infer<typeof storedReferencedMessageSchema>;
export type ReactionReactor = z.infer<typeof reactionReactorSchema>;
export type MessageReaction = z.infer<typeof messageReactionSchema>;
export type MessageMetadata = z.infer<typeof messageMetadataSchema>;
export type MentionedPersona = z.infer<typeof mentionedPersonaSchema>;
export type ReferencedChannel = z.infer<typeof referencedChannelSchema>;
export type GuildMemberInfo = z.infer<typeof guildMemberInfoSchema>;
export type LoadedPersonality = z.infer<typeof loadedPersonalitySchema>;
export type RequestContext = z.infer<typeof requestContextSchema>;
export type GenerateRequest = z.infer<typeof generateRequestSchema>;
export type GenerationPayload = z.infer<typeof generationPayloadSchema>;
export type LLMGenerationResult = z.infer<typeof llmGenerationResultSchema>;

// History API types
export type HistoryClearRequest = z.infer<typeof historyClearRequestSchema>;
export type HistoryClearResponse = z.infer<typeof historyClearResponseSchema>;
export type HistoryUndoRequest = z.infer<typeof historyUndoRequestSchema>;
export type HistoryUndoResponse = z.infer<typeof historyUndoResponseSchema>;
export type HistoryStatsQuery = z.infer<typeof historyStatsQuerySchema>;
export type HistoryStatsResponse = z.infer<typeof historyStatsResponseSchema>;
export type HistoryHardDeleteRequest = z.infer<typeof historyHardDeleteRequestSchema>;
export type HistoryHardDeleteResponse = z.infer<typeof historyHardDeleteResponseSchema>;
