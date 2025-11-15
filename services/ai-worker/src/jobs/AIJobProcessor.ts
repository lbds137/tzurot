/**
 * AI Job Processor - Handles BullMQ jobs for AI generation
 *
 * This is the entry point for processing AI requests.
 * It receives jobs from the queue, uses the RAG service to generate responses,
 * and returns results back to the api-gateway.
 */

import { Job } from 'bullmq';
import {
  ConversationalRAGService,
  type RAGResponse,
} from '../services/ConversationalRAGService.js';
import { PgvectorMemoryAdapter } from '../services/PgvectorMemoryAdapter.js';
import {
  MessageContent,
  createLogger,
  type LoadedPersonality,
  type ReferencedMessage,
  formatRelativeTime,
  JobType,
  MessageRole,
  REDIS_KEY_PREFIXES,
  type AnyJobData,
  type AnyJobResult,
  type AudioTranscriptionJobData,
  type ImageDescriptionJobData,
  type LLMGenerationJobData,
  type AudioTranscriptionResult,
  type ImageDescriptionResult,
  type LLMGenerationResult,
} from '@tzurot/common-types';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { PrismaClient, Prisma } from '@prisma/client';
import { publishJobResult, storeJobResult } from '../redis.js';
import { cleanupOldJobResults } from './CleanupJobResults.js';
import { processAudioTranscriptionJob } from './AudioTranscriptionJob.js';
import { processImageDescriptionJob } from './ImageDescriptionJob.js';

const logger = createLogger('AIJobProcessor');
const prisma = new PrismaClient();

/**
 * Structure of data passed in the BullMQ job
 */
export interface AIJobData {
  // Request identification
  requestId: string;
  jobType: JobType;

  // Personality
  personality: LoadedPersonality;

  // User message
  message: string | object;

  // Context
  context: {
    userId: string;
    userName?: string;
    channelId?: string;
    serverId?: string;
    sessionId?: string;
    isProxyMessage?: boolean;
    // Active speaker - the persona making the current request
    activePersonaId?: string;
    activePersonaName?: string;
    conversationHistory?: {
      id?: string;
      role: MessageRole;
      content: string;
      tokenCount?: number; // Cached token count from database
      createdAt?: string;
      personaId?: string;
      personaName?: string;
    }[];
    // Multimodal support
    attachments?: Array<{
      url: string;
      contentType: string;
      name?: string;
      size?: number;
      isVoiceMessage?: boolean;
      duration?: number;
      waveform?: string;
    }>;
    // Discord environment context
    environment?: {
      type: 'dm' | 'guild';
      guild?: {
        id: string;
        name: string;
      };
      category?: {
        id: string;
        name: string;
      };
      channel: {
        id: string;
        name: string;
        type: string;
      };
      thread?: {
        id: string;
        name: string;
        parentChannel: {
          id: string;
          name: string;
          type: string;
        };
      };
    };
    // Referenced messages (from replies and message links)
    referencedMessages?: ReferencedMessage[];
  };

  // User's API key (for BYOK)
  userApiKey?: string;

  // Response destination (where to send the result)
  responseDestination: {
    type: 'discord' | 'webhook' | 'api';
    channelId?: string;
    webhookUrl?: string;
    callbackUrl?: string;
  };
}

/**
 * Structure of the job result
 */
export interface AIJobResult {
  requestId: string;
  success: boolean;
  content?: string;
  attachmentDescriptions?: string;
  referencedMessagesDescriptions?: string;
  error?: string;
  metadata?: {
    retrievedMemories?: number;
    tokensUsed?: number;
    processingTimeMs?: number;
    modelUsed?: string;
  };
}

export class AIJobProcessor {
  private ragService: ConversationalRAGService;

  constructor(memoryManager?: PgvectorMemoryAdapter) {
    this.ragService = new ConversationalRAGService(memoryManager);
  }

