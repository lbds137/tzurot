/**
 * LLM Invoker
 *
 * Handles language model invocation with retry logic, timeout handling, and model caching.
 * Extracted from ConversationalRAGService for better modularity and testability.
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
import { createChatModel, getModelCacheKey, type ChatModelResult } from './ModelFactory.js';
import { withRetry } from '../utils/retryService.js';

const logger = createLogger('LLMInvoker');

export class LLMInvoker {
  private models = new Map<string, ChatModelResult>();

  /**
   * Get or create a chat model for a specific configuration
   * This supports BYOK (Bring Your Own Key) - different users can use different keys
   * Returns both the model and the validated model name
   */
  getModel(modelName?: string, apiKey?: string, temperature?: number): ChatModelResult {
    const cacheKey = getModelCacheKey({ modelName, apiKey, temperature });

    if (!this.models.has(cacheKey)) {
      this.models.set(
        cacheKey,
        createChatModel({
          modelName,
          apiKey,
          temperature: temperature ?? 0.7,
        })
      );
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
   *
   * @param model - LangChain chat model to invoke
   * @param messages - Message array to send to the model
   * @param modelName - Model name for logging
   * @param imageCount - Number of images in the request (for timeout calculation)
   * @param audioCount - Number of audio attachments in the request (for timeout calculation)
   */
  async invokeWithRetry(
    model: BaseChatModel,
    messages: BaseMessage[],
    modelName: string,
    imageCount = 0,
    audioCount = 0
  ): Promise<BaseMessage> {
    // Calculate job timeout for logging (attachments processed in separate jobs)
    const jobTimeout = calculateJobTimeout(imageCount, audioCount);
    // LLM always gets full independent timeout budget (480s = 8 minutes)
    const globalTimeoutMs = TIMEOUTS.LLM_INVOCATION;

    logger.info(
      {
        modelName,
        imageCount,
        audioCount,
        jobTimeout,
        globalTimeoutMs,
      },
      `[LLMInvoker] Dynamic timeout calculated: ${globalTimeoutMs}ms (job: ${jobTimeout}ms)`
    );

    // Use retryService for consistent retry behavior
    const result = await withRetry(
      () => this.invokeSingleAttempt(model, messages, modelName),
      {
        maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
        globalTimeoutMs,
        logger,
        operationName: `LLM invocation (${modelName})`,
      }
    );

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
   * @throws Error on timeout, network errors, or empty responses
   * @private
   */
  private async invokeSingleAttempt(
    model: BaseChatModel,
    messages: BaseMessage[],
    modelName: string
  ): Promise<BaseMessage> {
    // Invoke with per-attempt timeout (3 minutes per attempt)
    const response = await model.invoke(messages, { timeout: TIMEOUTS.LLM_PER_ATTEMPT });

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

    return response;
  }
}
