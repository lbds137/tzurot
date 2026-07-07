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

import { Worker, type Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { PgvectorMemoryAdapter } from './services/PgvectorMemoryAdapter.js';
import { LocalEmbeddingService } from '@tzurot/embeddings';
import { AIJobProcessor } from './jobs/AIJobProcessor.js';
import { PendingMemoryProcessor } from './jobs/PendingMemoryProcessor.js';
import { NullVectorReembedder } from './jobs/NullVectorReembedder.js';
import { setupFactExtraction } from './jobs/factExtractionSetup.js';
import { cleanupDiagnosticLogs } from './jobs/CleanupDiagnosticLogs.js';
import { cleanupStuckImportJobs } from './jobs/cleanupStuckImportJobs.js';
import { cleanupStuckExportJobs } from './jobs/cleanupStuckExportJobs.js';
import { cleanupExpiredExports } from './jobs/cleanupExpiredExports.js';
import { ConversationRetentionService } from '@tzurot/conversation-history';
import { getConfig } from '@tzurot/common-types/config/config';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { QUEUE_CONFIG, SCHEDULED_QUEUE_NAME } from '@tzurot/common-types/constants/queue';
import { HealthStatus } from '@tzurot/common-types/constants/service';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { createPrismaClient, type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type AnyJobData } from '@tzurot/common-types/types/jobs';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { registerProcessLifecycle } from '@tzurot/common-types/utils/processLifecycle';
import { parseRedisUrl, createBullMQRedisConfig } from '@tzurot/common-types/utils/redis';
import { validateRequiredEnvVars, buildHealthResponse, checkVoiceEngineHealth } from './startup.js';
import { setupCacheInvalidation } from './cacheInvalidation.js';

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
  CLEANUP_CONVERSATION_RETENTION: 'cleanup-conversation-retention',
  REEMBED_NULL_VECTORS: 'reembed-null-vectors',
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
  logger.info('Initializing pgvector memory connection...');

  try {
    const memoryManager = new PgvectorMemoryAdapter(prisma, embeddingService);
    const healthy = await memoryManager.healthCheck();

    if (healthy) {
      logger.info('Pgvector memory initialized successfully');
      return memoryManager;
    } else {
      logger.warn('Pgvector health check failed');
      logger.warn('Continuing without vector memory - responses will have no long-term memory');
      return undefined;
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize pgvector memory');
    logger.warn('Continuing without vector memory - responses will have no long-term memory');
    return undefined;
  }
}

/**
 * Initialize local embedding service for semantic duplicate detection
 * This runs the bge-small-en-v1.5 model in a Worker Thread to avoid blocking
 */
async function initializeLocalEmbedding(): Promise<LocalEmbeddingService | undefined> {
  logger.info('Initializing local embedding service...');

  try {
    const embeddingService = new LocalEmbeddingService();
    const initialized = await embeddingService.initialize();

    if (initialized) {
      logger.info('Local embedding service initialized successfully');
      return embeddingService;
    } else {
      logger.warn('Local embedding service failed to initialize');
      logger.warn('Continuing without local embeddings - semantic duplicate detection disabled');
      return undefined;
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize local embedding service');
    logger.warn('Continuing without local embeddings - semantic duplicate detection disabled');
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
      { queueName: config.worker.queueName, concurrency: config.worker.concurrency },
      'Worker ready'
    );
  });

  worker.on('active', (job: Job) => {
    const jobType = (job.data as Record<string, unknown>).jobType ?? job.name;
    logger.debug({ jobId: job.id ?? 'unknown', jobType }, 'Processing job');
  });

  worker.on('completed', (job: Job, result: unknown) => {
    const anyResult = result as Record<string, unknown> | undefined;
    logger.info(
      {
        requestId: anyResult?.requestId,
        processingTime: (anyResult?.metadata as Record<string, unknown> | undefined)
          ?.processingTimeMs,
      },
      `Job ${job.id ?? 'unknown'} completed`
    );
  });

  worker.on('failed', (job: Job | undefined, error: Error) => {
    const jobId = job?.id ?? 'unknown';
    logger.error({ err: error }, `Job ${jobId} failed`);
  });

  worker.on('error', (error: Error) => {
    logger.error({ err: error }, 'Worker error');
  });

  return worker;
}

/**
 * Repeatable-job schedule. Minute offsets are deliberate: they spread the
 * hourly/15-min jobs across the hour so runs don't stack on shared resources.
 * Conversation retention runs daily at 09:10 UTC — off-peak for the
 * primarily-US user base, offset off the hourly jobs' minute marks.
 */
