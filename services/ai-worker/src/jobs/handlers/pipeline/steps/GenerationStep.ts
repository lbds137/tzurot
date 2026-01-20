/**
 * Generation Step
 *
 * Generates AI response using the RAG service with all prepared context.
 */

import { createLogger, MessageContent, RETRY_CONFIG } from '@tzurot/common-types';
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
  getRecentAssistantMessages,
  buildRetryConfig,
  type EmbeddingServiceInterface,
} from '../../../../utils/duplicateDetection.js';
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
   * Generate response with cross-turn duplication retry.
   * Treats duplicate responses as retryable failures, matching LLM retry pattern.
   * Uses RETRY_CONFIG.MAX_ATTEMPTS (3 attempts = 1 initial + 2 retries).
   *
   * Checks against multiple recent assistant messages (up to 5) to catch duplicates
   * of older responses, not just the immediate previous one.
   */
  private async generateWithDuplicateRetry(opts: {
    personality: Parameters<ConversationalRAGService['generateResponse']>[0];
    message: MessageContent;
    conversationContext: ConversationContext;
    recentAssistantMessages: string[];
    apiKey: string | undefined;
    isGuestMode: boolean;
    jobId: string | undefined;
  }): Promise<{ response: RAGResponse; duplicateRetries: number }> {
    const {
      personality,
      message,
      conversationContext,
      recentAssistantMessages,
      apiKey,
      isGuestMode,
      jobId,
    } = opts;

    let duplicateRetries = 0;
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
          '[GenerationStep] Escalating retry parameters for duplicate avoidance'
        );
      }

      // Generate response - each call gets new request_id via entropy injection
      // Pass retry config for escalating parameters on duplicate retries
      // IMPORTANT: skipMemoryStorage=true prevents storing memory on every retry attempt.
      // Memory is stored ONCE after the retry loop completes (see process method).
      const response = await this.ragService.generateResponse(
        personality,
        message,
        conversationContext,
        {
          userApiKey: apiKey,
          isGuestMode,
          retryConfig: { attempt, ...retryConfig },
          skipMemoryStorage: true,
        }
      );

      // If no previous messages to compare, or response is unique, we're done
      // Use async version with optional embedding service for semantic layer (Layer 4)
      const { isDuplicate, matchIndex } = await isRecentDuplicateAsync(
        response.content,
        recentAssistantMessages,
        this.embeddingService
      );

      if (!isDuplicate) {
        if (duplicateRetries > 0) {
          logger.info(
            { jobId, modelUsed: response.modelUsed, attempt, duplicateRetries },
            '[GenerationStep] Retry succeeded - got unique response'
          );
        }
        return { response, duplicateRetries };
      }

      // Duplicate detected - retry if attempts remain
      duplicateRetries++;

      if (attempt < maxAttempts) {
        logger.warn(
          {
            jobId,
            modelUsed: response.modelUsed,
            isGuestMode,
            responseLength: response.content.length,
            attempt,
            remainingAttempts: maxAttempts - attempt,
            matchedTurnsBack: matchIndex + 1,
          },
          '[GenerationStep] Cross-turn duplication detected. Retrying with new request_id...'
        );
      } else {
        // Last attempt still produced duplicate - log error but return it anyway
        logger.error(
          {
            jobId,
            modelUsed: response.modelUsed,
            isGuestMode,
            totalAttempts: maxAttempts,
            matchedTurnsBack: matchIndex + 1,
          },
          '[GenerationStep] All retries produced duplicate responses. Using last response.'
        );
        return { response, duplicateRetries };
      }
    }

    // This is unreachable but TypeScript needs it for exhaustiveness
    throw new Error('[GenerationStep] Unexpected: no response generated');
  }

  // eslint-disable-next-line max-lines-per-function -- Pipeline step with diagnostic logging and error handling
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

      // Generate response with automatic retry on cross-turn duplication
      const { response, duplicateRetries } = await this.generateWithDuplicateRetry({
        personality: effectivePersonality,
        message: message as MessageContent,
        conversationContext,
        recentAssistantMessages,
        apiKey,
        isGuestMode,
        jobId: job.id,
      });

      // Store memory ONCE after retry loop completes with a valid response.
      // This prevents duplicate memories when retries occur (the fix for the
      // "swiss cheese" duplicate memory bug - see memory:cleanup command).
      if (response.deferredMemoryData !== undefined && response.incognitoModeActive !== true) {
        await this.ragService.storeDeferredMemory(
          effectivePersonality,
          conversationContext,
          response.deferredMemoryData
        );
      }

      const processingTimeMs = Date.now() - startTime;
      logger.info(
        { jobId: job.id, processingTimeMs, duplicateRetries },
        '[GenerationStep] Generation completed'
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
          },
        },
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const underlyingError = error instanceof RetryError ? error.lastError : error;
      const errorInfo = parseApiError(underlyingError);

      logger.error(
        { err: error, jobId: job.id, ...getErrorLogContext(underlyingError) },
        `[GenerationStep] Generation failed: ${errorInfo.category}`
      );

      return {
        ...context,
        result: {
          requestId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          personalityErrorMessage: personality.errorMessage,
          errorInfo,
          metadata: { processingTimeMs },
        },
      };
    }
  }
}
