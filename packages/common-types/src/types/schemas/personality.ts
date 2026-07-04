/**
 * Personality Schemas
 *
 * Zod schemas for loaded personality configuration, mentioned personas,
 * referenced channels, guild member info, and request context.
 */

import { z } from 'zod';
import {
  discordEnvironmentSchema,
  attachmentMetadataSchema,
  guildMemberInfoSchema,
} from './discord.js';
import { rawAssemblyInputsSchema } from './rawEnvelope.js';
import { crossChannelHistoryGroupSchema, referencedMessageSchema } from './message.js';

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
  /** Internal user UUID of the personality owner. Used for diagnostic-log
   * snapshots so /inspect can render the right view for owner vs non-owner.
   * Already queried by PERSONALITY_SELECT — exposed here so consumers can
   * read it without going back to the DB. */
  ownerId: z.string(),

  // Core configuration
  systemPrompt: z.string(),
  model: z.string(),
  visionModel: z.string().optional(),
  /**
   * Ordered vision-model fallback chain the worker retries down when the primary
   * vision model FAILS at runtime (auto-fallback). Gateway-stamped from the
   * DB-resolved defaults (`AdminSettings.globalDefaultVisionConfigId` →
   * `freeDefaultVisionConfigId`) since the worker has no Prisma — all DB resolution
   * stays gateway-side, the worker just walks the list. Absent/empty = no admin
   * fallback tiers configured; the worker still has its local T2 (native main-model
   * vision) and T5 (hardcoded floor) tiers. The worker composes + dedupes the full
   * chain; this carries only the tiers it can't compute locally.
   */
  visionFallbackModels: z.array(z.string()).optional(),
  /**
   * Provider routing key (e.g. 'openrouter', 'zai-coding'). Drives
   * provider-tier baseURL selection in ModelFactory and any auto-fallthrough
   * decisions in ProviderRouter. String-typed (not the AIProvider enum)
   * because the DB column is a free-form string and may carry future provider
   * values not yet in the enum. Defaults to 'openrouter' to preserve
   * pre-zai-coding behavior for any LoadedPersonality constructed without
   * explicit provider data.
   */
  provider: z.string().default('openrouter'),

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

  // Voice configuration (prerequisite for TTS — personality must have voice reference set up)
  /** Whether this personality has a voice reference configured for TTS.
   * Defaults to false — DB column has @default(false), and Zod provides the same default
   * for objects constructed without this field. */
  voiceEnabled: z.boolean().default(false),
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

// guildMemberInfoSchema lives in discord.ts (Discord member data; also needed
// by rawEnvelope.ts, which personality.ts imports — defining it here would
// create a schema-module cycle).

/**
 * Request context schema
 * Includes all contextual information about a message
 */
export const requestContextSchema = z.object({
  // Context-payload variant. 'envelope' means the producer omitted the
  // re-derivable legacy fields (referencedMessages, mentionedPersonas,
  // referencedChannels) and the worker MUST assemble them from
  // rawAssemblyInputs. Optional here (kept off the inferred type's
  // required set so existing RequestContext construction sites don't all need
  // it); absent is treated as legacy by consumers (worker reads `?? 'legacy'`,
  // jobContextBaseSchema defaults it). The envelope-requires-rawAssemblyInputs
  // invariant is enforced at the job-schema layer (llmGenerationContextSchema).
  kind: z.enum(['legacy', 'envelope']).optional(),
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
  // Weigh-in mode flag (read-the-room framing; anonymity is controlled by `incognito`)
  isWeighIn: z.boolean().optional(),
  // Anonymity for chime-in/random: skip persona + LTM read/write + epoch when true
  incognito: z.boolean().optional(),
  // Cross-channel conversation history (grouped by channel)
  crossChannelHistory: z.array(crossChannelHistoryGroupSchema).optional(),
  // Whether the triggering message was a voice message (for voice-only TTS mode)
  isVoiceMessage: z.boolean().optional(),
  // Raw Discord-origin assembly inputs (worker-side context assembly burn-in;
  // present only when bot-client's CONTEXT_RAW_ENVELOPE=true)
  rawAssemblyInputs: rawAssemblyInputsSchema.optional(),
});

// Infer TypeScript types from schemas
export type LoadedPersonality = z.infer<typeof loadedPersonalitySchema>;

/**
 * Check if a personality has voice enabled for TTS.
 * Centralizes the check — use this instead of reading the field directly
 * so TTS gating logic has a single source of truth.
 */
export function isVoiceEnabled(personality: LoadedPersonality): boolean {
  return personality.voiceEnabled === true;
}

export type MentionedPersona = z.infer<typeof mentionedPersonaSchema>;
export type ReferencedChannel = z.infer<typeof referencedChannelSchema>;
export type RequestContext = z.infer<typeof requestContextSchema>;
