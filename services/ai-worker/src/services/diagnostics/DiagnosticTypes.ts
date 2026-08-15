/**
 * DiagnosticTypes - Interface definitions for diagnostic data collection.
 *
 * Defines the input shapes for each pipeline stage's recording method.
 * Extracted from DiagnosticCollector to reduce file size.
 */

import type { ThinkingLevel } from '@tzurot/common-types/schemas/llmAdvancedParams';
import type { ProcessedAttachment } from '../MultimodalProcessor.js';
import type { MemoryDocument } from '../ConversationalRAGTypes.js';

/**
 * Options for creating a DiagnosticCollector
 */
export interface DiagnosticCollectorOptions {
  requestId: string;
  triggerMessageId?: string;
  personalityId: string;
  personalityName: string;
  /** Discord ID of the personality owner. Threaded through to
   *  meta.personalityOwnerDiscordId for owner-aware /inspect view rendering.
   *  Resolved by the caller via prisma.user.findUnique() before constructing
   *  the collector — see GenerationStep. May be null if the owner User row
   *  was deleted between personality creation and this request. */
  personalityOwnerDiscordId: string | null;
  userId: string;
  guildId: string | null;
  channelId: string;
}

/**
 * Input data for recording the input processing stage
 */
export interface InputProcessingData {
  rawUserMessage: string;
  processedAttachments: ProcessedAttachment[];
  referencedMessages?: {
    discordMessageId: string;
    content: string;
  }[];
  searchQuery: string;
}

/**
 * Memory data for recording the memory retrieval stage
 */
export interface MemoryRetrievalData {
  retrievedMemories: MemoryDocument[];
  selectedMemories: MemoryDocument[];
  freshModeEnabled: boolean;
}

/**
 * Token budget data for recording allocation
 */
export interface TokenBudgetData {
  contextWindowSize: number;
  systemPromptTokens: number;
  /** FINAL current-message tokens (volatile prefix + turn); see common-types doc. */
  currentMessageTokens?: number;
  memoryTokensUsed: number;
  historyTokensUsed: number;
  memoriesDropped: number;
  factTokensUsed?: number;
  factsIncluded?: number;
  factsDropped?: number;
  historyMessagesDropped: number;
  /** Optional — undefined when cross-channel was disabled for this turn. */
  crossChannelMessagesIncluded?: number;
}

/**
 * LLM configuration data
 */
export interface LlmConfigData {
  model: string;
  provider: string;
  // Basic sampling
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  // Advanced sampling
  minP?: number;
  topA?: number;
  seed?: number;
  // Output control
  logitBias?: Record<string, number>;
  responseFormat?: { type: 'text' | 'json_object' };
  showThinking?: boolean;
  // Canonical thinking level (for reasoning models)
  thinking?: ThinkingLevel;
  // OpenRouter-specific
  transforms?: string[];
  route?: 'fallback';
  verbosity?: 'low' | 'medium' | 'high';
}

/**
 * Raw LLM response data
 */
export interface LlmResponseData {
  rawContent: string;
  finishReason: string;
  promptTokens: number;
  completionTokens: number;
  /**
   * Prompt tokens served from the provider's prefix cache
   * (`usage.prompt_tokens_details.cached_tokens`, via LangChain's
   * `usage_metadata.input_token_details.cache_read`). Undefined when the
   * provider reported no cache activity; 0 is a real report of a cold prefix.
   * This is the epic's primary caching measurement.
   */
  cachedPromptTokens?: number;
  /**
   * OpenRouter's `usage.cache_discount` billing adjustment (negative =
   * cache-read savings). OpenRouter-only; z.ai reports cache activity via
   * cachedPromptTokens alone.
   */
  cacheDiscount?: number;
  modelUsed: string;
  /** Debug info for reasoning extraction troubleshooting */
  reasoningDebug?: {
    additionalKwargsKeys: string[];
    hasReasoningInKwargs: boolean;
    reasoningKwargsLength: number;
    responseMetadataKeys: string[];
    hasReasoningDetails: boolean;
    hasReasoningTagsInContent: boolean;
    rawContentPreview: string;
    /**
     * Actual upstream OpenRouter provider (e.g. "Parasail", "Chutes", "DekaLLM").
     * Captured from `__raw_response.provider` by extractAndPopulateOpenRouterReasoning.
     * Distinct from LangChain's hardcoded `response_metadata.model_provider = "openai"`,
     * which is useless for upstream-provider segmentation in incident investigation.
     */
    upstreamProvider?: string;
    /**
     * Keys present on the raw API response message (`__raw_response.choices[0].message`).
     * Distinguishes "model returned structured reasoning" (keys include `reasoning`/`reasoning_details`)
     * from "model embedded planning into content directly" (keys are just `role`/`content`).
     */
    apiMessageKeys?: string[];
    /**
     * Length of `__raw_response.choices[0].message.reasoning` (string).
     * Zero = model did not emit structured reasoning. Non-zero but reasoning still
     * not visible in the pipeline = our extraction broke (compare to other fields).
     */
    apiReasoningLength?: number;
  };
}

/**
 * Post-processing data
 */
export interface PostProcessingData {
  rawContent: string;
  deduplicatedContent: string;
  thinkingContent: string | null;
  strippedContent: string;
  finalContent: string;
}