  /**
   * Process a single AI job - routes to appropriate handler based on job type
   */
  async processJob(job: Job<AnyJobData>): Promise<AnyJobResult> {
    const jobType = job.data.jobType;

    logger.info({ jobId: job.id, jobType }, '[AIJobProcessor] Processing job');

    // Route to appropriate handler based on job type
    if (jobType === 'audio-transcription') {
      return await this.processAudioTranscriptionJobWrapper(
        job as Job<AudioTranscriptionJobData>
      );
    } else if (jobType === 'image-description') {
      return await this.processImageDescriptionJobWrapper(job as Job<ImageDescriptionJobData>);
    } else if (jobType === 'llm-generation') {
      return await this.processLLMGenerationJob(job as Job<LLMGenerationJobData>);
    } else {
      logger.error({ jobType }, '[AIJobProcessor] Unknown job type');
      throw new Error(`Unknown job type: ${jobType}`);
    }
  }

  /**
   * Wrapper for audio transcription job - handles result storage
   */
  private async processAudioTranscriptionJobWrapper(
    job: Job<AudioTranscriptionJobData>
  ): Promise<AudioTranscriptionResult> {
    const result = await processAudioTranscriptionJob(job);

    // Store result in Redis for dependent jobs (with userId namespacing)
    const jobId = job.id ?? job.data.requestId;
    const userId = job.data.context.userId || 'unknown'; // Defensive: fallback if missing
    await storeJobResult(`${userId}:${jobId}`, result);

    // Publish to stream for async delivery
    await this.persistAndPublishResult(job, result);

    return result;
  }

  /**
   * Wrapper for image description job - handles result storage
   */
  private async processImageDescriptionJobWrapper(
    job: Job<ImageDescriptionJobData>
  ): Promise<ImageDescriptionResult> {
    const result = await processImageDescriptionJob(job);

    // Store result in Redis for dependent jobs (with userId namespacing)
    const jobId = job.id ?? job.data.requestId;
    const userId = job.data.context.userId || 'unknown'; // Defensive: fallback if missing
    await storeJobResult(`${userId}:${jobId}`, result);

    // Publish to stream for async delivery
    await this.persistAndPublishResult(job, result);

    return result;
  }

