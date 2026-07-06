/**
 * Generation Step
 *
 * Generates AI response using the RAG service with all prepared context.
 */

import { type AIProvider } from '@tzurot/common-types/constants/ai';
import {
  ApiErrorCategory,
  ApiErrorType,
  generateErrorReferenceId,
  USER_ERROR_MESSAGES,
} from '@tzurot/common-types/constants/error';
import { RETRY_CONFIG } from '@tzurot/common-types/constants/timing';
import { type ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type MessageContent } from '@tzurot/common-types/types/ai';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { createDiagnosticCollectorForRequest } from '../../../../services/diagnostics/personalityOwnerResolver.js';
import type { ConversationalRAGService } from '../../../../services/ConversationalRAGService.js';
import type {
  RAGResponse,
  ConversationContext,
} from '../../../../services/ConversationalRAGTypes.js';
import type { IPipelineStep, GenerationContext } from '../types.js';
import {
  buildRetryConfig,
  type EmbeddingServiceInterface,
} from '../../../../utils/duplicateDetection.js';
import { isRecentDuplicateAsync } from '../../../../utils/crossTurnDetection.js';
import { runWithAutoPromotionFallback } from './autoPromotionFallback.js';
import {
  composeQuotaFallbackInfo,
  runWithQuotaFallback,
  type QuotaFallbackDeps,
} from './quotaFallbackRunner.js';
import { composeGenerationFailureResult } from './generationFailureResult.js';
import { validatePrerequisites } from './generationStepValidation.js';
import { getRecentAssistantMessages } from '../../../../utils/conversationHistoryUtils.js';
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
import { storeDiagnosticLog } from './diagnosticStorage.js';
import { cloneContextForRetry } from './contextCloner.js';
import { logDuplicateDetectionSetup } from './duplicateDetectionDiagnostics.js';
import { buildConversationContext } from './conversationContextBuilder.js';

const logger = createLogger('GenerationStep');

export class GenerationStep implements IPipelineStep {
  readonly name = 'Generation';

