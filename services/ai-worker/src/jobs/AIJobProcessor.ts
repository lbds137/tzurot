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
import type { EmbeddingServiceInterface } from '../utils/duplicateDetection.js';
import { ApiKeyResolver } from '../services/ApiKeyResolver.js';
import { LlmConfigResolver, type ConfigCascadeResolver } from '@tzurot/common-types';
import { PersonaResolver } from '../services/resolvers/index.js';
import {
  createLogger,
  type AnyJobData,
  type AnyJobResult,
  type AudioTranscriptionJobData,
  type ImageDescriptionJobData,
  type LLMGenerationJobData,
  type ShapesImportJobData,
  type AudioTranscriptionResult,
  type ImageDescriptionResult,
  type LLMGenerationResult,
  type ShapesImportJobResult,
  generateUsageLogUuid,
  JobType,
} from '@tzurot/common-types';
import type { PrismaClient, Prisma } from '@tzurot/common-types';
import { redisService } from '../redis.js';
import { cleanupOldJobResults } from './CleanupJobResults.js';
import { processAudioTranscriptionJob } from './AudioTranscriptionJob.js';
import { processImageDescriptionJob } from './ImageDescriptionJob.js';
import { LLMGenerationHandler } from './handlers/LLMGenerationHandler.js';
import { processShapesImportJob } from './ShapesImportJob.js';

const logger = createLogger('AIJobProcessor');

/** Options for constructing AIJobProcessor */
interface AIJobProcessorOptions {
  /** Required: Prisma client for database operations */
  prisma: PrismaClient;
  /** Optional: Memory manager for pgvector operations (for DI in tests) */
  memoryManager?: PgvectorMemoryAdapter;
  /** Optional: RAG service instance (for DI in tests) */
  ragService?: ConversationalRAGService;
  /** Optional: API key resolver (for DI in tests) */
  apiKeyResolver?: ApiKeyResolver;
  /** Optional: LLM config resolver (for DI in tests) */
  configResolver?: LlmConfigResolver;
  /** Optional: Persona resolver for persona-based memory retrieval (for DI in tests) */
  personaResolver?: PersonaResolver;
  /** Optional: Local embedding service for semantic duplicate detection */
  embeddingService?: EmbeddingServiceInterface;
  /** Optional: Config cascade resolver for per-field config overrides */
  cascadeResolver?: ConfigCascadeResolver;
}

export class AIJobProcessor {
  private prisma: PrismaClient;
  private memoryManager?: PgvectorMemoryAdapter;
  private ragService: ConversationalRAGService;
  private llmGenerationHandler: LLMGenerationHandler;
  private apiKeyResolver: ApiKeyResolver;
  private configResolver: LlmConfigResolver;

  constructor(options: AIJobProcessorOptions) {
    const {
      prisma,
      memoryManager,
      ragService,
      apiKeyResolver,
      configResolver,
      personaResolver,
      embeddingService,
      cascadeResolver,
    } = options;

    this.prisma = prisma;
    this.memoryManager = memoryManager;

    // Use provided RAGService (for testing) or create new one (for production)
    // Note: PersonaResolver is passed through to MemoryRetriever for persona-based memory retrieval
    this.ragService = ragService ?? new ConversationalRAGService(memoryManager, personaResolver);

    // Use provided ApiKeyResolver (for testing) or create new one (for production)
    // ApiKeyResolver handles BYOK - looking up and decrypting user API keys
    this.apiKeyResolver = apiKeyResolver ?? new ApiKeyResolver(prisma);

    // Use provided LlmConfigResolver (for testing) or create new one (for production)
    // LlmConfigResolver handles user config overrides (per-personality and global default)
    this.configResolver = configResolver ?? new LlmConfigResolver(prisma);

    this.llmGenerationHandler = new LLMGenerationHandler(
      this.ragService,
      this.apiKeyResolver,
      this.configResolver,
      embeddingService,
      cascadeResolver
    );
  }