const REPEATABLE_JOB_SCHEDULE: readonly { name: string; pattern: string }[] = [
  { name: SCHEDULED_JOBS.PROCESS_PENDING_MEMORIES, pattern: '*/10 * * * *' },
  { name: SCHEDULED_JOBS.REEMBED_NULL_VECTORS, pattern: '13 * * * *' },
  { name: SCHEDULED_JOBS.CLEANUP_DIAGNOSTIC_LOGS, pattern: '0 * * * *' },
  { name: SCHEDULED_JOBS.CLEANUP_STUCK_IMPORTS, pattern: '*/15 * * * *' },
  { name: SCHEDULED_JOBS.CLEANUP_STUCK_EXPORTS, pattern: '7,22,37,52 * * * *' },
  { name: SCHEDULED_JOBS.CLEANUP_EXPIRED_EXPORTS, pattern: '30 * * * *' },
  { name: SCHEDULED_JOBS.CLEANUP_CONVERSATION_RETENTION, pattern: '10 9 * * *' },
];

async function registerRepeatableJobs(scheduledQueue: Queue): Promise<void> {
  for (const { name, pattern } of REPEATABLE_JOB_SCHEDULE) {
    await scheduledQueue.add(name, {}, { repeat: { pattern }, jobId: name });
  }
}

/**
 * Set up scheduled jobs queue and worker for periodic maintenance tasks
 */
