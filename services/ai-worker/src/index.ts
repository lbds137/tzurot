/**
 * AI Worker - Main Entry Point
 *
 * This service:
 * 1. Connects to pgvector for vector memory
 * 2. Initializes the RAG service
 * 3. Listens to BullMQ queue for AI generation jobs
 * 4. Processes jobs and returns results
 * 5. Runs scheduled job to retry pending memory storage
 */

import { Worker, Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { PgvectorMemoryAdapter } from './services/PgvectorMemoryAdapter.js';
import { LocalEmbeddingService } from '@tzurot/embeddings';
import { AIJobProcessor } from './jobs/AIJobProcessor.js';
import { PendingMemoryProcessor } from './jobs/PendingMemoryProcessor.js';
import { cleanupDiagnosticLogs } from './jobs/CleanupDiagnosticLogs.js';
import { cleanupStuckImportJobs } from './jobs/cleanupStuckImportJobs.js';
import { cleanupStuckExportJobs } from './jobs/cleanupStuckExportJobs.js';
import { cleanupExpiredExports } from './jobs/cleanupExpiredExports.js';
import {
  createLogger,
  getConfig,
  parseRedisUrl,
  createBullMQRedisConfig,
  getPrismaClient,
  CONTENT_TYPES,
  HealthStatus,
  QUEUE_CONFIG,
  TIMEOUTS,
  type PrismaClient,
  type AnyJobData,
} from '@tzurot/common-types';
import { validateRequiredEnvVars, validateAIConfig, buildHealthResponse } from './startup.js';
import { setupCacheInvalidation } from './cacheInvalidation.js';
import { initStopSequenceRedis } from './services/StopSequenceTracker.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Scheduled job names */
const SCHEDULED_JOBS = {
  PROCESS_PENDING_MEMORIES: 'process-pending-memories',
  CLEANUP_DIAGNOSTIC_LOGS: 'cleanup-diagnostic-logs',
  CLEANUP_STUCK_IMPORTS: 'cleanup-stuck-imports',
  CLEANUP_STUCK_EXPORTS: 'cleanup-stuck-exports',
  CLEANUP_EXPIRED_EXPORTS: 'cleanup-expired-exports',
} as const;

// ============================================================================
// TYPES
// ============================================================================

/** Result of scheduled jobs setup */
interface ScheduledJobsResult {
  scheduledQueue: Queue;
  scheduledWorker: Worker;
}

const logger = createLogger('ai-worker');
const envConfig = getConfig();

// Validate required environment variables at startup
validateRequiredEnvVars();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- REDIS_URL is validated by validateRequiredEnvVars() above, but TypeScript can't infer the narrowed type across function boundaries
const parsedUrl = parseRedisUrl(envConfig.REDIS_URL!);

const redisConfig = createBullMQRedisConfig({
  host: parsedUrl.host,
  port: parsedUrl.port,
  password: parsedUrl.password,
  username: parsedUrl.username,
  family: 6, // Railway private network uses IPv6
});

// Configuration from environment
const config = {
  redis: redisConfig,
  worker: {
    concurrency: envConfig.WORKER_CONCURRENCY,
    queueName: envConfig.QUEUE_NAME,
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Initialize vector memory manager with health check
 * @param prisma - Database client
 * @param embeddingService - Local embedding service for generating vectors
 */
async function initializeVectorMemory(
  prisma: PrismaClient,
  embeddingService: LocalEmbeddingService
): Promise<PgvectorMemoryAdapter | undefined> {
  logger.info('[AIWorker] Initializing pgvector memory connection...');

  try {
    const memoryManager = new PgvectorMemoryAdapter(prisma, embeddingService);
    const healthy = await memoryManager.healthCheck();

    if (healthy) {
      logger.info('[AIWorker] Pgvector memory initialized successfully');
      return memoryManager;
    } else {
      logger.warn({}, '[AIWorker] Pgvector health check failed');
      logger.warn(
        {},
        '[AIWorker] Continuing without vector memory - responses will have no long-term memory'
      );
      return undefined;
    }
  } catch (error) {
    logger.error({ err: error }, '[AIWorker] Failed to initialize pgvector memory');
    logger.warn(
      {},
      '[AIWorker] Continuing without vector memory - responses will have no long-term memory'
    );
    return undefined;
  }
}

/**
 * Initialize local embedding service for semantic duplicate detection
 * This runs the bge-small-en-v1.5 model in a Worker Thread to avoid blocking
 */
async function initializeLocalEmbedding(): Promise<LocalEmbeddingService | undefined> {
  logger.info('[AIWorker] Initializing local embedding service...');

  try {
    const embeddingService = new LocalEmbeddingService();
    const initialized = await embeddingService.initialize();

    if (initialized) {
      logger.info('[AIWorker] Local embedding service initialized successfully');
      return embeddingService;
    } else {
      logger.warn({}, '[AIWorker] Local embedding service failed to initialize');
      logger.warn(
        {},
        '[AIWorker] Continuing without local embeddings - semantic duplicate detection disabled'
      );
      return undefined;
    }
  } catch (error) {
    logger.error({ err: error }, '[AIWorker] Failed to initialize local embedding service');
    logger.warn(
      {},
      '[AIWorker] Continuing without local embeddings - semantic duplicate detection disabled'
    );
    return undefined;
  }
}

/**
 * Create the main BullMQ worker with event handlers
 */
function createMainWorker(jobProcessor: AIJobProcessor): Worker {
  // Worker uses broad types because it handles both standard AI jobs (AnyJobData)
  // and shapes-import jobs (ShapesImportJobData) which have different structures
  const worker = new Worker(
    config.worker.queueName,
    async (job: Job) => jobProcessor.processJob(job as Job<AnyJobData>),
    {
      connection: config.redis,
      concurrency: config.worker.concurrency,
      removeOnComplete: { count: QUEUE_CONFIG.COMPLETED_HISTORY_LIMIT },
      removeOnFail: { count: QUEUE_CONFIG.FAILED_HISTORY_LIMIT },
      lockDuration: TIMEOUTS.WORKER_LOCK_DURATION,
    }
  );

  worker.on('ready', () => {
    logger.info(
      `[AIWorker] Worker ready on queue: ${config.worker.queueName}, concurrency: ${config.worker.concurrency}`
    );
  });

  worker.on('active', (job: Job) => {
    const jobType = (job.data as Record<string, unknown>).jobType ?? job.name;
    logger.debug({ jobId: job.id ?? 'unknown', jobType }, '[AIWorker] Processing job');
  });

  worker.on('completed', (job: Job, result: unknown) => {
    const anyResult = result as Record<string, unknown> | undefined;
    logger.info(
      {
        requestId: anyResult?.requestId,
        processingTime: (anyResult?.metadata as Record<string, unknown> | undefined)
          ?.processingTimeMs,
      },
      `[AIWorker] Job ${job.id ?? 'unknown'} completed`
    );
  });

  worker.on('failed', (job: Job | undefined, error: Error) => {
    const jobId = job?.id ?? 'unknown';
    logger.error({ err: error }, `[AIWorker] Job ${jobId} failed`);
  });

  worker.on('error', (error: Error) => {
    logger.error({ err: error }, '[AIWorker] Worker error');
  });

  return worker;
}

/**
 * Set up scheduled jobs queue and worker for periodic maintenance tasks
 */
async function setupScheduledJobs(
  pendingMemoryProcessor: PendingMemoryProcessor,
  prisma: PrismaClient
): Promise<ScheduledJobsResult> {
  const scheduledQueue = new Queue('scheduled-jobs', { connection: config.redis });

  const scheduledWorker = new Worker(
    'scheduled-jobs',
    async (job: Job) => {
      if (job.name === SCHEDULED_JOBS.PROCESS_PENDING_MEMORIES) {
        logger.debug('[Scheduled] Running pending memory processor');
        return pendingMemoryProcessor.processPendingMemories();
      }
      if (job.name === SCHEDULED_JOBS.CLEANUP_DIAGNOSTIC_LOGS) {
        logger.debug('[Scheduled] Running diagnostic log cleanup');
        return cleanupDiagnosticLogs(prisma);
      }
      if (job.name === SCHEDULED_JOBS.CLEANUP_STUCK_IMPORTS) {
        logger.info('[Scheduled] Running stuck import job cleanup');
        return cleanupStuckImportJobs(prisma);
      }
      if (job.name === SCHEDULED_JOBS.CLEANUP_STUCK_EXPORTS) {
        logger.info('[Scheduled] Running stuck export job cleanup');
        return cleanupStuckExportJobs(prisma);
      }
      if (job.name === SCHEDULED_JOBS.CLEANUP_EXPIRED_EXPORTS) {
        logger.info('[Scheduled] Running expired export cleanup');
        return cleanupExpiredExports(prisma);
      }
      return null;
    },
    {
      connection: config.redis,
      removeOnComplete: { count: QUEUE_CONFIG.SCHEDULED_COMPLETED_LIMIT },
      removeOnFail: { count: QUEUE_CONFIG.SCHEDULED_FAILED_LIMIT },
    }
  );

  scheduledWorker.on('completed', (job: Job, result: unknown) => {
    logger.info({ result }, `[Scheduled] Job ${job.name} completed`);
  });

  scheduledWorker.on('failed', (job: Job | undefined, error: Error) => {
    logger.error({ err: error }, `[Scheduled] Job ${job?.name} failed`);
  });

  // Add repeatable job for pending memories (every 10 minutes)
  await scheduledQueue.add(
    SCHEDULED_JOBS.PROCESS_PENDING_MEMORIES,
    {},
    { repeat: { pattern: '*/10 * * * *' }, jobId: SCHEDULED_JOBS.PROCESS_PENDING_MEMORIES }
  );

  // Add repeatable job for diagnostic log cleanup (hourly)
  await scheduledQueue.add(
    SCHEDULED_JOBS.CLEANUP_DIAGNOSTIC_LOGS,
    {},
    { repeat: { pattern: '0 * * * *' }, jobId: SCHEDULED_JOBS.CLEANUP_DIAGNOSTIC_LOGS }
  );

  // Add repeatable job for stuck import job cleanup (every 15 minutes)
  await scheduledQueue.add(
    SCHEDULED_JOBS.CLEANUP_STUCK_IMPORTS,
    {},
    { repeat: { pattern: '*/15 * * * *' }, jobId: SCHEDULED_JOBS.CLEANUP_STUCK_IMPORTS }
  );

  // Add repeatable job for stuck export job cleanup (every 15 minutes, offset by 7 min)
  await scheduledQueue.add(
    SCHEDULED_JOBS.CLEANUP_STUCK_EXPORTS,
    {},
    { repeat: { pattern: '7,22,37,52 * * * *' }, jobId: SCHEDULED_JOBS.CLEANUP_STUCK_EXPORTS }
  );

  // Add repeatable job for expired export cleanup (hourly, offset by 30 min)
  await scheduledQueue.add(
    SCHEDULED_JOBS.CLEANUP_EXPIRED_EXPORTS,
    {},
    { repeat: { pattern: '30 * * * *' }, jobId: SCHEDULED_JOBS.CLEANUP_EXPIRED_EXPORTS }
  );

  logger.info(
    '[AIWorker] Scheduled jobs configured (pending memory: every 10 min, diagnostic cleanup: hourly, stuck imports/exports: every 15 min, expired exports: hourly)'
  );

  return { scheduledQueue, scheduledWorker };
}

/**
 * Initialize the AI worker
 */
async function main(): Promise<void> {
  logger.info('[AIWorker] Starting AI Worker service...');
  validateAIConfig();

  logger.info(
    {
      redis: {
        host: config.redis.host,
        port: config.redis.port,
        hasPassword: config.redis.password !== undefined && config.redis.password.length > 0,
      },
      worker: config.worker,
    },
    '[AIWorker] Configuration'
  );

  // Initialize core infrastructure
  const prisma = getPrismaClient();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- REDIS_URL is validated at startup by validateRequiredEnvVars(), but TypeScript can't track validation across function boundaries
  const cacheRedis = new Redis(envConfig.REDIS_URL!);
  cacheRedis.on('error', err => logger.error({ err }, '[AIWorker] Cache Redis error'));

  // Initialize stop sequence Redis persistence (cross-service stats)
  initStopSequenceRedis(cacheRedis);

  // Set up cache invalidation for all resolvers
  const cacheResult = await setupCacheInvalidation({ cacheRedis, prisma });
  const { apiKeyResolver, llmConfigResolver, personaResolver, cascadeResolver, cleanupFns } =
    cacheResult;

  // Initialize local embedding service (required for both vector memory and duplicate detection)
  const localEmbeddingService = await initializeLocalEmbedding();

  // Initialize vector memory (depends on embedding service)
  // If embedding service failed, vector memory also cannot work
  const memoryManager =
    localEmbeddingService !== undefined
      ? await initializeVectorMemory(prisma, localEmbeddingService)
      : undefined;

  if (localEmbeddingService !== undefined && memoryManager === undefined) {
    logger.warn({}, '[AIWorker] Embedding service ready but vector memory failed');
  }

  // Create job processor and main worker
  const jobProcessor = new AIJobProcessor({
    prisma,
    memoryManager,
    apiKeyResolver,
    configResolver: llmConfigResolver,
    personaResolver,
    embeddingService: localEmbeddingService,
    cascadeResolver,
  });
  const worker = createMainWorker(jobProcessor);

  // Set up pending memory processing
  const pendingMemoryProcessor = new PendingMemoryProcessor(prisma, memoryManager);
  const initialStats = await pendingMemoryProcessor.getStats();
  logger.info({ stats: initialStats }, '[AIWorker] Initial pending memory stats');

  if (initialStats.total > 0) {
    void pendingMemoryProcessor
      .processPendingMemories()
      .then(stats =>
        logger.info({ stats }, '[AIWorker] Startup pending memory processing complete')
      )
      .catch(err => logger.error({ err }, '[AIWorker] Startup pending memory processing failed'));
  }

  // Set up scheduled jobs
  const { scheduledQueue, scheduledWorker } = await setupScheduledJobs(
    pendingMemoryProcessor,
    prisma
  );

  // Start health server if enabled
  if (envConfig.ENABLE_HEALTH_SERVER) {
    await startHealthServer(memoryManager, worker);
  }

  // Graceful shutdown handler
  const shutdown = async (): Promise<void> => {
    logger.info('[AIWorker] Shutting down gracefully...');
    await worker.close();
    await scheduledWorker.close();
    await scheduledQueue.close();
    await pendingMemoryProcessor.disconnect();
    if (localEmbeddingService !== undefined) {
      await localEmbeddingService.shutdown();
    }
    await Promise.all(cleanupFns.map(fn => fn()));
    cacheRedis.disconnect();
    logger.info('[AIWorker] All connections closed');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  logger.info('[AIWorker] AI Worker is fully operational! 🚀');
}

/**
 * Start a simple HTTP server for health checks
 */
async function startHealthServer(
  memoryManager: PgvectorMemoryAdapter | undefined,
  worker: Worker
): Promise<void> {
  const http = await import('http');
  const port = envConfig.PORT;

  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.url === '/health') {
        try {
          const memoryDisabled = memoryManager === undefined;
          const memoryHealthy = memoryDisabled ? true : await memoryManager.healthCheck();
          const workerHealthy = !worker.isPaused();

          const health = buildHealthResponse(memoryHealthy, workerHealthy, memoryDisabled);
          const status = health.status === HealthStatus.Healthy ? 200 : 503;

          res.writeHead(status, { 'Content-Type': CONTENT_TYPES.JSON });
          res.end(JSON.stringify(health));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': CONTENT_TYPES.JSON });
          res.end(JSON.stringify({ status: HealthStatus.Error, error: String(error) }));
        }
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    })();
  });

  server.listen(port, () => {
    logger.info(`[AIWorker] Health check server listening on port ${port}`);
  });
}

// Start the worker
main().catch((error: unknown) => {
  logger.fatal({ err: error }, '[AIWorker] Fatal error during startup');
  process.exit(1);
});
