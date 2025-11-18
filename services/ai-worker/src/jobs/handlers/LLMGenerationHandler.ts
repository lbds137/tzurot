/**
 * LLM Generation Handler
 *
 * Handles LLM generation jobs including preprocessing dependency merging
 */

import { Job } from 'bullmq';
import {
  ConversationalRAGService,
  type RAGResponse,
} from '../../services/ConversationalRAGService.js';
import {
  MessageContent,
  createLogger,
  REDIS_KEY_PREFIXES,
  type LLMGenerationJobData,
  type LLMGenerationResult,
  type AudioTranscriptionResult,
  type ImageDescriptionResult,
} from '@tzurot/common-types';
import { extractParticipants, convertConversationHistory } from '../utils/conversationUtils.js';

const logger = createLogger('LLMGenerationHandler');

/**
 * Handler for LLM generation jobs
 * Processes dependencies (audio transcriptions, image descriptions) and generates AI responses
 */
export class LLMGenerationHandler {
  constructor(private readonly ragService: ConversationalRAGService) {}

  /**
   * Process LLM generation job (may depend on preprocessing jobs)
   */
  async processJob(job: Job<LLMGenerationJobData>): Promise<LLMGenerationResult> {
    const { dependencies } = job.data;

    // If there are dependencies, fetch their results and merge into context
    if (dependencies && dependencies.length > 0) {
      await this.processDependencies(job);
    }

    // Now perform LLM generation
    return this.generateResponse(job);
  }

  /**
   * Fetch and merge preprocessing results (audio transcriptions, image descriptions)
   */
  private async processDependencies(job: Job<LLMGenerationJobData>): Promise<void> {
    const { dependencies } = job.data;

    if (!dependencies || dependencies.length === 0) {
      return;
    }

    logger.info(
      {
        jobId: job.id,
        dependencyCount: dependencies.length,
      },
      '[LLMGenerationHandler] LLM job has dependencies - fetching preprocessing results'
    );

    // Fetch dependency results from Redis
    const { getJobResult } = await import('../../redis.js');

    // Collect all audio transcriptions
    const transcriptions: string[] = [];
    // Collect all image descriptions
    const imageDescriptions: { url: string; description: string }[] = [];

    for (const dep of dependencies) {
      try {
        // Extract key from resultKey (strip REDIS_KEY_PREFIXES.JOB_RESULT prefix)
        const key = dep.resultKey?.substring(REDIS_KEY_PREFIXES.JOB_RESULT.length) ?? dep.jobId;

        if ((dep.type as string) === 'audio-transcription') {
          const result = await getJobResult<AudioTranscriptionResult>(key);
          if (
            result?.success === true &&
            result.content !== undefined &&
            result.content.length > 0
          ) {
            transcriptions.push(result.content);
            logger.debug({ jobId: dep.jobId, key }, '[LLMGenerationHandler] Retrieved audio transcription');
          } else {
            logger.warn({ jobId: dep.jobId, key }, '[LLMGenerationHandler] Audio transcription job failed or has no result');
          }
        } else if ((dep.type as string) === 'image-description') {
          const result = await getJobResult<ImageDescriptionResult>(key);
          if (
            result?.success === true &&
            result.descriptions !== undefined &&
            result.descriptions.length > 0
          ) {
            imageDescriptions.push(...result.descriptions);
            logger.debug({ jobId: dep.jobId, key, count: result.descriptions.length }, '[LLMGenerationHandler] Retrieved image descriptions');
          } else {
            logger.warn({ jobId: dep.jobId, key }, '[LLMGenerationHandler] Image description job failed or has no result');
          }
        }
      } catch (error) {
        logger.error(
          { err: error, jobId: dep.jobId, type: dep.type },
          '[LLMGenerationHandler] Failed to fetch dependency result - continuing without it'
        );
      }
    }

    // Merge preprocessing results into message context
    // Build attachment descriptions string
    let attachmentDescriptions = '';

    if (imageDescriptions.length > 0) {
      attachmentDescriptions += '## Image Descriptions\n\n';
      imageDescriptions.forEach((img, i) => {
        attachmentDescriptions += `**Image ${i + 1}**: ${img.description}\n\n`;
      });
    }

    if (transcriptions.length > 0) {
      attachmentDescriptions += '## Audio Transcriptions\n\n';
      transcriptions.forEach((transcript, i) => {
        attachmentDescriptions += `**Audio ${i + 1}**: ${transcript}\n\n`;
      });
    }

    // Store the processed attachment descriptions for the LLM
    // Note: The actual integration into the message will be handled by RAG service
    if (attachmentDescriptions) {
      // Store in a temporary property that RAG service can access
      job.data.__preprocessedAttachments = attachmentDescriptions;
    }

    logger.info(
      {
        jobId: job.id,
        transcriptionCount: transcriptions.length,
        imageCount: imageDescriptions.length,
      },
      '[LLMGenerationHandler] Merged preprocessing results into job context'
    );
  }