async function setupScheduledJobs(
  pendingMemoryProcessor: PendingMemoryProcessor,
  prisma: PrismaClient,
  nullVectorReembedder: NullVectorReembedder
): Promise<ScheduledJobsResult> {
  const scheduledQueue = new Queue(SCHEDULED_QUEUE_NAME, { connection: config.redis });

  const scheduledWorker = new Worker(
    SCHEDULED_QUEUE_NAME,
    async (job: Job) => {
      if (job.name === SCHEDULED_JOBS.PROCESS_PENDING_MEMORIES) {
        logger.debug('Running pending memory processor');
        const stats = await pendingMemoryProcessor.processPendingMemories();
        // Backlog snapshot rides every run's completed log — the dead-letter
        // rows (attempts >= cap / the 999 invalid-metadata sentinel) are
        // otherwise invisible after their single "Gave up" line.
        const backlog = await pendingMemoryProcessor.getStats();
        return { ...stats, backlog };
      }
      if (job.name === SCHEDULED_JOBS.REEMBED_NULL_VECTORS) {
        logger.debug('Running NULL-vector re-embed sweep');
        return nullVectorReembedder.sweep();
      }
      if (job.name === SCHEDULED_JOBS.CLEANUP_DIAGNOSTIC_LOGS) {
        logger.debug('Running diagnostic log cleanup');
        return cleanupDiagnosticLogs(prisma);
      }
      if (job.name === SCHEDULED_JOBS.CLEANUP_STUCK_IMPORTS) {
        logger.info('Running stuck import job cleanup');
        return cleanupStuckImportJobs(prisma);
      }
      if (job.name === SCHEDULED_JOBS.CLEANUP_STUCK_EXPORTS) {
        logger.info('Running stuck export job cleanup');
        return cleanupStuckExportJobs(prisma);
      }
      if (job.name === SCHEDULED_JOBS.CLEANUP_EXPIRED_EXPORTS) {
        logger.info('Running expired export cleanup');
        return cleanupExpiredExports(prisma);
      }
      if (job.name === SCHEDULED_JOBS.CLEANUP_CONVERSATION_RETENTION) {
        // Retention was manual-only (/admin cleanup, run "when I remember") — this
        // makes the 30-day window deterministic. The manual route stays as the
        // on-demand trigger; both paths share ConversationRetentionService.
        logger.info('Running conversation retention cleanup');
        const retention = new ConversationRetentionService(prisma);
        const oldHistory = await retention.cleanupOldHistory();
        const softDeleted = await retention.cleanupSoftDeletedMessages();
        const tombstones = await retention.cleanupOldTombstones();
        // Returned object lands in the worker's `completed` log line — the
        // per-table counts are what make a daily run verifiable in Railway logs.
        return { oldHistory, softDeleted, tombstones };
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
    logger.info({ result }, `Job ${job.name} completed`);
  });

  scheduledWorker.on('failed', (job: Job | undefined, error: Error) => {
    logger.error({ err: error }, `Job ${job?.name} failed`);
  });

  await registerRepeatableJobs(scheduledQueue);

  // Derived from the schedule table so this line can't silently omit a job.
  logger.info(
    {
      schedule: Object.fromEntries(REPEATABLE_JOB_SCHEDULE.map(j => [j.name, j.pattern])),
    },
    'Scheduled jobs configured'
  );

  return { scheduledQueue, scheduledWorker };
}

/**
 * Initialize the AI worker
 */
async function main(): Promise<void> {
  logger.info('Starting AI Worker service...');

  logger.info(
    {
      redis: {
        host: config.redis.host,
        port: config.redis.port,
        hasPassword: config.redis.password !== undefined && config.redis.password.length > 0,
      },
      worker: config.worker,
    },
    'Configuration'
  );

  // Initialize core infrastructure
  // ai-worker owns its PrismaClient: constructed here, injected into every
  // service that needs DB access, disposed in the shutdown handler below.
  const { prisma, dispose: disposePrisma } = createPrismaClient();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- REDIS_URL is validated at startup by validateRequiredEnvVars(), but TypeScript can't track validation across function boundaries
  const cacheRedis = new Redis(envConfig.REDIS_URL!);
  cacheRedis.on('error', err => logger.error({ err }, 'Cache Redis error'));

  // Set up cache invalidation for all resolvers
  const cacheResult = await setupCacheInvalidation({ cacheRedis, prisma });
  const {
    apiKeyResolver,
    llmConfigResolver,
    ttsConfigResolver,
    sttResolver,
    personaResolver,
    cascadeResolver,
    cleanupFns,
  } = cacheResult;

  // Initialize local embedding service (required for both vector memory and duplicate detection)
  const localEmbeddingService = await initializeLocalEmbedding();

  // Initialize vector memory (depends on embedding service)
  // If embedding service failed, vector memory also cannot work
  const memoryManager =
    localEmbeddingService !== undefined
      ? await initializeVectorMemory(prisma, localEmbeddingService)
      : undefined;

  if (localEmbeddingService !== undefined && memoryManager === undefined) {
    logger.warn('Embedding service ready but vector memory failed');
  }

  // Fact extraction (memory Phase 2, shadow mode) — undefined unless
  // EXTRACTION_ENABLED=true AND the embedding service is up.
  const factExtraction = setupFactExtraction(
    prisma,
    cacheRedis,
    redisConfig,
    localEmbeddingService
  );

  // Create job processor and main worker
  const jobProcessor = new AIJobProcessor({
    prisma,
    memoryManager,
    apiKeyResolver,
    configResolver: llmConfigResolver,
    ttsConfigResolver,
    sttResolver,
    personaResolver,
    embeddingService: localEmbeddingService,
    cascadeResolver,
    extractionTrigger: factExtraction?.trigger,
  });
  const worker = createMainWorker(jobProcessor);

  // Set up pending memory processing
  const pendingMemoryProcessor = new PendingMemoryProcessor(prisma, memoryManager);
  const initialStats = await pendingMemoryProcessor.getStats();
  logger.info({ stats: initialStats }, 'Initial pending memory stats');

  if (initialStats.total > 0) {
    void pendingMemoryProcessor
      .processPendingMemories()
      .then(stats => logger.info({ stats }, 'Startup pending memory processing complete'))
      .catch(err => logger.error({ err }, 'Startup pending memory processing failed'));
  }

  // Set up scheduled jobs
  const nullVectorReembedder = new NullVectorReembedder(prisma, memoryManager);
  const { scheduledQueue, scheduledWorker } = await setupScheduledJobs(
    pendingMemoryProcessor,
    prisma,
    nullVectorReembedder
  );

  // Start health server if enabled
  if (envConfig.ENABLE_HEALTH_SERVER) {
    await startHealthServer(memoryManager, worker);
  }

  // Pure dispose sequence — guard, hard-exit backstop, and exit semantics
  // live in registerProcessLifecycle. 'crash' policy: a worker's unhandled
  // rejection exits 1 (BullMQ re-queues in-flight jobs via lock expiry) —
  // Railway restarting a dead process is the recovery path.
  const dispose = async (): Promise<void> => {
    await worker.close();
    await scheduledWorker.close();
    await scheduledQueue.close();
    if (factExtraction !== undefined) {
      await factExtraction.worker.close();
      await factExtraction.queue.close();
    }
    await pendingMemoryProcessor.disconnect();
    if (localEmbeddingService !== undefined) {
      await localEmbeddingService.shutdown();
    }
    await Promise.all(cleanupFns.map(fn => fn()));
    cacheRedis.disconnect();
    // Dispose last: the workers above have stopped consuming jobs, so nothing
    // else holds the pool. dispose() stops the pool-stats gauge + $disconnects.
    await disposePrisma();
    logger.info('All connections closed');
  };

  registerProcessLifecycle({ logger, dispose, rejectionPolicy: 'crash' });

  // Non-blocking voice engine health check (one-shot, no polling)
  void checkVoiceEngineHealth();

  logger.info('AI Worker is fully operational! 🚀');
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
    logger.info({ port }, 'Health check server listening');
  });
}

// Start the worker
main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Fatal error during startup');
  process.exit(1);
});
