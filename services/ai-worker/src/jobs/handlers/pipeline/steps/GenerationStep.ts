/**
 * Generation Step
 *
 * Generates AI response using the RAG service with all prepared context.
 */

import {
  createLogger,
  MessageContent,
  RETRY_CONFIG,
  ApiErrorCategory,
  ApiErrorType,
  generateErrorReferenceId,
  USER_ERROR_MESSAGES,
  type ResolvedConfigOverrides,
} from '@tzurot/common-types';
import type { ConversationalRAGService } from '../../../../services/ConversationalRAGService.js';
import type {
  RAGResponse,
  ConversationContext,
} from '../../../../services/ConversationalRAGTypes.js';
import type { IPipelineStep, GenerationContext } from '../types.js';
import { parseApiError, getErrorLogContext } from '../../../../utils/apiErrorParser.js';
import { RetryError } from '../../../../utils/retry.js';
import {
  buildRetryConfig,
  type EmbeddingServiceInterface,
} from '../../../../utils/duplicateDetection.js';
import { isRecentDuplicateAsync } from '../../../../utils/crossTurnDetection.js';
import { getRecentAssistantMessages } from '../../../../utils/conversationHistoryUtils.js';
import { DiagnosticCollector } from '../../../../services/DiagnosticCollector.js';
import {
  shouldRetryEmptyResponse,
  logDuplicateDetection,
  logRetryEscalation,
  logRetrySuccess,
  selectBetterFallback,
  logFallbackUsed,
  type FallbackResponse,
} from './RetryDecisionHelper.js';
import { storeDiagnosticLog } from './diagnosticStorage.js';
import { cloneContextForRetry } from './contextCloner.js';
import { logDuplicateDetectionSetup } from './duplicateDetectionDiagnostics.js';
import { buildConversationContext } from './conversationContextBuilder.js';

const logger = createLogger('GenerationStep');

/** Validate that required pipeline steps have run */
function validatePrerequisites(context: GenerationContext): void {
  if (!context.config) {
    throw new Error('[GenerationStep] ConfigStep must run before GenerationStep');
  }
  if (!context.auth) {
    throw new Error('[GenerationStep] AuthStep must run before GenerationStep');
  }
  if (!context.preparedContext) {
    throw new Error('[GenerationStep] ContextStep must run before GenerationStep');
  }
}

export class GenerationStep implements IPipelineStep {
  readonly name = 'Generation';

  constructor(
    private readonly ragService: ConversationalRAGService,
    private readonly embeddingService?: EmbeddingServiceInterface
  ) {}

  /** Inject preserved reasoning into a response that lacks its own */
  private restoreThinking(response: RAGResponse, preserved: string | undefined): void {
    if (
      (response.thinkingContent === undefined || response.thinkingContent.length === 0) &&
      preserved !== undefined &&
      preserved.length > 0
    ) {
      response.thinkingContent = preserved;
    }
  }

