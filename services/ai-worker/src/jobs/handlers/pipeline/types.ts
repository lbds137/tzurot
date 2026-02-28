/**
 * Pipeline Types for LLM Generation
 *
 * Defines the context and step interfaces for the generation pipeline.
 * This pattern ensures thread-safety by passing state through function arguments
 * instead of storing it on class instances.
 */

import type { Job } from 'bullmq';
import type {
  CrossChannelHistoryGroupEntry,
  LLMGenerationJobData,
  LLMGenerationResult,
  ResolvedConfigOverrides,
} from '@tzurot/common-types';
import type { BaseMessage } from '@langchain/core/messages';
import type { ProcessedAttachment } from '../../../services/MultimodalProcessor.js';

/**
 * Conversation history entry (raw format from job data)
 */
export interface ConversationHistoryEntry {
  /** Message ID (Discord message ID for extended context, UUID for DB history) */
  id?: string;
  role: string;
  content: string;
  createdAt?: string;
  tokenCount?: number;
  /** Whether this message was forwarded from another channel */
  isForwarded?: boolean;
  /** User's persona ID */
  personaId?: string;
  /** User's persona display name */
  personaName?: string;
  /** Discord username for disambiguation when persona name matches personality name */
  discordUsername?: string;
  /** AI personality ID (for multi-AI channel attribution) */
  personalityId?: string;
  /** AI personality's display name (for multi-AI channel attribution) */
  personalityName?: string;
  /** Structured metadata (referenced messages, attachments) - formatted at prompt time */
  messageMetadata?: {
    referencedMessages?: {
      discordMessageId: string;
      authorUsername: string;
      authorDisplayName: string;
      content: string;
      embeds?: string;
      timestamp: string;
      locationContext: string;
      attachments?: {
        id?: string;
        url: string;
        contentType: string;
        name?: string;
        size?: number;
      }[];
      isForwarded?: boolean;
      authorDiscordId?: string;
      resolvedPersonaId?: string;
      resolvedPersonaName?: string;
      resolvedImageDescriptions?: { filename: string; description: string }[];
    }[];
  };
}

/**
 * Participant in a conversation
 */
export interface Participant {
  personaId: string;
  personaName: string;
  isActive: boolean;
}

/**
 * Resolved LLM configuration with user overrides applied
 */
export interface ResolvedConfig {
  /** Effective personality with config overrides */
  effectivePersonality: LLMGenerationJobData['personality'];
  /** Source of the config */
  configSource: 'personality' | 'user-personality' | 'user-default';
}

/**
 * Resolved API key information
 */
export interface ResolvedAuth {
  /** The resolved API key (undefined means use system key) */
  apiKey: string | undefined;
  /** The provider (e.g., 'openrouter') */
  provider: string | undefined;
  /** Whether in guest mode (free models only) */
  isGuestMode: boolean;
}

/**
 * Preprocessing results from dependency jobs
 */
export interface PreprocessingResults {
  /** Processed attachments from direct message */
  processedAttachments: ProcessedAttachment[];
  /** Audio transcriptions (direct only, for backward compat) */
  transcriptions: string[];
  /** Attachments from referenced messages, keyed by reference number */
  referenceAttachments: Record<number, ProcessedAttachment[]>;
  /** Processed attachments from extended context (inline processing) */
  extendedContextAttachments?: ProcessedAttachment[];
}

/**
 * Prepared context for RAG generation
 */
export interface PreparedContext {
  /** Conversation history in BaseMessage format */
  conversationHistory: BaseMessage[];
  /** Raw conversation history entries */
  rawConversationHistory: ConversationHistoryEntry[];
  /** Oldest timestamp in history (for LTM deduplication) */
  oldestHistoryTimestamp?: number;
  /** All participants in the conversation */
  participants: Participant[];
  /** Cross-channel conversation history groups (from other channels with same personality) */
  crossChannelHistory?: CrossChannelHistoryGroupEntry[];
}

/**
 * Generation context that flows through the pipeline
 *
 * This object accumulates state as it passes through each step.
 * It is created fresh for each job, ensuring thread safety.
 */
export interface GenerationContext {
  /** The BullMQ job being processed */
  job: Job<LLMGenerationJobData>;

  /** Processing start time */
  startTime: number;

  /** Preprocessing results from dependency jobs (set by DependencyStep) */
  preprocessing?: PreprocessingResults;

  /** Resolved LLM config with user overrides (set by ConfigStep) */
  config?: ResolvedConfig;

  /** Resolved config cascade overrides (set by ConfigStep) */
  configOverrides?: ResolvedConfigOverrides;

  /** Resolved API key/auth info (set by AuthStep) */
  auth?: ResolvedAuth;

  /** Prepared conversation context (set by ContextStep) */
  preparedContext?: PreparedContext;

  /** Final response (set by GenerationStep) */
  result?: LLMGenerationResult;
}

/**
 * Pipeline step interface
 *
 * Each step processes the context and returns an updated context.
 * Steps should be stateless and idempotent where possible.
 */
export interface IPipelineStep {
  /** Name of this step (for logging) */
  readonly name: string;

  /**
   * Process this step
   * @param context - Current context
   * @returns Updated context with this step's results added (sync or async)
   */
  process(context: GenerationContext): GenerationContext | Promise<GenerationContext>;
}
