/**
 * Generation Step
 *
 * Generates AI response using the RAG service with all prepared context.
 */

import { createLogger, MessageContent } from '@tzurot/common-types';
import type {
  ConversationalRAGService,
  RAGResponse,
} from '../../../../services/ConversationalRAGService.js';
import type { IPipelineStep, GenerationContext } from '../types.js';
import { parseApiError, getErrorLogContext } from '../../../../utils/apiErrorParser.js';
import { RetryError } from '../../../../utils/retry.js';

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

  constructor(private readonly ragService: ConversationalRAGService) {}

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
      // Generate response using RAG
      const response: RAGResponse = await this.ragService.generateResponse(
        effectivePersonality,
        message as MessageContent,
        {
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
          // Use preprocessed attachments from dependency jobs if available
          preprocessedAttachments:
            preprocessing && preprocessing.processedAttachments.length > 0
              ? preprocessing.processedAttachments
              : undefined,
          // Use preprocessed reference attachments from dependency jobs if available
          preprocessedReferenceAttachments:
            preprocessing && Object.keys(preprocessing.referenceAttachments).length > 0
              ? preprocessing.referenceAttachments
              : undefined,
          // Extended context attachments (raw and preprocessed)
          extendedContextAttachments: jobContext.extendedContextAttachments,
          preprocessedExtendedContextAttachments: preprocessing?.extendedContextAttachments,
          environment: jobContext.environment,
          referencedMessages: jobContext.referencedMessages,
          referencedChannels: jobContext.referencedChannels,
        },
        apiKey,
        isGuestMode
      );

      const processingTimeMs = Date.now() - startTime;
      logger.info({ jobId: job.id, processingTimeMs }, '[GenerationStep] Generation completed');

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