  /**
   * Generate response with cross-turn duplication and empty response retry.
   * Treats duplicate and empty responses as retryable failures, matching LLM retry pattern.
   * Uses RETRY_CONFIG.MAX_ATTEMPTS (3 attempts = 1 initial + 2 retries).
   *
   * Retries on:
   * - Empty content after post-processing (e.g., model produced only thinking blocks)
   * - Duplicate responses matching recent assistant messages (up to 5)
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity -- retry loop with thinking preservation across multiple exit paths
  private async generateWithDuplicateRetry(opts: {
    personality: Parameters<ConversationalRAGService['generateResponse']>[0];
    message: MessageContent;
    conversationContext: ConversationContext;
    recentAssistantMessages: string[];
    apiKey: string | undefined;
    isGuestMode: boolean;
    jobId: string | undefined;
    diagnosticCollector?: DiagnosticCollector;
    configOverrides?: ResolvedConfigOverrides;
  }): Promise<{ response: RAGResponse; duplicateRetries: number; emptyRetries: number }> {
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
    } = opts;

    let duplicateRetries = 0;
    let emptyRetries = 0;
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
          isGuestMode,
          retryConfig: { attempt, ...retryConfig },
          skipMemoryStorage: true,
          diagnosticCollector,
          configOverrides,
        });
      } catch (error) {
        // LLM invocation failed entirely. If we have a fallback from a prior
        // attempt (rejected as duplicate/empty but with content), return it
        // instead of propagating the error and losing valid content.
        if (fallback !== undefined) {
          logFallbackUsed(fallback, jobId);
          this.restoreThinking(fallback.response, preservedThinking);
          return {
            response: fallback.response,
            duplicateRetries,
            emptyRetries,
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
        this.restoreThinking(response, preservedThinking);
        return { response, duplicateRetries, emptyRetries };
      }

      // Check for duplicate responses
      // Use async version with optional embedding service for semantic layer (Layer 4)
      const { isDuplicate, matchIndex } = await isRecentDuplicateAsync(
        response.content,
        recentAssistantMessages,
        this.embeddingService
      );

      if (!isDuplicate) {
        if (duplicateRetries > 0 || emptyRetries > 0) {
          logRetrySuccess(jobId, response.modelUsed, attempt, duplicateRetries, emptyRetries);
        }
        this.restoreThinking(response, preservedThinking);
        return { response, duplicateRetries, emptyRetries };
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
        this.restoreThinking(response, preservedThinking);
        return { response, duplicateRetries, emptyRetries };
      }
    }

    // This is unreachable but TypeScript needs it for exhaustiveness
    throw new Error('[GenerationStep] Unexpected: no response generated');
  }

  // eslint-disable-next-line max-lines-per-function, complexity -- Pipeline step with diagnostic logging and error handling
  async process(context: GenerationContext): Promise<GenerationContext> {
    const { job, startTime, preprocessing } = context;
    const { requestId, personality, message, context: jobContext } = job.data;

    validatePrerequisites(context);

    // After validation, we know these are defined
    const config = context.config;
    const auth = context.auth;
    const preparedContext = context.preparedContext;
    if (!config || !auth || !preparedContext) {
      throw new Error('[GenerationStep] Prerequisites validation failed');
    }

    const { effectivePersonality, configSource } = config;
    const { apiKey, provider, isGuestMode } = auth;

    logger.info(
      {
        jobId: job.id,
        hasReferencedMessages: !!jobContext.referencedMessages,
        referencedMessagesCount: jobContext.referencedMessages?.length ?? 0,
      },
      '[GenerationStep] Processing with context'
    );

    // Create diagnostic collector for flight recorder (captures full pipeline data)
    const diagnosticCollector = new DiagnosticCollector({
      requestId,
      triggerMessageId: jobContext.triggerMessageId,
      personalityId: effectivePersonality.id,
      personalityName: effectivePersonality.name,
      userId: jobContext.userId,
      guildId: jobContext.serverId ?? null,
      channelId: jobContext.channelId ?? '',
    });

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

      // Generate response with automatic retry on empty content and cross-turn duplication
      const { response, duplicateRetries, emptyRetries } = await this.generateWithDuplicateRetry({
        personality: effectivePersonality,
        message: message as MessageContent,
        conversationContext,
        recentAssistantMessages,
        apiKey,
        isGuestMode,
        jobId: job.id,
        diagnosticCollector,
        configOverrides: context.configOverrides,
      });

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
            { jobId: job.id, error },
            '[GenerationStep] Failed to store deferred memory - continuing without memory storage'
          );
        }
      }

      const processingTimeMs = Date.now() - startTime;
      logger.info(
        { jobId: job.id, processingTimeMs, duplicateRetries, emptyRetries },
        '[GenerationStep] Generation completed'
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
          '[GenerationStep] All retry attempts produced empty content'
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
              providerUsed: provider,
              configSource,
              isGuestMode,
              // Include thinking content so it can be shown even on failure
              thinkingContent: response.thinkingContent,
              showThinking: effectivePersonality.showThinking,
            },
          },
        };
      }

      // Fire-and-forget: Store diagnostic data for flight recorder
      // This runs async and doesn't block the response
      storeDiagnosticLog(
        diagnosticCollector,
        response.modelUsed ?? 'unknown',
        provider ?? 'unknown'
      );

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
            providerUsed: provider,
            configSource,
            isGuestMode,
            crossTurnDuplicateDetected: duplicateRetries > 0,
            focusModeEnabled: response.focusModeEnabled,
            incognitoModeActive: response.incognitoModeActive,
            thinkingContent: response.thinkingContent,
            showThinking: effectivePersonality.showThinking,
          },
        },
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const underlyingError = error instanceof RetryError ? error.lastError : error;
      const errorInfo = parseApiError(underlyingError);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(
        { err: error, jobId: job.id, ...getErrorLogContext(underlyingError) },
        `[GenerationStep] Generation failed: ${errorInfo.category}`
      );

      // Record partial LLM response for /admin debug visibility
      // The LLMInvoker may have thrown before recordLlmResponse() was called
      diagnosticCollector.recordPartialLlmResponse({
        rawContent: '[error — see error data]',
        modelUsed: effectivePersonality.model ?? 'unknown',
      });

      // Record error in diagnostic collector for debugging failed requests
      diagnosticCollector.recordError({
        message: errorMessage,
        category: errorInfo.category,
        referenceId: errorInfo.referenceId,
        rawError: getErrorLogContext(underlyingError),
        failedAtStage: 'GenerationStep',
      });

      // Store diagnostic data even for failures (fire-and-forget)
      // This enables /admin debug to show what went wrong
      storeDiagnosticLog(
        diagnosticCollector,
        effectivePersonality.model ?? 'unknown',
        provider ?? 'unknown'
      );

      return {
        ...context,
        result: {
          requestId,
          success: false,
          error: errorMessage,
          personalityErrorMessage: personality.errorMessage,
          errorInfo,
          metadata: {
            processingTimeMs,
            modelUsed: effectivePersonality.model ?? undefined,
            providerUsed: provider,
            configSource,
            isGuestMode,
          },
        },
      };
    }
  }
}
