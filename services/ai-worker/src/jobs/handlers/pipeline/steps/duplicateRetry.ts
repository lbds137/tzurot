/**
 * Cross-turn duplicate + empty-response retry loop — extracted from
 * GenerationStep (max-lines). One cohesive state machine: retries when the
 * model produces empty content post-processing or a response duplicating a
 * recent assistant message, escalating params per attempt.
 */

import { type AIProvider } from '@tzurot/common-types/constants/ai';
import { RETRY_CONFIG } from '@tzurot/common-types/constants/timing';
import { type ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';
import { type MessageContent } from '@tzurot/common-types/types/ai';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import type { ConversationalRAGService } from '../../../../services/ConversationalRAGService.js';
import type {
  RAGResponse,
  ConversationContext,
} from '../../../../services/ConversationalRAGTypes.js';
import {
  buildRetryConfig,
  type EmbeddingServiceInterface,
} from '../../../../utils/duplicateDetection.js';
import { isRecentDuplicateAsync } from '../../../../utils/crossTurnDetection.js';
import { type DiagnosticCollector } from '../../../../services/DiagnosticCollector.js';
import {
  shouldRetryEmptyResponse,
  logDuplicateDetection,
  logRetryEscalation,
  logRetrySuccess,
  selectBetterFallback,
  logFallbackUsed,
  restoreThinking,
  type FallbackResponse,
} from './RetryDecisionHelper.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { cloneContextForRetry } from './contextCloner.js';

const logger = createLogger('duplicateRetry');

/**
 * Generate response with cross-turn duplication and empty response retry.
 * Treats duplicate and empty responses as retryable failures, matching LLM retry pattern.
 * Uses RETRY_CONFIG.MAX_ATTEMPTS (3 attempts = 1 initial + 2 retries).
 *
 * Retries on:
 * - Empty content after post-processing (e.g., model produced only thinking blocks)
 * - Duplicate responses matching recent assistant messages (up to 5)
 */
// eslint-disable-next-line sonarjs/cognitive-complexity, max-lines-per-function, max-statements -- single cohesive retry loop; extracting sub-steps would scatter the state machine across files
export async function generateWithDuplicateRetry(
  ragService: ConversationalRAGService,
  embeddingService: EmbeddingServiceInterface | undefined,
  opts: {
    personality: Parameters<ConversationalRAGService['generateResponse']>[0];
    message: MessageContent;
    conversationContext: ConversationContext;
    recentAssistantMessages: string[];
    apiKey: string | undefined;
    sttDispatch: SttDispatch | undefined;
    isGuestMode: boolean;
    jobId: string | undefined;
    diagnosticCollector?: DiagnosticCollector;
    configOverrides?: ResolvedConfigOverrides;
    effectiveProvider?: AIProvider;
    maxLlmAttempts?: number;
  }
): Promise<{
  response: RAGResponse;
  duplicateRetries: number;
  emptyRetries: number;
  leakedThinkingRetries: number;
}> {
  const {
    personality,
    message,
    conversationContext,
    recentAssistantMessages,
    apiKey,
    isGuestMode,
    jobId,
    diagnosticCollector,
    configOverrides,
    effectiveProvider,
  } = opts;

  let duplicateRetries = 0;
  let emptyRetries = 0;
  let leakedThinkingRetries = 0;
  let preservedThinking: string | undefined;
  let fallback: FallbackResponse | undefined;
  const maxAttempts = RETRY_CONFIG.MAX_ATTEMPTS; // 3 = 1 initial + 2 retries

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Reset diagnostic timing to prevent stale end timestamps from a prior
    // attempt producing negative llmInvocationMs values
    diagnosticCollector?.resetLlmTimingForRetry();

    // Build escalating retry config based on attempt number
    const retryConfig = buildRetryConfig(attempt);
    logRetryEscalation(jobId, attempt, retryConfig);

    // Clone context for each attempt to prevent mutation bleeding across retries.
    // The RAG service mutates rawConversationHistory (injectImageDescriptions),
    // so we need a fresh copy for each attempt.
    const attemptContext = cloneContextForRetry(conversationContext);

    // Generate response - each call gets new request_id via entropy injection
    // Pass retry config for escalating parameters on duplicate retries
    // IMPORTANT: skipMemoryStorage=true prevents storing memory on every retry attempt.
    // Memory is stored ONCE after the retry loop completes (see process method).
    // diagnosticCollector captures data from each attempt - overwrites with final attempt's data
    let response: RAGResponse;
    try {
      response = await ragService.generateResponse(personality, message, attemptContext, {
        userApiKey: apiKey,
        sttDispatch: opts.sttDispatch,
        isGuestMode,
        retryConfig: { attempt, ...retryConfig },
        skipMemoryStorage: true,
        diagnosticCollector,
        configOverrides,
        // Capped from the provider the request actually hits: z.ai-direct uses
        // z.ai's documented limit, OpenRouter fallthrough uses the OR cache.
        effectiveProvider,
        // 1 for the auto-promotion primary attempt (fail fast → OpenRouter
        // fallback on a z.ai transient/429); undefined elsewhere (default budget).
        maxLlmAttempts: opts.maxLlmAttempts,
      });
    } catch (error) {
      // LLM invocation failed entirely. If we have a fallback from a prior
      // attempt (rejected as duplicate/empty but with content), return it
      // instead of propagating the error and losing valid content.
      if (fallback !== undefined) {
        logFallbackUsed(fallback, jobId);
        restoreThinking(fallback.response, preservedThinking);
        return {
          response: fallback.response,
          duplicateRetries,
          emptyRetries,
          leakedThinkingRetries,
        };
      }
      // No fallback available - rethrow to preserve existing error behavior
      throw error;
    }

    // Preserve reasoning from any attempt (even failed/retried ones)
    // Some models don't reliably produce reasoning at escalated temperature,
    // so we carry forward reasoning from earlier attempts
    if (response.thinkingContent !== undefined && response.thinkingContent.length > 0) {
      preservedThinking = response.thinkingContent;
    }

    // Check for empty content after post-processing (e.g., only thinking blocks)
    const emptyAction = shouldRetryEmptyResponse({ response, attempt, maxAttempts, jobId });
    if (emptyAction === 'retry') {
      emptyRetries++;
      fallback = selectBetterFallback(fallback, { response, reason: 'empty', attempt });
      continue;
    }
    if (emptyAction === 'return') {
      emptyRetries++;
      restoreThinking(response, preservedThinking);
      return { response, duplicateRetries, emptyRetries, leakedThinkingRetries };
    }

    // Leaked chain-of-thought (reasoning glitch) — retry with fallback
    if (response.onlyThinkingProduced === true) {
      leakedThinkingRetries++;
      if (attempt < maxAttempts) {
        logger.warn({ jobId, attempt }, 'Leaked chain-of-thought — retrying');
        fallback = selectBetterFallback(fallback, {
          response,
          reason: 'leaked-thinking',
          attempt,
        });
        continue;
      }
      // Final attempt also leaked — log for flight recorder, then fall through
      // to duplicate check. Bad response > no response.
      logger.error(
        { jobId, attempt, contentLength: response.content.length },
        'All attempts produced leaked chain-of-thought'
      );
    }
    // Check for duplicate responses (async: includes semantic embedding layer)
    const { isDuplicate, matchIndex } = await isRecentDuplicateAsync(
      response.content,
      recentAssistantMessages,
      embeddingService
    );

    if (!isDuplicate) {
      if (duplicateRetries > 0 || emptyRetries > 0 || leakedThinkingRetries > 0) {
        logRetrySuccess({
          jobId,
          modelUsed: response.modelUsed,
          attempt,
          duplicateRetries,
          emptyRetries,
          leakedThinkingRetries,
        });
      }
      restoreThinking(response, preservedThinking);
      return { response, duplicateRetries, emptyRetries, leakedThinkingRetries };
    }

    // Duplicate detected - log and determine action
    duplicateRetries++;
    fallback = selectBetterFallback(fallback, { response, reason: 'duplicate', attempt });
    const dupAction = logDuplicateDetection({
      response,
      attempt,
      maxAttempts,
      matchIndex,
      jobId,
      isGuestMode,
    });
    if (dupAction === 'return') {
      restoreThinking(response, preservedThinking);
      return { response, duplicateRetries, emptyRetries, leakedThinkingRetries };
    }
  }

  // This is unreachable but TypeScript needs it for exhaustiveness
  throw new Error('[GenerationStep] Unexpected: no response generated');
}
