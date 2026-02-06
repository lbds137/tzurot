/**
 * LLM Invoker
 *
 * Handles language model invocation with retry logic, timeout handling, and model caching.
 * Extracted from ConversationalRAGService for better modularity and testability.
 *
 * Reasoning Model Support:
 * - Detects and handles reasoning/thinking models (o1, Claude 3.7+, Gemini Thinking)
 * - Transforms messages for models that don't support system messages
 * - Thinking tag extraction delegated to ResponsePostProcessor
 */

import { BaseMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  createLogger,
  RETRY_CONFIG,
  TIMEOUTS,
  calculateJobTimeout,
  ERROR_MESSAGES,
} from '@tzurot/common-types';
import {
  createChatModel,
  getModelCacheKey,
  type ChatModelResult,
  type ModelConfig,
} from './ModelFactory.js';
import { withRetry } from '../utils/retry.js';
import { shouldRetryError } from '../utils/apiErrorParser.js';
import { recordStopSequenceActivation } from './StopSequenceTracker.js';
import {
  getReasoningModelConfig,
  transformMessagesForReasoningModel,
  ReasoningModelType,
} from '../utils/reasoningModelUtils.js';

const logger = createLogger('LLMInvoker');

/**
 * Models that do NOT support the 'stop' parameter.
 *
 * These patterns are based on OpenRouter's supported_parameters for each model.
 * When stop sequences are passed to these models, they return 400 Bad Request.
 *
 * Research source: OpenRouter model API pages (January 2026)
 * - glm-4.5-air: Only supports reasoning, max_tokens, temperature, top_p, tools, tool_choice
 * - gemini-3-pro-preview: Only supports temperature, top_p, frequency_penalty
 * - gemma-3-27b-it:free: Only supports max_tokens, temperature, presence_penalty, repetition_penalty, frequency_penalty
 * - llama-3.3-70b-instruct:free: Only supports max_tokens, temperature, presence_penalty, repetition_penalty, frequency_penalty, tool_choice, tools
 *
 * TODO: Make this configurable via database (see BACKLOG.md)
 */
const MODELS_WITHOUT_STOP_SUPPORT: RegExp[] = [
  // Z-AI GLM 4.5 Air variants (but NOT GLM 4.6, 4.7 which do support stop)
  /glm-4\.5-air/i,
  // Google Gemini 3 Pro Preview (but NOT Gemini 3 Flash which does support stop)
  /gemini-3-pro-preview/i,
  // Google Gemma 3 free tier
  /gemma-3-27b-it:free/i,
  // Meta Llama 3.3 70B free tier
  /llama-3\.3-70b-instruct:free/i,
  // DeepSeek R1-0528 free tier (stop not in supported_parameters)
  /deepseek-r1-0528:free/i,
];

/**
 * Check if a model supports stop sequences.
 *
 * @param modelName - The model identifier (e.g., "z-ai/glm-4.5-air:free")
 * @returns true if the model supports stop sequences, false otherwise
 */
export function supportsStopSequences(modelName: string): boolean {
  for (const pattern of MODELS_WITHOUT_STOP_SUPPORT) {
    if (pattern.test(modelName)) {
      return false;
    }
  }
  return true;
}

/**
 * Options for invoking an LLM with retry logic
 */
export interface InvokeWithRetryOptions {
  /** LangChain chat model to invoke */
  model: BaseChatModel;
  /** Message array to send to the model */
  messages: BaseMessage[];
  /** Model name for logging */
  modelName: string;
  /** Number of images in the request (for timeout calculation) */
  imageCount?: number;
  /** Number of audio attachments in the request (for timeout calculation) */
  audioCount?: number;
  /** Optional array of sequences that will stop generation (identity bleeding prevention) */
  stopSequences?: string[];
}

export class LLMInvoker {
  private models = new Map<string, ChatModelResult>();

  /**
   * Get or create a chat model for a specific configuration.
   * This supports BYOK (Bring Your Own Key) - different users can use different keys.
   * Returns both the model and the validated model name.
   *
   * @param config - Model configuration including sampling params
   */
  getModel(config: ModelConfig): ChatModelResult {
    const cacheKey = getModelCacheKey(config);

    if (!this.models.has(cacheKey)) {
      this.models.set(cacheKey, createChatModel(config));
    }

    const model = this.models.get(cacheKey);
    if (model === undefined) {
      throw new Error(`Model not found for cache key: ${cacheKey}`);
    }
    return model;
  }

