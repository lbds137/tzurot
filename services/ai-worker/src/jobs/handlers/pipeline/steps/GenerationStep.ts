/**
 * Generation Step
 *
 * Generates AI response using the RAG service with all prepared context.
 */

/* eslint-disable max-lines -- TODO: Extract diagnostic storage and retry helpers to reduce file size */

import {
  createLogger,
  MessageContent,
  RETRY_CONFIG,
  getPrismaClient,
  ApiErrorCategory,
  ApiErrorType,
  generateErrorReferenceId,
  USER_ERROR_MESSAGES,
} from '@tzurot/common-types';
import type {
  ConversationalRAGService,
  RAGResponse,
  ConversationContext,
} from '../../../../services/ConversationalRAGService.js';
import type {
  IPipelineStep,
  GenerationContext,
  PreparedContext,
  PreprocessingResults,
} from '../types.js';
import { parseApiError, getErrorLogContext } from '../../../../utils/apiErrorParser.js';
import { RetryError } from '../../../../utils/retry.js';
import {
  isRecentDuplicateAsync,
  buildRetryConfig,
  type EmbeddingServiceInterface,
} from '../../../../utils/duplicateDetection.js';
import { getRecentAssistantMessages } from '../../../../utils/conversationHistoryUtils.js';
import { DiagnosticCollector } from '../../../../services/DiagnosticCollector.js';
import { sanitizeForJsonb } from '../../../../utils/jsonSanitizer.js';
import type { LLMGenerationJobData } from '@tzurot/common-types';

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

/** Build the conversation context for RAG service */
function buildConversationContext(
  jobContext: LLMGenerationJobData['context'],
  preparedContext: PreparedContext,
  preprocessing: PreprocessingResults | undefined
): ConversationContext {
  return {
    userId: jobContext.userId,
    userName: jobContext.userName,
    userTimezone: jobContext.userTimezone,
    channelId: jobContext.channelId,
    serverId: jobContext.serverId,
    sessionId: jobContext.sessionId,
    isProxyMessage: jobContext.isProxyMessage,
    activePersonaId: jobContext.activePersonaId,
    activePersonaName: jobContext.activePersonaName,
    // Guild-specific info for participants (roles, color, join date)
    activePersonaGuildInfo: jobContext.activePersonaGuildInfo,
    participantGuildInfo: jobContext.participantGuildInfo,
    conversationHistory: preparedContext.conversationHistory,
    rawConversationHistory: preparedContext.rawConversationHistory,
    oldestHistoryTimestamp: preparedContext.oldestHistoryTimestamp,
    participants: preparedContext.participants,
    attachments: jobContext.attachments,
    preprocessedAttachments:
      preprocessing && preprocessing.processedAttachments.length > 0
        ? preprocessing.processedAttachments
        : undefined,
    preprocessedReferenceAttachments:
      preprocessing && Object.keys(preprocessing.referenceAttachments).length > 0
        ? preprocessing.referenceAttachments
        : undefined,
    extendedContextAttachments: jobContext.extendedContextAttachments,
    preprocessedExtendedContextAttachments: preprocessing?.extendedContextAttachments,
    environment: jobContext.environment,
    referencedMessages: jobContext.referencedMessages,
    referencedChannels: jobContext.referencedChannels,
  };
}

export class GenerationStep implements IPipelineStep {
  readonly name = 'Generation';

  constructor(
    private readonly ragService: ConversationalRAGService,
    private readonly embeddingService?: EmbeddingServiceInterface
  ) {}

  /**
   * Clone the conversation context for retry isolation.
   *
   * The RAG service may mutate rawConversationHistory in-place (e.g., injectImageDescriptions),
   * which would affect subsequent retry attempts if not cloned. This ensures each retry gets
   * a fresh context to work with.
   */
  private cloneContextForRetry(context: ConversationContext): ConversationContext {
    return {
      ...context,
      rawConversationHistory: context.rawConversationHistory?.map(entry => ({
        ...entry,
        // Deep clone messageMetadata to prevent mutation bleeding
        messageMetadata: entry.messageMetadata
          ? {
              ...entry.messageMetadata,
              // Clone nested arrays if present
              referencedMessages: entry.messageMetadata.referencedMessages
                ? [...entry.messageMetadata.referencedMessages]
                : undefined,
              imageDescriptions: entry.messageMetadata.imageDescriptions
                ? [...entry.messageMetadata.imageDescriptions]
                : undefined,
              reactions: entry.messageMetadata.reactions
                ? [...entry.messageMetadata.reactions]
                : undefined,
            }
          : undefined,
      })),
    };
  }