  /**
   * Process a single AI job - routes to appropriate handler based on job type
   */
  async processJob(job: Job<AnyJobData>): Promise<AnyJobResult | ShapesImportJobResult> {
    // Shapes import jobs use job.name for routing (they don't extend BaseJobData)
    if (job.name === (JobType.ShapesImport as string)) {
      logger.info({ jobId: job.id, jobType: job.name }, '[AIJobProcessor] Processing job');
      return this.processShapesImportJobWrapper(job as unknown as Job<ShapesImportJobData>);
    }

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
   *
   * Note: Audio transcription jobs are preprocessing jobs that don't need async delivery.
   * They're consumed via:
   * - BullMQ job return value (for wait=true synchronous requests)
   * - Redis storage (for dependent LLM generation jobs)
   * We intentionally do NOT publish to the Redis stream to avoid "unknown job" warnings
   * in bot-client when it receives results for jobs it didn't track.
   */
  private async processAudioTranscriptionJobWrapper(
    job: Job<AudioTranscriptionJobData>
  ): Promise<AudioTranscriptionResult> {
    const result = await processAudioTranscriptionJob(job);

    // Store result in Redis for dependent jobs (with userId namespacing)
    const jobId = job.id ?? job.data.requestId;
    const userId = job.data.context.userId;
    if (!userId) {
      logger.warn({ jobId }, '[AIJobProcessor] Audio job missing userId - using fallback key');
    }
    await redisService.storeJobResult(`${userId || 'unknown'}:${jobId}`, result);

    // Note: Do NOT publish to stream - audio transcription is a preprocessing job
    // that doesn't need async delivery to bot-client

    return result;
  }

  /**
   * Wrapper for image description job - handles result storage
   *
   * Note: Image description jobs are preprocessing jobs that don't need async delivery.
   * They're consumed via:
   * - BullMQ job return value (for wait=true synchronous requests)
   * - Redis storage (for dependent LLM generation jobs)
   * We intentionally do NOT publish to the Redis stream to avoid "unknown job" warnings
   * in bot-client when it receives results for jobs it didn't track.
   */
  private async processImageDescriptionJobWrapper(
    job: Job<ImageDescriptionJobData>
  ): Promise<ImageDescriptionResult> {
    const result = await processImageDescriptionJob(job, this.apiKeyResolver);

    // Store result in Redis for dependent jobs (with userId namespacing)
    const jobId = job.id ?? job.data.requestId;
    const userId = job.data.context.userId;
    if (!userId) {
      logger.warn({ jobId }, '[AIJobProcessor] Image job missing userId - using fallback key');
    }
    await redisService.storeJobResult(`${userId || 'unknown'}:${jobId}`, result);

    // Note: Do NOT publish to stream - image description is a preprocessing job
    // that doesn't need async delivery to bot-client

    return result;
  }

  /**
   * Process LLM generation job (may depend on preprocessing jobs)
   */
  private async processLLMGenerationJob(
    job: Job<LLMGenerationJobData>
  ): Promise<LLMGenerationResult> {
    // Idempotency check: prevent duplicate processing of the same Discord message
    const triggerMessageId = job.data.context.triggerMessageId;
    let lockAcquired = false;

    if (triggerMessageId !== undefined) {
      const isNew = await redisService.markMessageProcessing(triggerMessageId);
      if (!isNew) {
        // Message already being processed - return early without publishing to stream
        logger.warn(
          { jobId: job.id, triggerMessageId },
          '[AIJobProcessor] Skipping duplicate message - already processed'
        );
        return {
          requestId: job.data.requestId,
          success: false,
          error: 'Duplicate message - already processed',
          metadata: {
            triggerMessageId,
            skipReason: 'idempotency_check_failed',
          },
        };
      }
      lockAcquired = true;
    }

    try {
      // Delegate to LLM generation handler
      const result = await this.llmGenerationHandler.processJob(job);

      // Log usage for BYOK tracking (only on success with user internal ID)
      if (result.success === true && job.data.context.userInternalId !== undefined) {
        await this.logUsage(job, result);
      }

      // Persist to DB and publish to Redis Stream
      await this.persistAndPublishResult(job, result);

      // Success - keep the lock to prevent reprocessing
      return result;
    } catch (error) {
      // Release lock on failure to allow BullMQ retries
      if (lockAcquired && triggerMessageId !== undefined) {
        logger.warn(
          { jobId: job.id, triggerMessageId },
          '[AIJobProcessor] Job failed, releasing idempotency lock for retry'
        );
        await redisService.releaseMessageLock(triggerMessageId);
      }
      throw error;
    }
  }

  /**
   * Log usage to database for BYOK cost tracking
   * Includes simple retry logic for transient failures
   */
  private async logUsage(
    job: Job<LLMGenerationJobData>,
    result: LLMGenerationResult
  ): Promise<void> {
    const { context, personality } = job.data;

    // Skip if no user internal ID (can't log without it)
    const userInternalId = context.userInternalId;
    if (userInternalId === undefined || userInternalId.length === 0) {
      return;
    }

    // Use provider from API key resolution (reliable) or fallback to openrouter
    const modelUsed = result.metadata?.modelUsed ?? personality.model;
    const provider = result.metadata?.providerUsed ?? 'openrouter';

    // Get input/output tokens from LLM response metadata
    const tokensIn = result.metadata?.tokensIn ?? 0;
    const tokensOut = result.metadata?.tokensOut ?? 0;

    // Simple retry logic - try up to 3 times with exponential backoff
    const maxRetries = 3;
    const baseDelayMs = 100;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const createdAt = new Date();
        await this.prisma.usageLog.create({
          data: {
            id: generateUsageLogUuid(userInternalId, modelUsed, createdAt),
            userId: userInternalId,
            provider,
            model: modelUsed,
            tokensIn,
            tokensOut,
            requestType: 'llm_generation',
            createdAt,
          },
        });

        logger.debug(
          { userId: userInternalId, model: modelUsed, tokensIn, tokensOut },
          '[AIJobProcessor] Logged usage'
        );
        return; // Success - exit retry loop
      } catch (error) {
        if (attempt < maxRetries) {
          // Exponential backoff: 100ms, 200ms, 400ms...
          const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
          logger.debug(
            { err: error, attempt, maxRetries, delayMs },
            '[AIJobProcessor] Usage logging failed, retrying...'
          );
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          // Final attempt failed - log warning but don't fail the job
          logger.warn(
            { err: error, userId: userInternalId, attempts: maxRetries },
            '[AIJobProcessor] Failed to log usage after retries (non-fatal)'
          );
        }
      }
    }
  }

  /**
   * Health check - verify processor is ready to handle jobs
   *
   * Checks that all required services are initialized.
   * For a deeper health check (database connectivity, etc.),
   * use the /health endpoint which does async checks.
   */
  healthCheck(): boolean {
    // Verify all internal services are initialized
    const hasRagService = this.ragService !== undefined && this.ragService !== null;
    const hasHandler =
      this.llmGenerationHandler !== undefined && this.llmGenerationHandler !== null;
    const hasApiKeyResolver = this.apiKeyResolver !== undefined && this.apiKeyResolver !== null;
    const hasConfigResolver = this.configResolver !== undefined && this.configResolver !== null;
    const hasPrisma = this.prisma !== undefined && this.prisma !== null;

    return hasRagService && hasHandler && hasApiKeyResolver && hasConfigResolver && hasPrisma;
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

  /**
   * Wrapper for shapes.inc import job
   *
   * Import jobs are self-contained: they manage their own status tracking via
   * ImportJob records and don't use Redis stream delivery. Results are stored
   * directly in the ImportJob table.
   */
  private async processShapesImportJobWrapper(
    job: Job<ShapesImportJobData>
  ): Promise<ShapesImportJobResult> {
    if (this.memoryManager === undefined) {
      throw new Error('Memory manager not available - cannot process shapes import');
    }

    return processShapesImportJob(job, {
      prisma: this.prisma,
      memoryAdapter: this.memoryManager,
    });
  }
}
