/**
 * AI Job Processor - Handles BullMQ jobs for AI generation
 *
 * This is the entry point for processing AI requests.
 * It receives jobs from the queue, uses the RAG service to generate responses,
 * and returns results back to the api-gateway.
 */

import { Job } from 'bullmq';
import { ConversationalRAGService } from '../services/ConversationalRAGService.js';
import { PgvectorMemoryAdapter } from '../services/PgvectorMemoryAdapter.js';
import { ApiKeyResolver } from '../services/ApiKeyResolver.js';
import {
  createLogger,
  type LoadedPersonality,
  type ReferencedMessage,
  JobType,
  MessageRole,
  type AnyJobData,
  type AnyJobResult,
  type AudioTranscriptionJobData,
  type ImageDescriptionJobData,
  type LLMGenerationJobData,
  type AudioTranscriptionResult,
  type ImageDescriptionResult,
  type LLMGenerationResult,
} from '@tzurot/common-types';
import type { PrismaClient, Prisma } from '@tzurot/common-types';
import { redisService } from '../redis.js';
import { cleanupOldJobResults } from './CleanupJobResults.js';
import { processAudioTranscriptionJob } from './AudioTranscriptionJob.js';
import { processImageDescriptionJob } from './ImageDescriptionJob.js';
import { LLMGenerationHandler } from './handlers/LLMGenerationHandler.js';

const logger = createLogger('AIJobProcessor');

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
    attachments?: {
      url: string;
      contentType: string;
      name?: string;
      size?: number;
      isVoiceMessage?: boolean;
      duration?: number;
      waveform?: string;
    }[];
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
  private llmGenerationHandler: LLMGenerationHandler;
  private apiKeyResolver: ApiKeyResolver;

  constructor(
    private prisma: PrismaClient,
    memoryManager?: PgvectorMemoryAdapter,
    ragService?: ConversationalRAGService,
    apiKeyResolver?: ApiKeyResolver
  ) {
    // Use provided RAGService (for testing) or create new one (for production)
    this.ragService = ragService ?? new ConversationalRAGService(memoryManager);

    // Use provided ApiKeyResolver (for testing) or create new one (for production)
    // ApiKeyResolver handles BYOK - looking up and decrypting user API keys
    this.apiKeyResolver = apiKeyResolver ?? new ApiKeyResolver(prisma);

    this.llmGenerationHandler = new LLMGenerationHandler(this.ragService, this.apiKeyResolver);
  }

  /**
   * Process a single AI job - routes to appropriate handler based on job type
   */
  async processJob(job: Job<AnyJobData>): Promise<AnyJobResult> {
    const jobType = job.data.jobType;

    logger.info({ jobId: job.id, jobType }, '[AIJobProcessor] Processing job');

    // Route to appropriate handler based on job type
    if ((jobType as string) === 'audio-transcription') {
      return this.processAudioTranscriptionJobWrapper(job as Job<AudioTranscriptionJobData>);
    } else if ((jobType as string) === 'image-description') {
      return this.processImageDescriptionJobWrapper(job as Job<ImageDescriptionJobData>);
    } else if ((jobType as string) === 'llm-generation') {
      return this.processLLMGenerationJob(job as Job<LLMGenerationJobData>);
    } else {
      logger.error({ jobType }, '[AIJobProcessor] Unknown job type');
      throw new Error(`Unknown job type: ${String(jobType)}`);
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
    await redisService.storeJobResult(`${userId}:${jobId}`, result);

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
    await redisService.storeJobResult(`${userId}:${jobId}`, result);

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
    // Delegate to LLM generation handler
    const result = await this.llmGenerationHandler.processJob(job);

    // Persist to DB and publish to Redis Stream
    await this.persistAndPublishResult(job, result);

    return result;
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
  private async persistAndPublishResult(job: Job<AnyJobData>, result: AnyJobResult): Promise<void> {
    const jobId = job.id ?? job.data.requestId;

    try {
      // 1. Store result in database with PENDING_DELIVERY status
      await this.prisma.jobResult.create({
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
      await redisService.publishJobResult(jobId, result.requestId, result);

      logger.info({ jobId }, '[AIJobProcessor] Result persisted and published to Redis Stream');

      // 3. Opportunistically clean up old delivered results (runs ~5% of the time)
      // Non-blocking - don't await, let it run in background
      void cleanupOldJobResults(this.prisma).catch(err => {
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
