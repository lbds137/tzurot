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
import { AIJobProcessor } from './jobs/AIJobProcessor.js';
import { PendingMemoryProcessor } from './jobs/PendingMemoryProcessor.js';
import {
  createLogger,
  getConfig,
  parseRedisUrl,
  createBullMQRedisConfig,
  getPrismaClient,
  PersonalityService,
  CacheInvalidationService,
  ApiKeyCacheInvalidationService,
  LlmConfigCacheInvalidationService,
  CONTENT_TYPES,
  HealthStatus,
  QUEUE_CONFIG,
  TIMEOUTS,
  type AnyJobData,
  type AnyJobResult,
} from '@tzurot/common-types';
import { ApiKeyResolver } from './services/ApiKeyResolver.js';
import { LlmConfigResolver } from './services/LlmConfigResolver.js';
import { validateRequiredEnvVars, validateAIConfig, buildHealthResponse } from './startup.js';

const logger = createLogger('ai-worker');
const envConfig = getConfig();

// Validate required environment variables at startup
validateRequiredEnvVars();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
  openai: {
    apiKey: envConfig.OPENAI_API_KEY, // For embeddings
  },
  worker: {
    concurrency: envConfig.WORKER_CONCURRENCY,
    queueName: envConfig.QUEUE_NAME,
  },
};

/**
 * Initialize the AI worker
 */