  /**
   * Generate AI response using RAG service
   */
  private async generateResponse(job: Job<LLMGenerationJobData>): Promise<LLMGenerationResult> {
    const startTime = Date.now();
    const { requestId, personality, message, context, userApiKey } = job.data;

    logger.info(
      `[LLMGenerationHandler] Processing LLM generation job ${job.id} (${requestId}) for ${personality.name}`
    );

    // Debug: Check if referencedMessages exists in job data
    logger.info(
      `[LLMGenerationHandler] Job data context inspection: ` +
        `hasReferencedMessages=${context.referencedMessages !== undefined && context.referencedMessages !== null}, ` +
        `count=${context.referencedMessages?.length ?? 0}, ` +
        `type=${typeof context.referencedMessages}, ` +
        `contextKeys=[${Object.keys(context).join(', ')}]`
    );

    try {
      // Calculate oldest timestamp from conversation history (for LTM deduplication)
      let oldestHistoryTimestamp: number | undefined;
      if (context.conversationHistory && context.conversationHistory.length > 0) {
        const timestamps = context.conversationHistory
          .map(msg =>
            msg.createdAt !== undefined && msg.createdAt.length > 0
              ? new Date(msg.createdAt).getTime()
              : null
          )
          .filter((t): t is number => t !== null);

        if (timestamps.length > 0) {
          oldestHistoryTimestamp = Math.min(...timestamps);
          logger.debug(
            `[LLMGenerationHandler] Oldest conversation message: ${new Date(oldestHistoryTimestamp).toISOString()}`
          );
        }
      }

      // Extract unique participants BEFORE converting to BaseMessage
      const participants = extractParticipants(
        context.conversationHistory ?? [],
        context.activePersonaId,
        context.activePersonaName
      );

      // Convert conversation history to BaseMessage format
      const conversationHistory = convertConversationHistory(
        context.conversationHistory ?? [],
        personality.name
      );

      // Generate response using RAG
      const response: RAGResponse = await this.ragService.generateResponse(
        personality,
        message as MessageContent,
        {
          userId: context.userId,
          userName: context.userName,
          channelId: context.channelId,
          serverId: context.serverId,
          sessionId: context.sessionId,
          isProxyMessage: context.isProxyMessage,
          activePersonaId: context.activePersonaId,
          activePersonaName: context.activePersonaName,
          conversationHistory,
          rawConversationHistory: context.conversationHistory,
          oldestHistoryTimestamp,
          participants,
          attachments: context.attachments,
          environment: context.environment,
          referencedMessages: context.referencedMessages,
        },
        userApiKey
      );

      const processingTimeMs = Date.now() - startTime;

      logger.info(`[LLMGenerationHandler] Job ${job.id} completed in ${processingTimeMs}ms`);

      const jobResult: LLMGenerationResult = {
        requestId,
        success: true,
        content: response.content,
        attachmentDescriptions: response.attachmentDescriptions,
        referencedMessagesDescriptions: response.referencedMessagesDescriptions,
        metadata: {
          retrievedMemories: response.retrievedMemories,
          tokensUsed: response.tokensUsed,
          processingTimeMs,
          modelUsed: response.modelUsed,
        },
      };

      logger.debug({ jobResult }, '[LLMGenerationHandler] Returning job result');

      return jobResult;
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;

      logger.error({ err: error }, `[LLMGenerationHandler] Job ${job.id} failed`);

      const jobResult: LLMGenerationResult = {
        requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          processingTimeMs,
        },
      };

      return jobResult;
    }
  }
}
