/**
 * Generation Step
 *
 * Generates AI response using the RAG service with all prepared context.
 */

import { createLogger, MessageContent } from '@tzurot/common-types';
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
  isCrossTurnDuplicate,
  getLastAssistantMessage,
} from '../../../../utils/responseCleanup.js';
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

  constructor(private readonly ragService: ConversationalRAGService) {}

  /**
   * Check for cross-turn duplication and retry once if detected.
   * Returns the final response and whether a retry occurred.
   */
  private async handleCrossTurnDuplication(opts: {
    response: RAGResponse;
    preparedContext: PreparedContext;
    personality: Parameters<ConversationalRAGService['generateResponse']>[0];
    message: MessageContent;
    conversationContext: ConversationContext;
    apiKey: string | undefined;
    isGuestMode: boolean;
    jobId: string | undefined;
  }): Promise<{ finalResponse: RAGResponse; didRetry: boolean }> {
    const {
      response,
      preparedContext,
      personality,
      message,
      conversationContext,
      apiKey,
      isGuestMode,
      jobId,
    } = opts;
    const lastAssistantMessage = getLastAssistantMessage(preparedContext.rawConversationHistory);

    // No previous assistant message or response is unique - no retry needed
    if (
      lastAssistantMessage === undefined ||
      !isCrossTurnDuplicate(response.content, lastAssistantMessage)
    ) {
      return { finalResponse: response, didRetry: false };
    }

    logger.warn(
      {
        jobId,
        modelUsed: response.modelUsed,
        isGuestMode,
        responseLength: response.content.length,
      },
      '[GenerationStep] Cross-turn duplication detected. Retrying with new request_id...'
    );

    // Retry once - entropy injection generates new request_id to bypass API caching
    const retryResponse = await this.ragService.generateResponse(
      personality,
      message,
      conversationContext,
      apiKey,
      isGuestMode
    );

    const retryStillDuplicate = isCrossTurnDuplicate(retryResponse.content, lastAssistantMessage);

    if (retryStillDuplicate) {
      logger.error(
        { jobId, modelUsed: retryResponse.modelUsed, isGuestMode },
        '[GenerationStep] Retry also produced duplicate response. Using retry response anyway.'
      );
    } else {
      logger.info(
        { jobId, modelUsed: retryResponse.modelUsed },
        '[GenerationStep] Retry succeeded - got unique response'
      );
    }

    return { finalResponse: retryResponse, didRetry: true };
  }

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

      // Generate response using RAG
      const response = await this.ragService.generateResponse(
        effectivePersonality,
        message as MessageContent,
        conversationContext,
        apiKey,
        isGuestMode
      );

      // Check for cross-turn duplication and retry if detected
      const { finalResponse, didRetry } = await this.handleCrossTurnDuplication({
        response,
        preparedContext,
        personality: effectivePersonality,
        message: message as MessageContent,
        conversationContext,
        apiKey,
        isGuestMode,
        jobId: job.id,
      });

      const processingTimeMs = Date.now() - startTime;
      logger.info(
        { jobId: job.id, processingTimeMs, didRetryForDuplication: didRetry },
        '[GenerationStep] Generation completed'
      );

      return {
        ...context,
        result: {
          requestId,
          success: true,
          content: finalResponse.content,
          attachmentDescriptions: finalResponse.attachmentDescriptions,
          referencedMessagesDescriptions: finalResponse.referencedMessagesDescriptions,
          metadata: {
            retrievedMemories: finalResponse.retrievedMemories,
            tokensIn: finalResponse.tokensIn,
            tokensOut: finalResponse.tokensOut,
            processingTimeMs,
            modelUsed: finalResponse.modelUsed,
            providerUsed: provider,
            configSource,
            isGuestMode,
            crossTurnDuplicateDetected: didRetry,
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