async function main(): Promise<void> {
  logger.info('[AIWorker] Starting AI Worker service...');

  // Validate AI worker-specific required environment variables
  validateAIConfig();

  logger.info(
    {
      redis: {
        host: config.redis.host,
        port: config.redis.port,
        hasPassword: config.redis.password !== undefined,
        connectTimeout: config.redis.connectTimeout,
        commandTimeout: config.redis.commandTimeout,
      },
      worker: config.worker,
    },
    '[AIWorker] Configuration:'
  );

  // Composition Root: Create Prisma client for dependency injection
  const prisma = getPrismaClient();
  logger.info('[AIWorker] Prisma client initialized');

  // Initialize Redis for cache invalidation (separate from BullMQ Redis)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const cacheRedis = new Redis(envConfig.REDIS_URL!);
  cacheRedis.on('error', err => {
    logger.error({ err }, '[AIWorker] Cache Redis connection error');
  });
  logger.info('[AIWorker] Redis client initialized for cache invalidation');

  // Initialize PersonalityService and CacheInvalidationService
  const personalityService = new PersonalityService(prisma);
  const cacheInvalidationService = new CacheInvalidationService(cacheRedis, personalityService);

  // Subscribe to personality cache invalidation events
  await cacheInvalidationService.subscribe();
  logger.info('[AIWorker] Subscribed to personality cache invalidation events');

  // Create ApiKeyResolver for BYOK support
  const apiKeyResolver = new ApiKeyResolver(prisma);
  logger.info('[AIWorker] ApiKeyResolver initialized for BYOK support');

  // Subscribe to API key cache invalidation events
  const apiKeyCacheInvalidation = new ApiKeyCacheInvalidationService(cacheRedis);
  await apiKeyCacheInvalidation.subscribe(event => {
    if (event.type === 'all') {
      apiKeyResolver.clearCache();
      logger.info('[AIWorker] Cleared all API key cache entries');
    } else {
      apiKeyResolver.invalidateUserCache(event.discordId);
      logger.info({ discordId: event.discordId }, '[AIWorker] Invalidated API key cache for user');
    }
  });
  logger.info('[AIWorker] Subscribed to API key cache invalidation events');

  // Create LlmConfigResolver for user config overrides
  const llmConfigResolver = new LlmConfigResolver(prisma);
  logger.info('[AIWorker] LlmConfigResolver initialized for config overrides');

  // Subscribe to LLM config cache invalidation events
  const llmConfigCacheInvalidation = new LlmConfigCacheInvalidationService(cacheRedis);
  await llmConfigCacheInvalidation.subscribe(event => {
    if (event.type === 'all') {
      llmConfigResolver.clearCache();
      logger.info('[AIWorker] Cleared all LLM config cache entries');
    } else if (event.type === 'user') {
      llmConfigResolver.invalidateUserCache(event.discordId);
      logger.info(
        { discordId: event.discordId },
        '[AIWorker] Invalidated LLM config cache for user'
      );
    } else {
      // For config-specific invalidation, clear entire cache (safer than tracking users)
      llmConfigResolver.clearCache();
      logger.info(
        { configId: event.configId },
        '[AIWorker] Cleared LLM config cache (config changed)'
      );
    }
  });
  logger.info('[AIWorker] Subscribed to LLM config cache invalidation events');

  // Initialize vector memory manager (pgvector)
  let memoryManager: PgvectorMemoryAdapter | undefined;

  logger.info('[AIWorker] Initializing pgvector memory connection...');

  try {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    memoryManager = new PgvectorMemoryAdapter(prisma, envConfig.OPENAI_API_KEY!);
    const healthy = await memoryManager.healthCheck();

    if (healthy) {
      logger.info('[AIWorker] Pgvector memory initialized successfully');
    } else {
      logger.warn({}, '[AIWorker] Pgvector health check failed');
      logger.warn(
        {},
        '[AIWorker] Continuing without vector memory - responses will have no long-term memory'
      );
      memoryManager = undefined;
    }
  } catch (error) {
    logger.error({ err: error }, '[AIWorker] Failed to initialize pgvector memory');
    logger.warn(
      {},
      '[AIWorker] Continuing without vector memory - responses will have no long-term memory'
    );
    memoryManager = undefined;
  }

  // Initialize job processor with injected dependencies
  // Note: third param is ragService (undefined = use default), fourth is apiKeyResolver,
  // fifth is llmConfigResolver
  const jobProcessor = new AIJobProcessor(
    prisma,
    memoryManager,
    undefined,
    apiKeyResolver,
    llmConfigResolver
  );

  // Create BullMQ worker
  logger.info('[AIWorker] Creating BullMQ worker...');
  const worker = new Worker<AnyJobData, AnyJobResult>(
    config.worker.queueName,
    async (job: Job<AnyJobData>) => {
      return jobProcessor.processJob(job);
    },
    {
      connection: config.redis,
      concurrency: config.worker.concurrency,
      removeOnComplete: { count: QUEUE_CONFIG.COMPLETED_HISTORY_LIMIT },
      removeOnFail: { count: QUEUE_CONFIG.FAILED_HISTORY_LIMIT },
      // lockDuration: Maximum time a job can run before being considered stalled
      // Safety net for hung jobs - even with component-level timeouts, this prevents
      // jobs from blocking workers indefinitely
      lockDuration: TIMEOUTS.WORKER_LOCK_DURATION,
    }
  );

  // Worker event handlers
  worker.on('ready', () => {
    logger.info(`[AIWorker] Worker is ready and listening on queue: ${config.worker.queueName}`);
    logger.info(`[AIWorker] Concurrency: ${config.worker.concurrency}`);
  });

  worker.on('active', (job: Job<AnyJobData>) => {
    const jobId = job.id ?? 'unknown';
    const jobType = job.data.jobType;
    logger.debug({ jobId, jobType }, `[AIWorker] Processing job ${jobId}`);
  });

  worker.on('completed', (job: Job<AnyJobData>, result: AnyJobResult) => {
    const jobId = job.id ?? 'unknown';
    logger.info(
      {
        requestId: result.requestId,
        processingTime: result.metadata?.processingTimeMs,
      },
      `[AIWorker] Job ${jobId} completed successfully`
    );
  });

  worker.on('failed', (job: Job<AnyJobData> | undefined, error: Error) => {
    if (job !== undefined) {
      const jobId = job.id ?? 'unknown';
      logger.error({ err: error }, `[AIWorker] Job ${jobId} failed`);
    } else {
      logger.error({ err: error }, '[AIWorker] Job failed (no job data)');
    }
  });

  worker.on('error', (error: Error) => {
    logger.error({ err: error }, '[AIWorker] Worker error');
  });

  // Set up pending memory retry system with injected dependencies
  logger.info('[AIWorker] Setting up pending memory retry system...');
  const pendingMemoryProcessor = new PendingMemoryProcessor(prisma, memoryManager);

  // Log initial stats
  const initialStats = await pendingMemoryProcessor.getStats();
  logger.info({ stats: initialStats }, '[AIWorker] Initial pending memory stats');

  // Process pending memories on startup (don't wait, run async)
  if (initialStats.total > 0) {
    logger.info(`[AIWorker] Processing ${initialStats.total} pending memories on startup...`);
    void pendingMemoryProcessor
      .processPendingMemories()
      .then(stats => {
        logger.info({ stats }, '[AIWorker] Startup pending memory processing complete');
      })
      .catch(error => {
        logger.error({ err: error }, '[AIWorker] Startup pending memory processing failed');
      });
  }

  // Create a separate queue for scheduled jobs
  const scheduledQueue = new Queue('scheduled-jobs', {
    connection: config.redis,
  });

  // Create worker for scheduled jobs
  const scheduledWorker = new Worker(
    'scheduled-jobs',
    async (job: Job) => {
      if (job.name === 'process-pending-memories') {
        logger.debug('[Scheduled] Running pending memory processor');
        const stats = await pendingMemoryProcessor.processPendingMemories();
        return stats;
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

  // Add repeatable job to process pending memories every 10 minutes
  await scheduledQueue.add(
    'process-pending-memories',
    {},
    {
      repeat: {
        pattern: '*/10 * * * *', // Every 10 minutes (cron format)
      },
      jobId: 'process-pending-memories', // Ensure only one instance
    }
  );

  logger.info('[AIWorker] Pending memory retry system configured (runs every 10 minutes)');

  // Health check endpoint (for Railway health monitoring)
  // We'll add a simple HTTP server for health checks
  if (envConfig.ENABLE_HEALTH_SERVER) {
    await startHealthServer(memoryManager, worker);
  }

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info('[AIWorker] Shutting down gracefully...');
    await worker.close();
    await scheduledWorker.close();
    await scheduledQueue.close();
    await pendingMemoryProcessor.disconnect();
    await cacheInvalidationService.unsubscribe();
    await apiKeyCacheInvalidation.unsubscribe();
    cacheRedis.disconnect();
    logger.info('[AIWorker] All workers and connections closed');
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });

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