  /**
   * Invoke LLM with timeout and retry logic for transient errors
   *
   * Features:
   * - Retries on all errors (network errors, timeouts, empty responses)
   * - Exponential backoff between retries (1s, 2s, 4s, ...)
   * - Dynamic global timeout based on attachment count
   * - Per-attempt timeout using LLM_PER_ATTEMPT constant
   * - Reasoning model support (o1, Claude 3.7+, Gemini Thinking)
   * - Stop sequences to prevent identity bleeding (e.g., ["\nLila:", "\nLeviathan:"])
   */
  async invokeWithRetry(options: InvokeWithRetryOptions): Promise<BaseMessage> {
    const { model, messages, modelName, imageCount = 0, audioCount = 0, stopSequences } = options;
    // Calculate job timeout for logging (attachments processed in separate jobs)
    const jobTimeout = calculateJobTimeout(imageCount, audioCount);
    // LLM always gets full independent timeout budget (480s = 8 minutes)
    const globalTimeoutMs = TIMEOUTS.LLM_INVOCATION;

    // Filter stop sequences for models that don't support them
    // This prevents 400 Bad Request errors from models like GLM 4.5 Air, Gemma 3 free, etc.
    const modelSupportsStop = supportsStopSequences(modelName);
    const effectiveStopSequences = modelSupportsStop ? stopSequences : undefined;

    if (stopSequences && stopSequences.length > 0 && !modelSupportsStop) {
      logger.warn(
        { modelName, stopSequenceCount: stopSequences.length },
        '[LLMInvoker] Model does not support stop sequences - filtering them out to prevent 400 errors'
      );
    }

    // Get reasoning model config for special handling
    const reasoningConfig = getReasoningModelConfig(modelName);
    const isReasoningModel = reasoningConfig.type !== ReasoningModelType.Standard;

    if (isReasoningModel) {
      logger.info(
        {
          modelName,
          reasoningType: reasoningConfig.type,
          allowsSystemMessage: reasoningConfig.allowsSystemMessage,
        },
        '[LLMInvoker] Detected reasoning model, applying special handling'
      );
    }

    // Transform messages for reasoning models (e.g., convert system to user for o1)
    const transformedMessages = transformMessagesForReasoningModel(messages, reasoningConfig);

    logger.info(
      {
        modelName,
        imageCount,
        audioCount,
        jobTimeout,
        globalTimeoutMs,
        isReasoningModel,
        originalMessageCount: messages.length,
        transformedMessageCount: transformedMessages.length,
        stopSequenceCount: effectiveStopSequences?.length ?? 0,
        stopSequencesFiltered: !modelSupportsStop && (stopSequences?.length ?? 0) > 0,
      },
      `[LLMInvoker] Dynamic timeout calculated: ${globalTimeoutMs}ms (job: ${jobTimeout}ms)`
    );

    if (effectiveStopSequences && effectiveStopSequences.length > 0) {
      logger.debug(
        { stopSequences: effectiveStopSequences },
        '[LLMInvoker] Using stop sequences for identity bleeding prevention'
      );
    }

    // Use retryService for consistent retry behavior
    // Fast-fail on permanent errors (auth, quota, content policy, etc.)
    const result = await withRetry(
      () => this.invokeSingleAttempt(model, transformedMessages, modelName, effectiveStopSequences),
      {
        maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
        globalTimeoutMs,
        logger,
        operationName: `LLM invocation (${modelName})`,
        shouldRetry: shouldRetryError,
      }
    );

    // Note: Thinking tag extraction is handled by ResponsePostProcessor downstream.
    // We do NOT strip tags here to avoid losing reasoning content before it can be
    // extracted and displayed to users (when showThinking is enabled).

    logger.info(
      { modelName, attempts: result.attempts, totalTimeMs: result.totalTimeMs },
      '[LLMInvoker] LLM invocation completed'
    );

    return result.value;
  }

