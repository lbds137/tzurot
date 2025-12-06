/**
 * Generation Step
 *
 * Generates AI response using the RAG service with all prepared context.
 */

import { createLogger, MessageContent, type LLMGenerationResult } from '@tzurot/common-types';
import type {
  ConversationalRAGService,
  RAGResponse,
} from '../../../../services/ConversationalRAGService.js';
import type { IPipelineStep, GenerationContext } from '../types.js';
import { parseApiError, getErrorLogContext } from '../../../../utils/apiErrorParser.js';

const logger = createLogger('GenerationStep');

export class GenerationStep implements IPipelineStep {
  readonly name = 'Generation';

  constructor(private readonly ragService: ConversationalRAGService) {}

  async process(context: GenerationContext): Promise<GenerationContext> {
    const { job, startTime, preprocessing, config, auth, preparedContext } = context;
    const { requestId, personality, message, context: jobContext } = job.data;

    // Validate prerequisites
    if (!config) {
      throw new Error('[GenerationStep] ConfigStep must run before GenerationStep');
    }
    if (!auth) {
      throw new Error('[GenerationStep] AuthStep must run before GenerationStep');
    }
    if (!preparedContext) {
      throw new Error('[GenerationStep] ContextStep must run before GenerationStep');
    }

    const { effectivePersonality, configSource } = config;
    const { apiKey, provider, isGuestMode } = auth;

    // Debug log for referenced messages
    logger.info(
      {
        jobId: job.id,
        hasReferencedMessages:
          jobContext.referencedMessages !== undefined && jobContext.referencedMessages !== null,
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
          environment: jobContext.environment,
          referencedMessages: jobContext.referencedMessages,
          referencedChannels: jobContext.referencedChannels,
        },
        apiKey,
        isGuestMode
      );

      const processingTimeMs = Date.now() - startTime;

      logger.info({ jobId: job.id, processingTimeMs }, '[GenerationStep] Generation completed');

      const result: LLMGenerationResult = {
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
      };

      return {
        ...context,
        result,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;

      // Parse error for classification and user messaging
      const errorInfo = parseApiError(error);
      const errorLogContext = getErrorLogContext(error);

      // Enhanced error logging with structured context
      logger.error(
        {
          err: error,
          jobId: job.id,
          ...errorLogContext,
        },
        `[GenerationStep] Generation failed: ${errorInfo.category}`
      );

      const result: LLMGenerationResult = {
        requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        personalityErrorMessage: personality.errorMessage,
        errorInfo,
        metadata: {
          processingTimeMs,
        },
      };

      return {
        ...context,
        result,
      };
    }
  }
}
