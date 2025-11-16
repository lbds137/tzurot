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
import { PgvectorMemoryAdapter } from './services/PgvectorMemoryAdapter.js';
import { AIJobProcessor } from './jobs/AIJobProcessor.js';
import { PendingMemoryProcessor } from './jobs/PendingMemoryProcessor.js';
import {
  createLogger,
  getConfig,
  parseRedisUrl,
  createBullMQRedisConfig,
  CONTENT_TYPES,
  HealthStatus,
  QUEUE_CONFIG,
  TIMEOUTS,
  type AnyJobData,
  type AnyJobResult,
} from '@tzurot/common-types';

const logger = createLogger('ai-worker');
const envConfig = getConfig();

// Get Redis connection config from environment
const parsedUrl =
  envConfig.REDIS_URL !== undefined && envConfig.REDIS_URL.length > 0
    ? parseRedisUrl(envConfig.REDIS_URL)
    : null;

const redisConfig = createBullMQRedisConfig({
  host: parsedUrl?.host !== undefined && parsedUrl.host.length > 0 ? parsedUrl.host : envConfig.REDIS_HOST,
  port: parsedUrl?.port !== undefined && parsedUrl.port > 0 ? parsedUrl.port : envConfig.REDIS_PORT,
  password:
    parsedUrl?.password !== undefined && parsedUrl.password.length > 0
      ? parsedUrl.password
      : envConfig.REDIS_PASSWORD,
  username: parsedUrl?.username,
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
  if (envConfig.OPENAI_API_KEY === undefined || envConfig.OPENAI_API_KEY.length === 0) {
    logger.fatal('OPENAI_API_KEY environment variable is required for memory embeddings');
    process.exit(1);
  }
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

  // Initialize vector memory manager (pgvector)
  let memoryManager: PgvectorMemoryAdapter | undefined;

  logger.info('[AIWorker] Initializing pgvector memory connection...');

  try {
    memoryManager = new PgvectorMemoryAdapter();
    const healthy = await memoryManager.healthCheck();

    if (healthy) {
      logger.info('[AIWorker] Pgvector memory initialized successfully');
    } else {
      logger.warn({}, '[AIWorker] Pgvector health check failed');
      logger.warn(
        {},
        '[AIWorker] Continuing without vector memory - responses will have no long-term memory'
      );
      await memoryManager.disconnect(); // Clean up Prisma connection
      memoryManager = undefined;
    }
  } catch (error) {
    logger.error({ err: error }, '[AIWorker] Failed to initialize pgvector memory');
    logger.warn(
      {},
      '[AIWorker] Continuing without vector memory - responses will have no long-term memory'
    );
    if (memoryManager) {
      await memoryManager.disconnect(); // Clean up Prisma connection
    }
    memoryManager = undefined;
  }

  // Initialize job processor
  const jobProcessor = new AIJobProcessor(memoryManager);

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

  // Set up pending memory retry system
  logger.info('[AIWorker] Setting up pending memory retry system...');
  const pendingMemoryProcessor = new PendingMemoryProcessor(memoryManager);

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
          const memoryHealthy =
            memoryManager !== undefined ? await memoryManager.healthCheck() : true; // If memory is disabled, we're still healthy
          // Worker is healthy if it's running (not paused)
          const workerHealthy = !worker.isPaused();

          const status = memoryHealthy && workerHealthy ? 200 : 503;
          const health = {
            status: memoryHealthy && workerHealthy ? HealthStatus.Healthy : HealthStatus.Degraded,
            memory: memoryManager !== undefined ? memoryHealthy : 'disabled',
            worker: workerHealthy,
            timestamp: new Date().toISOString(),
          };

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