  /**
   * Execute a single LLM invocation attempt with timeout and validation
   *
   * @param model - LangChain chat model to invoke
   * @param messages - Message array to send to the model
   * @param modelName - Model name for logging
   * @param stopSequences - Optional stop sequences for identity bleeding prevention
   * @throws Error on timeout, network errors, empty responses, or censored responses
   * @private
   */
  private async invokeSingleAttempt(
    model: BaseChatModel,
    messages: BaseMessage[],
    modelName: string,
    stopSequences?: string[]
  ): Promise<BaseMessage> {
    // Build invoke options with timeout and optional stop sequences
    const invokeOptions: { timeout: number; stop?: string[] } = {
      timeout: TIMEOUTS.LLM_PER_ATTEMPT,
    };

    // Add stop sequences if provided (identity bleeding prevention)
    if (stopSequences && stopSequences.length > 0) {
      invokeOptions.stop = stopSequences;
    }

    // Invoke with per-attempt timeout (3 minutes per attempt)
    const response = await model.invoke(messages, invokeOptions);

    // Log finish_reason for completion quality diagnostics
    // This helps identify models that fail to emit stop tokens (hallucinated turn bug)
    this.logFinishReason(response, modelName, stopSequences);

    // Guard against empty responses (treat as retryable error)
    // Handle both string content and multimodal array content
    const content = Array.isArray(response.content)
      ? response.content
          .map(c => (typeof c === 'object' && 'text' in c ? c.text : ''))
          .join('')
          .trim()
      : typeof response.content === 'string'
        ? response.content.trim()
        : '';

    if (!content) {
      const emptyResponseError = new Error(ERROR_MESSAGES.EMPTY_RESPONSE);
      logger.warn(
        {
          err: emptyResponseError,
          modelName,
          responseType: Array.isArray(response.content) ? 'array' : typeof response.content,
          contentLength: Array.isArray(response.content) ? response.content.length : 0,
        },
        '[LLMInvoker] Empty response detected, treating as retryable error'
      );
      throw emptyResponseError;
    }

    // Guard against censored responses (Gemini models sometimes return just "ext")
    // Treat this as a retryable error - it may succeed on retry
    if (content === ERROR_MESSAGES.CENSORED_RESPONSE_TEXT) {
      const censoredResponseError = new Error(ERROR_MESSAGES.CENSORED_RESPONSE);
      // Extract provider from modelName (format: "provider/model-name")
      const provider = modelName.includes('/') ? modelName.split('/')[0] : 'unknown';
      logger.warn(
        {
          err: censoredResponseError,
          modelName,
          provider,
          responseContent: content,
        },
        '[LLMInvoker] LLM censored response detected, treating as retryable error'
      );
      throw censoredResponseError;
    }

    return response;
  }

  /**
   * Log finish_reason and related metadata for completion quality diagnostics.
   *
   * This helps identify:
   * - Models that hit token limits (finish_reason: "length") - may cause truncated responses
   * - Models that naturally stopped (finish_reason: "stop") - ideal case
   * - Stop sequences that triggered (finish_reason: "stop_sequence") - our safety measures working
   *
   * Correlation of "length" with the double-response bug would suggest token limit issues.
   */
  private logFinishReason(
    response: BaseMessage,
    modelName: string,
    stopSequences?: string[]
  ): void {
    // LangChain stores provider-specific metadata in response_metadata
    // Different providers use different field names, so we check multiple
    const metadata = (response as { response_metadata?: Record<string, unknown> })
      .response_metadata;

    if (!metadata) {
      logger.debug({ modelName }, '[LLMInvoker] No response_metadata available for finish_reason');
      return;
    }

    // Extract finish_reason - providers use different field names
    // OpenAI/OpenRouter: finish_reason
    // Anthropic: stop_reason
    // Google: finishReason (camelCase)
    const finishReason =
      metadata.finish_reason ?? metadata.stop_reason ?? metadata.finishReason ?? 'unknown';

    // Extract which stop sequence triggered (if any)
    // OpenAI/OpenRouter: stop (the actual sequence that triggered)
    // Some providers include this in the finish_reason metadata
    const stoppedAt = metadata.stop ?? metadata.stop_sequence ?? null;

    // Extract token usage if available
    const usage = metadata.usage as
      | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      | undefined;

    // Build log context
    const logContext: Record<string, unknown> = {
      modelName,
      finishReason,
    };

    if (stoppedAt !== null) {
      logContext.stoppedAt = stoppedAt;
    }

    if (usage !== undefined) {
      logContext.promptTokens = usage.prompt_tokens;
      logContext.completionTokens = usage.completion_tokens;
      logContext.totalTokens = usage.total_tokens;
    }

    if (stopSequences !== undefined && stopSequences.length > 0) {
      logContext.stopSequenceCount = stopSequences.length;
    }

    // Log at different levels based on finish_reason
    // "length" is a warning sign - model may have been cut off
    if (finishReason === 'length') {
      // Use info level with clear WARNING prefix since we don't have an actual error object
      // This is a diagnostic observation, not an exception
      logger.info(
        logContext,
        '[LLMInvoker] WARNING: Model hit token limit (finish_reason: length) - response may be truncated'
      );
    } else if (finishReason === 'stop' || finishReason === 'end_turn' || finishReason === 'STOP') {
      // Natural completion - ideal case
      logger.debug(logContext, '[LLMInvoker] Model completed naturally');
    } else if (stoppedAt !== null) {
      // Our stop sequence triggered - safety measure worked
      // Record in memory tracker for admin visibility
      // stoppedAt is usually a string, but could be object from some providers
      const sequenceStr = typeof stoppedAt === 'string' ? stoppedAt : JSON.stringify(stoppedAt);
      recordStopSequenceActivation(sequenceStr, modelName);
      logger.info(
        logContext,
        '[LLMInvoker] Stop sequence triggered - prevented potential identity bleeding or hallucination'
      );
    } else {
      // Unknown finish reason - log for investigation
      logger.info(logContext, '[LLMInvoker] Model completion with non-standard finish_reason');
    }
  }
}