  /**
   * Store diagnostic data to the database (fire-and-forget).
   *
   * This method finalizes the diagnostic collector and writes the data to
   * the llm_diagnostic_logs table. It runs asynchronously and does NOT
   * block the response - any errors are logged but don't affect the user.
   *
   * Data is automatically cleaned up after 24 hours via the scheduled
   * cleanup-diagnostic-logs job.
   */
  private storeDiagnosticLog(
    collector: DiagnosticCollector,
    model: string,
    provider: string
  ): void {
    const payload = collector.finalize();

    // Sanitize payload for PostgreSQL JSONB storage
    // Handles lone surrogates (from cut-off LLM streams) and null bytes
    const sanitizedPayload = sanitizeForJsonb(payload);

    // Fire-and-forget: don't await, just log errors
    const prisma = getPrismaClient();
    prisma.llmDiagnosticLog
      .create({
        data: {
          requestId: payload.meta.requestId,
          triggerMessageId: payload.meta.triggerMessageId,
          personalityId: payload.meta.personalityId,
          userId: payload.meta.userId,
          guildId: payload.meta.guildId,
          channelId: payload.meta.channelId,
          model,
          provider,
          durationMs: payload.timing.totalDurationMs,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- Prisma JSON field requires any cast
          data: sanitizedPayload as any,
        },
      })
      .then(() => {
        logger.debug(
          { requestId: payload.meta.requestId },
          '[GenerationStep] Diagnostic log stored successfully'
        );
      })
      .catch((err: unknown) => {
        logger.error(
          { err, requestId: payload.meta.requestId },
          '[GenerationStep] Failed to store diagnostic log'
        );
      });
  }

  /** Check for empty response and determine retry action */
  private shouldRetryEmptyResponse(
    response: RAGResponse,
    attempt: number,
    maxAttempts: number,
    jobId: string | undefined
  ): 'retry' | 'return' | 'continue' {
    if (response.content.length > 0) {
      return 'continue';
    }
    const canRetry = attempt < maxAttempts;
    const hasThinking = response.thinkingContent !== undefined && response.thinkingContent !== '';
    const logFn = canRetry ? logger.warn : logger.error;
    logFn(
      { jobId, attempt, modelUsed: response.modelUsed, hasThinking, totalAttempts: maxAttempts },
      canRetry
        ? '[GenerationStep] Empty response after post-processing. Retrying...'
        : '[GenerationStep] All retries produced empty responses.'
    );
    return canRetry ? 'retry' : 'return';
  }

