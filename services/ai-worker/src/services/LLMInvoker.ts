/**
 * LLM Invoker
 *
 * Handles language model invocation with retry logic, timeout handling, and model caching.
 * Extracted from ConversationalRAGService for better modularity and testability.
 */

import { BaseMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createLogger, RETRY_CONFIG, TIMEOUTS } from '@tzurot/common-types';
import { createChatModel, getModelCacheKey, type ChatModelResult } from './ModelFactory.js';

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

    return this.models.get(cacheKey)!;
  }

  /**
   * Invoke LLM with timeout and retry logic for transient errors
   *
   * Features:
   * - Retries on transient network errors (ECONNRESET, ETIMEDOUT, ENOTFOUND)
   * - Exponential backoff between retries
   * - Global timeout to prevent exceeding gateway JOB_WAIT limit
   * - Per-attempt timeout reduction based on remaining time
   */
  async invokeWithRetry(
    model: BaseChatModel,
    messages: BaseMessage[],
    modelName: string
  ): Promise<BaseMessage> {
    const startTime = Date.now();
    const maxRetries = RETRY_CONFIG.LLM_MAX_RETRIES;
    const globalTimeoutMs = RETRY_CONFIG.LLM_GLOBAL_TIMEOUT;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Check if we've exceeded global timeout before attempting
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs >= globalTimeoutMs) {
        logger.error(
          {
            modelName,
            elapsedMs,
            globalTimeoutMs,
            attempt: attempt + 1,
          },
          `[LLMInvoker] Global timeout exceeded after ${elapsedMs}ms (limit: ${globalTimeoutMs}ms)`
        );
        throw new Error(`LLM invocation global timeout exceeded after ${elapsedMs}ms`);
      }

      // Calculate remaining time for this attempt
      const remainingMs = globalTimeoutMs - elapsedMs;
      const attemptTimeoutMs = Math.min(TIMEOUTS.LLM_API, remainingMs);

      try {
        logger.info(
          {
            modelName,
            attempt: attempt + 1,
            maxAttempts: maxRetries + 1,
            attemptTimeoutMs,
            remainingMs,
          },
          `[LLMInvoker] Invoking LLM (attempt ${attempt + 1}/${maxRetries + 1}, timeout: ${attemptTimeoutMs}ms)`
        );

        // Invoke with calculated timeout (respects global timeout)
        const response = await model.invoke(messages, { timeout: attemptTimeoutMs });

        if (attempt > 0) {
          logger.info(
            { modelName, attempt: attempt + 1 },
            '[LLMInvoker] LLM invocation succeeded after retry'
          );
        }

        return response;
      } catch (error) {
        // Check if this is a transient network error worth retrying
        // Check both error.code (Node.js native errors) and error.message (wrapped errors)
        const errorCode = (error as any).code;
        const errorMessage = error instanceof Error ? error.message : '';
        const errorStatus = (error as any).status; // Some APIs use status field
        const isTransientError =
          errorCode === 'ECONNRESET' ||
          errorCode === 'ETIMEDOUT' ||
          errorCode === 'ENOTFOUND' ||
          errorCode === 'ECONNREFUSED' ||
          errorCode === 'ABORTED' ||
          errorStatus === 'ABORTED' ||
          errorMessage.includes('ECONNRESET') ||
          errorMessage.includes('ETIMEDOUT') ||
          errorMessage.includes('ENOTFOUND') ||
          errorMessage.includes('ABORTED');

        if (isTransientError && attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt) * RETRY_CONFIG.LLM_RETRY_BASE_DELAY;
          logger.warn(
            {
              err: error,
              modelName,
              attempt: attempt + 1,
              nextRetryInMs: delayMs,
              elapsedMs: Date.now() - startTime,
            },
            `[LLMInvoker] LLM invocation failed with transient error, retrying in ${delayMs}ms`
          );

          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        // Non-retryable error or out of retries
        if (attempt === maxRetries) {
          logger.error(
            {
              err: error,
              modelName,
              attempts: maxRetries + 1,
              totalElapsedMs: Date.now() - startTime,
            },
            `[LLMInvoker] LLM invocation failed after ${maxRetries + 1} attempts`
          );
        }

        throw error;
      }
    }

    // This line is unreachable (loop always returns or throws), but TypeScript doesn't know that
    throw new Error('LLM invocation failed - all retries exhausted');
  }
}
