/**
 * Cross-turn duplicate + empty-response retry loop — extracted from
 * GenerationStep (max-lines). One cohesive state machine: retries when the
 * model produces empty content post-processing or a response duplicating a
 * recent assistant message, escalating params per attempt.
 */

import { RETRY_CONFIG } from '@tzurot/common-types/constants/timing';
import type { ConversationalRAGService } from '../../../../services/ConversationalRAGService.js';
import type { RAGResponse } from '../../../../services/ConversationalRAGTypes.js';
import type { GenerateAttemptOpts } from './autoPromotionFallback.js';
import {
  buildRetryConfig,
  type EmbeddingServiceInterface,
} from '../../../../utils/duplicateDetection.js';
import { isRecentDuplicateAsync } from '../../../../utils/crossTurnDetection.js';
import {
  shouldRetryEmptyResponse,
  shouldRetryEchoResponse,
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
 * - Content that merely echoes the user's own message back
 * - Duplicate responses matching recent assistant messages (up to 5)
 */
// eslint-disable-next-line sonarjs/cognitive-complexity, max-lines-per-function, max-statements -- single cohesive retry loop; extracting sub-steps would scatter the state machine across files
export async function generateWithDuplicateRetry(
  ragService: ConversationalRAGService,
  embeddingService: EmbeddingServiceInterface | undefined,
  // Single-sourced with autoPromotionFallback: both files pass this exact
  // contract to the same attempt function, and a locally redeclared copy can
  // drift by one field without the compiler noticing at either end.
  opts: GenerateAttemptOpts
): Promise<{
  response: RAGResponse;
  duplicateRetries: number;
  emptyRetries: number;
  echoRetries: number;
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
  let echoRetries = 0;
  let leakedThinkingRetries = 0;
  let preservedThinking: string | undefined;
  let fallback: FallbackResponse | undefined;
  const maxAttempts = RETRY_CONFIG.MAX_ATTEMPTS; // 3 = 1 initial + 2 retries

  // The echo check compares against the user's CURRENT turn. `message` carries
  // that turn either bare or wrapped alongside reference/attachment metadata;
  // `content` is the text in both shapes.
  const userMessageText = typeof message === 'string' ? message : message.content;

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

    // Generate response with escalating sampling parameters on duplicate retries
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
          echoRetries,
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
      return { response, duplicateRetries, emptyRetries, echoRetries, leakedThinkingRetries };
    }

    // Echoed input: content that is the user's own message back. Checked after
    // the empty gate so an empty response keeps reporting as empty. The
    // reasoning content is deliberately NOT promoted into the reply slot — on a
    // response whose reasoning holds the real reply, that would publish raw
    // chain-of-thought as the character's voice.
    const echoAction = shouldRetryEchoResponse({
      response,
      userMessage: userMessageText,
      attempt,
      maxAttempts,
      jobId,
    });
    if (echoAction === 'retry') {
      echoRetries++;
      fallback = selectBetterFallback(fallback, { response, reason: 'echo', attempt });
      continue;
    }
    if (echoAction === 'return') {
      echoRetries++;
      restoreThinking(response, preservedThinking);
      return { response, duplicateRetries, emptyRetries, echoRetries, leakedThinkingRetries };
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
      if (
        duplicateRetries > 0 ||
        emptyRetries > 0 ||
        echoRetries > 0 ||
        leakedThinkingRetries > 0
      ) {
        logRetrySuccess({
          jobId,
          modelUsed: response.modelUsed,
          attempt,
          duplicateRetries,
          emptyRetries,
          echoRetries,
          leakedThinkingRetries,
        });
      }
      restoreThinking(response, preservedThinking);
      return { response, duplicateRetries, emptyRetries, echoRetries, leakedThinkingRetries };
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
      return { response, duplicateRetries, emptyRetries, echoRetries, leakedThinkingRetries };
    }
  }

  // This is unreachable but TypeScript needs it for exhaustiveness
  throw new Error('[GenerationStep] Unexpected: no response generated');
}