  constructor(
    private readonly ragService: ConversationalRAGService,
    private readonly prisma: PrismaClient,
    private readonly embeddingService?: EmbeddingServiceInterface,
    private readonly quotaFallbackDeps?: QuotaFallbackDeps
  ) {}

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
  private async generateWithDuplicateRetry(opts: {
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
  }): Promise<{
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
        response = await this.ragService.generateResponse(personality, message, attemptContext, {
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
        this.embeddingService
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

  // eslint-disable-next-line max-lines-per-function -- Pipeline step with diagnostic logging and error handling
  async process(context: GenerationContext): Promise<GenerationContext> {
    const { job, startTime, preprocessing } = context;
    const { requestId, personality, message, context: jobContext } = job.data;

    // The `asserts` annotation on validatePrerequisites narrows `context` to
    // ReadyGenerationContext for the rest of this scope, so config/auth/
    // preparedContext are typed as non-undefined without a redundant guard.
    validatePrerequisites(context);
    const { config, auth, preparedContext } = context;
    const { effectivePersonality, configSource } = config;
    const { apiKey, provider, isGuestMode } = auth;

    logger.info(
      {
        jobId: job.id,
        hasReferencedMessages: !!jobContext.referencedMessages,
        referencedMessagesCount: jobContext.referencedMessages?.length ?? 0,
      },
      'Processing with context'
    );

    const diagnosticCollector = await createDiagnosticCollectorForRequest({
      prisma: this.prisma,
      requestId,
      triggerMessageId: jobContext.triggerMessageId,
      userId: jobContext.userId,
      serverId: jobContext.serverId,
      channelId: jobContext.channelId,
      personalityId: effectivePersonality.id,
      personalityName: effectivePersonality.name,
      personalityOwnerInternalId: effectivePersonality.ownerId,
    });
    // Stash on context so downstream pipeline stages can append data
    // before the orchestrator stores the final diagnostic log.
    context.diagnosticCollector = diagnosticCollector;

    try {
      // Build conversation context once (reused for retry if needed)
      const conversationContext = buildConversationContext(
        jobContext,
        preparedContext,
        preprocessing
      );

      // Get recent assistant messages for cross-turn duplicate detection
      // Checks up to 5 previous messages to catch duplicates of older responses
      const recentAssistantMessages = getRecentAssistantMessages(
        preparedContext.rawConversationHistory
      );

      // Log diagnostic info for duplicate detection setup
      logDuplicateDetectionSetup({
        jobId: job.id,
        rawConversationHistory: preparedContext.rawConversationHistory,
        recentAssistantMessages,
      });

      // Generate response with automatic retry on empty content and cross-turn duplication.
      // Two one-shot fallback layers wrap the attempt, innermost first:
      // - `runWithAutoPromotionFallback`: when ProviderRouter auto-promoted the request
      //   to z.ai-direct, a failure retries once via the pre-computed OpenRouter route
      //   (catalog-drift defense).
      // - `runWithQuotaFallback`: a quota-class failure (QUOTA_EXCEEDED /
      //   CREDIT_EXHAUSTION) retargets once to the tier-aware admin default. Its retry
      //   deliberately bypasses the auto-promotion wrapper — that wrapper's fallback
      //   route belongs to the PRIMARY model.
      const attemptOpts = {
        personality: effectivePersonality,
        message: message as MessageContent,
        conversationContext,
        recentAssistantMessages,
        apiKey,
        sttDispatch: auth.sttDispatch,
        isGuestMode,
        jobId: job.id,
        diagnosticCollector,
        configOverrides: context.configOverrides,
        // Primary attempt routes to the resolved provider; the fallback
        // wrapper overrides this to OpenRouter if it swaps to the fallback.
        effectiveProvider: provider,
      };
      const {
        response,
        duplicateRetries,
        emptyRetries,
        leakedThinkingRetries,
        effectiveProviderUsed,
        quotaFallback: reactiveQuotaFallback,
      } = await runWithQuotaFallback({
        primary: () =>
          runWithAutoPromotionFallback(
            opts => this.generateWithDuplicateRetry(opts),
            attemptOpts,
            auth.wasAutoPromoted === true ? auth.fallback : undefined
          ),
        retry: opts => this.generateWithDuplicateRetry(opts),
        opts: attemptOpts,
        userId: jobContext.userId,
        deps: this.quotaFallbackDeps,
      });
      const quotaFallbackInfo = composeQuotaFallbackInfo(reactiveQuotaFallback, auth.quotaFallback);

      // Store memory ONCE after retry loop completes with a valid response.
      // This prevents duplicate memories when retries occur (the fix for the
      // "swiss cheese" duplicate memory bug - see memory:cleanup command).
      // Wrapped in try-catch: memory storage failure shouldn't fail the job
      // since the user already has their validated response.
      if (response.deferredMemoryData !== undefined && response.incognitoModeActive !== true) {
        try {
          await this.ragService.storeDeferredMemory(
            effectivePersonality,
            conversationContext,
            response.deferredMemoryData
          );
        } catch (error) {
          logger.error(
            { jobId: job.id, err: error },
            'Failed to store deferred memory - continuing without memory storage'
          );
        }
      }

      const processingTimeMs = Date.now() - startTime;
      logger.info(
        { jobId: job.id, processingTimeMs, duplicateRetries, emptyRetries, leakedThinkingRetries },
        'Generation completed'
      );

      // Final check for empty content (fallback after retry loop exhausted)
      // This handles the case where all retries still produced empty responses
      if (response.content.length === 0) {
        const emptyErrorMessage = 'LLM returned empty response after all retry attempts';
        const emptyReferenceId = generateErrorReferenceId();

        logger.warn(
          {
            jobId: job.id,
            hasThinking: response.thinkingContent !== undefined,
            thinkingLength: response.thinkingContent?.length ?? 0,
            emptyRetries,
          },
          'All retry attempts produced empty content'
        );

        // Record error for diagnostic flight recorder
        diagnosticCollector.recordError({
          message: emptyErrorMessage,
          category: ApiErrorCategory.EMPTY_RESPONSE,
          referenceId: emptyReferenceId,
          failedAtStage: 'GenerationStep (empty after retries)',
        });

        // Store diagnostic data for failures (fire-and-forget)
        storeDiagnosticLog(
          this.prisma,
          diagnosticCollector,
          response.modelUsed ?? 'unknown',
          provider ?? 'unknown'
        );

        return {
          ...context,
          result: {
            requestId,
            success: false,
            error: emptyErrorMessage,
            personalityErrorMessage: personality.errorMessage,
            errorInfo: {
              type: ApiErrorType.TRANSIENT,
              category: ApiErrorCategory.EMPTY_RESPONSE,
              userMessage: USER_ERROR_MESSAGES[ApiErrorCategory.EMPTY_RESPONSE],
              technicalMessage: emptyErrorMessage,
              referenceId: emptyReferenceId,
              shouldRetry: false, // Already retried with escalated params - model consistently produces empty
            },
            metadata: {
              processingTimeMs,
              modelUsed: response.modelUsed,
              providerUsed: effectiveProviderUsed ?? provider,
              configSource,
              isGuestMode,
              // Include thinking content so it can be shown even on failure
              thinkingContent: response.thinkingContent,
              showThinking: effectivePersonality.showThinking,
              showModelFooter: context.configOverrides?.showModelFooter,
              // A retarget may have fired even though the new model then
              // produced only empty responses — the swap still happened and
              // must still be announced (never silent).
              quotaFallback: quotaFallbackInfo,
            },
          },
        };
      }

      // Success-path diagnostic store happens in LLMGenerationHandler
      // (post-pipeline). Error-path stores remain inline above.

      return {
        ...context,
        result: {
          requestId,
          success: true,
          content: response.content,
          attachmentDescriptions: response.attachmentDescriptions,
          referencedMessagesDescriptions: response.referencedMessagesDescriptions,
          metadata: {
            retrievedMemories: response.retrievedMemories,
            tokensIn: response.tokensIn,
            tokensOut: response.tokensOut,
            processingTimeMs,
            modelUsed: response.modelUsed,
            // Effective provider after any auto-promotion fallback swap (OpenRouter
            // when the promoted z.ai call failed), so the footer links correctly.
            providerUsed: effectiveProviderUsed ?? provider,
            configSource,
            isGuestMode,
            crossTurnDuplicateDetected: duplicateRetries > 0,
            focusModeEnabled: response.focusModeEnabled,
            incognitoModeActive: response.incognitoModeActive,
            thinkingContent: response.thinkingContent,
            showThinking: effectivePersonality.showThinking,
            showModelFooter: context.configOverrides?.showModelFooter,
            // Tier-aware quota retarget (proactive from AuthStep or reactive
            // from the wrapper above) — the footer announces it, never silent.
            quotaFallback: quotaFallbackInfo,
          },
        },
      };
    } catch (error) {
      // Classification, fallback-story folding, diagnostic recording, and the
      // failure-result shape all live in the composer (see its module doc).
      return composeGenerationFailureResult({
        error,
        context,
        prisma: this.prisma,
        diagnosticCollector,
        effectivePersonality,
        configSource,
        provider,
        isGuestMode,
        // The proactive swap (if any) took effect for this failed attempt —
        // effectivePersonality is already the fallback model, and the error
        // footer must explain why. A failed REACTIVE retarget is not carried
        // (no reply came from its target); its story rides the
        // fallback-failure summary the composer already folds in.
        quotaFallback: auth.quotaFallback,
      });
    }
  }
}