  /** Log duplicate detection and determine retry action */
  private logDuplicateDetection(
    response: RAGResponse,
    opts: {
      attempt: number;
      maxAttempts: number;
      matchIndex?: number;
      jobId?: string;
      isGuestMode: boolean;
    }
  ): 'retry' | 'return' {
    const { attempt, maxAttempts, matchIndex, jobId, isGuestMode } = opts;
    const canRetry = attempt < maxAttempts;
    const logFn = canRetry ? logger.warn : logger.error;
    logFn(
      {
        jobId,
        modelUsed: response.modelUsed,
        isGuestMode,
        attempt,
        matchedTurnsBack: (matchIndex ?? 0) + 1,
      },
      canRetry
        ? '[GenerationStep] Cross-turn duplication detected. Retrying...'
        : '[GenerationStep] All retries produced duplicate responses.'
    );
    return canRetry ? 'retry' : 'return';
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
  private async generateWithDuplicateRetry(opts: {
    personality: Parameters<ConversationalRAGService['generateResponse']>[0];
    message: MessageContent;
    conversationContext: ConversationContext;
    recentAssistantMessages: string[];
    apiKey: string | undefined;
    isGuestMode: boolean;
    jobId: string | undefined;
    diagnosticCollector?: DiagnosticCollector;
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
    } = opts;

    let duplicateRetries = 0;
    let emptyRetries = 0;
    const maxAttempts = RETRY_CONFIG.MAX_ATTEMPTS; // 3 = 1 initial + 2 retries

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Build escalating retry config based on attempt number
      const retryConfig = buildRetryConfig(attempt);

      // Log escalation on retries
      if (attempt > 1) {
        logger.info(
          {
            jobId,
            attempt,
            temperatureOverride: retryConfig.temperatureOverride,
            frequencyPenaltyOverride: retryConfig.frequencyPenaltyOverride,
            historyReductionPercent: retryConfig.historyReductionPercent,
          },
          '[GenerationStep] Escalating retry parameters'
        );
      }

      // Clone context for each attempt to prevent mutation bleeding across retries.
      // The RAG service mutates rawConversationHistory (injectImageDescriptions),
      // so we need a fresh copy for each attempt.
      const attemptContext = this.cloneContextForRetry(conversationContext);

      // Generate response - each call gets new request_id via entropy injection
      // Pass retry config for escalating parameters on duplicate retries
      // IMPORTANT: skipMemoryStorage=true prevents storing memory on every retry attempt.
      // Memory is stored ONCE after the retry loop completes (see process method).
      // diagnosticCollector captures data from each attempt - overwrites with final attempt's data
      const response = await this.ragService.generateResponse(
        personality,
        message,
        attemptContext,
        {
          userApiKey: apiKey,
          isGuestMode,
          retryConfig: { attempt, ...retryConfig },
          skipMemoryStorage: true,
          diagnosticCollector,
        }
      );

      // Check for empty content after post-processing (e.g., only thinking blocks)
      const emptyAction = this.shouldRetryEmptyResponse(response, attempt, maxAttempts, jobId);
      if (emptyAction === 'retry') {
        emptyRetries++;
        continue;
      }
      if (emptyAction === 'return') {
        emptyRetries++;
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
          logger.info(
            { jobId, modelUsed: response.modelUsed, attempt, duplicateRetries, emptyRetries },
            '[GenerationStep] Retry succeeded - got valid unique response'
          );
        }
        return { response, duplicateRetries, emptyRetries };
      }

      // Duplicate detected - log and determine action
      duplicateRetries++;
      const dupAction = this.logDuplicateDetection(response, {
        attempt,
        maxAttempts,
        matchIndex,
        jobId,
        isGuestMode,
      });
      if (dupAction === 'return') {
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

      // DIAGNOSTIC: Log duplicate detection setup to diagnose production issues
      // (January 2026 incident: duplicate not detected despite history present)
      const historyLength = preparedContext.rawConversationHistory?.length ?? 0;
      if (historyLength > 0 && recentAssistantMessages.length === 0) {
        // This is the anomaly we're trying to diagnose
        const roleDistribution = (preparedContext.rawConversationHistory ?? []).reduce(
          (acc, msg) => {
            const role = String(msg.role);
            acc[role] = (acc[role] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );
        logger.warn(
          {
            jobId: job.id,
            historyLength,
            recentAssistantMessages: recentAssistantMessages.length,
            roleDistribution,
            sampleRoles: preparedContext.rawConversationHistory?.slice(-3).map(m => ({
              role: m.role,
              roleType: typeof m.role,
            })),
          },
          '[GenerationStep] ANOMALY: No assistant messages extracted from non-empty history. ' +
            'Duplicate detection may fail!'
        );
      } else {
        logger.debug(
          {
            jobId: job.id,
            historyLength,
            recentAssistantMessages: recentAssistantMessages.length,
            recentMessagesPreview: recentAssistantMessages.slice(0, 2).map(m => m.substring(0, 50)),
          },
          '[GenerationStep] Duplicate detection ready'
        );
      }

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
        this.storeDiagnosticLog(
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
      this.storeDiagnosticLog(
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
      this.storeDiagnosticLog(
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
