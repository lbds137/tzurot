/**
 * LLM Invoker
 *
 * Handles language model invocation with retry logic, timeout handling, and model caching.
 * Extracted from ConversationalRAGService for better modularity and testability.
 *
 * Reasoning Model Support:
 * - Detects and handles reasoning/thinking models (o1, Claude 3.7+, Gemini Thinking)
 * - Transforms messages for models that don't support system messages
 * - Strips <thinking> tags from output
 */

import { BaseMessage, AIMessage } from '@langchain/core/messages';
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
import {
  getReasoningModelConfig,
  transformMessagesForReasoningModel,
  stripThinkingTags,
  ReasoningModelType,
  type ReasoningModelConfig,
} from '../utils/reasoningModelUtils.js';

const logger = createLogger('LLMInvoker');

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
        stopSequenceCount: stopSequences?.length ?? 0,
      },
      `[LLMInvoker] Dynamic timeout calculated: ${globalTimeoutMs}ms (job: ${jobTimeout}ms)`
    );

    if (stopSequences && stopSequences.length > 0) {
      logger.debug(
        { stopSequences },
        '[LLMInvoker] Using stop sequences for identity bleeding prevention'
      );
    }

    // Use retryService for consistent retry behavior
    // Fast-fail on permanent errors (auth, quota, content policy, etc.)
    const result = await withRetry(
      () => this.invokeSingleAttempt(model, transformedMessages, modelName, stopSequences),
      {
        maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
        globalTimeoutMs,
        logger,
        operationName: `LLM invocation (${modelName})`,
        shouldRetry: shouldRetryError,
      }
    );

    // Post-process response for reasoning models (strip thinking tags)
    const processedResponse = this.processReasoningModelResponse(
      result.value,
      reasoningConfig,
      modelName
    );

    logger.info(
      { modelName, attempts: result.attempts, totalTimeMs: result.totalTimeMs },
      '[LLMInvoker] LLM invocation completed'
    );

    return processedResponse;
  }

  /**
   * Process response from reasoning models to strip thinking tags
   */
  private processReasoningModelResponse(
    response: BaseMessage,
    config: ReasoningModelConfig,
    modelName: string
  ): BaseMessage {
    if (!config.mayContainThinkingTags) {
      return response;
    }

    // Extract content
    const originalContent = Array.isArray(response.content)
      ? response.content.map(c => (typeof c === 'object' && 'text' in c ? c.text : '')).join('')
      : typeof response.content === 'string'
        ? response.content
        : '';

    // Strip thinking tags
    const strippedContent = stripThinkingTags(originalContent);

    if (strippedContent !== originalContent) {
      const removedLength = originalContent.length - strippedContent.length;
      logger.info(
        {
          modelName,
          originalLength: originalContent.length,
          strippedLength: strippedContent.length,
          removedLength,
        },
        '[LLMInvoker] Stripped thinking tags from reasoning model response'
      );

      // Return new AIMessage with stripped content
      return new AIMessage({
        content: strippedContent,
        additional_kwargs: response.additional_kwargs,
      });
    }

    return response;
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
}