  /**
   * Process LLM generation job (may depend on preprocessing jobs)
   */
  private async processLLMGenerationJob(
    job: Job<LLMGenerationJobData>
  ): Promise<LLMGenerationResult> {
    const { dependencies } = job.data;

    // If there are dependencies, fetch their results and merge into context
    if (dependencies && dependencies.length > 0) {
      logger.info(
        {
          jobId: job.id,
          dependencyCount: dependencies.length,
        },
        '[AIJobProcessor] LLM job has dependencies - fetching preprocessing results'
      );

      // Fetch dependency results from Redis
      const { getJobResult } = await import('../redis.js');

      // Collect all audio transcriptions
      const transcriptions: string[] = [];
      // Collect all image descriptions
      const imageDescriptions: Array<{ url: string; description: string }> = [];

      for (const dep of dependencies) {
        try {
          // Extract key from resultKey (strip REDIS_KEY_PREFIXES.JOB_RESULT prefix)
          const key = dep.resultKey?.substring(REDIS_KEY_PREFIXES.JOB_RESULT.length) ?? dep.jobId;

          if (dep.type === 'audio-transcription') {
            const result = await getJobResult<AudioTranscriptionResult>(key);
            if (result?.success && result.transcript) {
              transcriptions.push(result.transcript);
              logger.debug({ jobId: dep.jobId, key }, '[AIJobProcessor] Retrieved audio transcription');
            } else {
              logger.warn({ jobId: dep.jobId, key }, '[AIJobProcessor] Audio transcription job failed or has no result');
            }
          } else if (dep.type === 'image-description') {
            const result = await getJobResult<ImageDescriptionResult>(key);
            if (result?.success && result.descriptions) {
              imageDescriptions.push(...result.descriptions);
              logger.debug({ jobId: dep.jobId, key, count: result.descriptions.length }, '[AIJobProcessor] Retrieved image descriptions');
            } else {
              logger.warn({ jobId: dep.jobId, key }, '[AIJobProcessor] Image description job failed or has no result');
            }
          }
        } catch (error) {
          logger.error(
            { err: error, jobId: dep.jobId, type: dep.type },
            '[AIJobProcessor] Failed to fetch dependency result - continuing without it'
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
        '[AIJobProcessor] Merged preprocessing results into job context'
      );
    }

    // Now perform LLM generation
    const startTime = Date.now();
    const { requestId, personality, message, context, userApiKey } = job.data;

    logger.info(
      `[AIJobProcessor] Processing LLM generation job ${job.id} (${requestId}) for ${personality.name}`
    );

    // Debug: Check if referencedMessages exists in job data
    logger.info(
      `[AIJobProcessor] Job data context inspection: ` +
        `hasReferencedMessages=${!!context.referencedMessages}, ` +
        `count=${context.referencedMessages?.length || 0}, ` +
        `type=${typeof context.referencedMessages}, ` +
        `contextKeys=[${Object.keys(context).join(', ')}]`
    );

    try {
      // Calculate oldest timestamp from conversation history (for LTM deduplication)
      let oldestHistoryTimestamp: number | undefined;
      if (context.conversationHistory && context.conversationHistory.length > 0) {
        const timestamps = context.conversationHistory
          .map(msg => (msg.createdAt ? new Date(msg.createdAt).getTime() : null))
          .filter((t): t is number => t !== null);

        if (timestamps.length > 0) {
          oldestHistoryTimestamp = Math.min(...timestamps);
          logger.debug(
            `[AIJobProcessor] Oldest conversation message: ${new Date(oldestHistoryTimestamp).toISOString()}`
          );
        }
      }

      // Extract unique participants BEFORE converting to BaseMessage
      const participants = this.extractParticipants(
        context.conversationHistory ?? [],
        context.activePersonaId,
        context.activePersonaName
      );

      // Convert conversation history to BaseMessage format
      const conversationHistory = this.convertConversationHistory(
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

      logger.info(`[AIJobProcessor] Job ${job.id} completed in ${processingTimeMs}ms`);

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

      logger.debug({ jobResult }, '[AIJobProcessor] Returning job result');

      // Persist to DB and publish to Redis Stream
      await this.persistAndPublishResult(job, jobResult);

      return jobResult;
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;

      logger.error({ err: error }, `[AIJobProcessor] Job ${job.id} failed`);

      const jobResult: LLMGenerationResult = {
        requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          processingTimeMs,
        },
      };

      // Persist to DB and publish to Redis Stream (even for failures)
      await this.persistAndPublishResult(job, jobResult);

      return jobResult;
    }
  }

  /**
   * Extract unique participants from conversation history
   * Returns list of all personas involved in the conversation
   */
  private extractParticipants(
    history: {
      role: MessageRole;
      content: string;
      personaId?: string;
      personaName?: string;
    }[],
    activePersonaId?: string,
    activePersonaName?: string
  ): Array<{ personaId: string; personaName: string; isActive: boolean }> {
    const uniquePersonas = new Map<string, string>(); // personaId -> personaName

    const userMessagesWithPersona = history.filter(
      m => m.role === MessageRole.User && m.personaId && m.personaName
    ).length;
    logger.debug(
      `[AIJobProcessor] Extracting participants: activePersonaId=${activePersonaId}, activePersonaName=${activePersonaName}, historyLength=${history.length}, userMessagesWithPersona=${userMessagesWithPersona}`
    );

    // Extract from history
    for (const msg of history) {
      if (msg.role === MessageRole.User && msg.personaId && msg.personaName) {
        logger.debug(
          `[AIJobProcessor] Found participant in history: ${msg.personaName} (${msg.personaId})`
        );
        uniquePersonas.set(msg.personaId, msg.personaName);
      }
    }

    // Ensure active persona is included (even if not in history yet)
    if (activePersonaId && activePersonaName) {
      logger.debug(
        `[AIJobProcessor] Including active persona: ${activePersonaName} (${activePersonaId})`
      );
      uniquePersonas.set(activePersonaId, activePersonaName);
    } else {
      logger.debug(
        `[AIJobProcessor] Active persona not included - hasActivePersonaId: ${!!activePersonaId}, hasActivePersonaName: ${!!activePersonaName}, activePersonaId: ${activePersonaId}, activePersonaName: ${activePersonaName}`
      );
    }

    logger.debug(`[AIJobProcessor] Found ${uniquePersonas.size} unique participant(s)`);

    // Convert to array with isActive flag
    return Array.from(uniquePersonas.entries()).map(([personaId, personaName]) => ({
      personaId,
      personaName,
      isActive: personaId === activePersonaId,
    }));
  }

  /**
   * Convert simple conversation history to LangChain BaseMessage format
   * Includes persona names to help the AI understand who is speaking
   */
  private convertConversationHistory(
    history: {
      role: MessageRole;
      content: string;
      createdAt?: string;
      personaId?: string;
      personaName?: string;
    }[],
    personalityName: string
  ): BaseMessage[] {
    return history.map(msg => {
      // Format message with speaker name and timestamp
      let content = msg.content;

      // For user messages, include persona name and timestamp
      if (msg.role === MessageRole.User) {
        const parts: string[] = [];

        if (msg.personaName) {
          parts.push(`${msg.personaName}:`);
        }

        if (msg.createdAt) {
          parts.push(`[${formatRelativeTime(msg.createdAt)}]`);
        }

        if (parts.length > 0) {
          content = `${parts.join(' ')} ${msg.content}`;
        }
      }

      // For assistant messages, include personality name and timestamp
      if (msg.role === MessageRole.Assistant) {
        const parts: string[] = [];

        // Use the personality name (e.g., "Lilith")
        parts.push(`${personalityName}:`);

        if (msg.createdAt) {
          parts.push(`[${formatRelativeTime(msg.createdAt)}]`);
        }

        content = `${parts.join(' ')} ${msg.content}`;
      }

      if (msg.role === MessageRole.User) {
        return new HumanMessage(content);
      } else if (msg.role === MessageRole.Assistant) {
        return new AIMessage(content);
      } else {
        // System messages are handled separately in the prompt
        return new HumanMessage(content);
      }
    });
  }

  /**
   * Health check - verify RAG service is working
   */
  healthCheck(): boolean {
    // TODO: Add actual health check
    return true;
  }

  /**
   * Persist job result to database and publish to Redis Stream
   * This enables async delivery pattern - results are stored until confirmed delivered
   */
  private async persistAndPublishResult(
    job: Job<AnyJobData>,
    result: AnyJobResult
  ): Promise<void> {
    const jobId = job.id ?? job.data.requestId;

    try {
      // 1. Store result in database with PENDING_DELIVERY status
      await prisma.jobResult.create({
        data: {
          jobId,
          requestId: result.requestId,
          result: result as unknown as Prisma.InputJsonValue,
          status: 'PENDING_DELIVERY',
          completedAt: new Date(),
        },
      });

      logger.debug({ jobId }, '[AIJobProcessor] Stored result in database');

      // 2. Publish to Redis Stream for bot-client to consume
      await publishJobResult(jobId, result.requestId, result);

      logger.info({ jobId }, '[AIJobProcessor] Result persisted and published to Redis Stream');

      // 3. Opportunistically clean up old delivered results (runs ~5% of the time)
      // Non-blocking - don't await, let it run in background
      void cleanupOldJobResults(prisma).catch(err => {
        logger.error({ err }, '[AIJobProcessor] Background cleanup failed (non-critical)');
      });
    } catch (error) {
      logger.error(
        { err: error, jobId },
        '[AIJobProcessor] Failed to persist/publish result - bot-client may not receive it!'
      );
      // Don't throw - we still want BullMQ to mark the job as complete
      // The result is in the job's return value as fallback
    }
  }
}
