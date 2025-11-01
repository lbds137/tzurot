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
import { PgvectorMemoryAdapter } from './memory/PgvectorMemoryAdapter.js';
import { AIJobProcessor, AIJobData, AIJobResult } from './jobs/AIJobProcessor.js';
import { PendingMemoryProcessor } from './jobs/PendingMemoryProcessor.js';
import { createLogger, getConfig, parseRedisUrl, createBullMQRedisConfig } from '@tzurot/common-types';

const logger = createLogger('ai-worker');
const envConfig = getConfig();

// Get Redis connection config from environment
const parsedUrl = envConfig.REDIS_URL && envConfig.REDIS_URL.length > 0
  ? parseRedisUrl(envConfig.REDIS_URL)
  : null;

const redisConfig = createBullMQRedisConfig({
  host: parsedUrl?.host || envConfig.REDIS_HOST,
  port: parsedUrl?.port || envConfig.REDIS_PORT,
  password: parsedUrl?.password || envConfig.REDIS_PASSWORD,
  username: parsedUrl?.username,
  family: 6, // Railway private network uses IPv6
});

// Configuration from environment
const config = {
  redis: redisConfig,
  openai: {
    apiKey: envConfig.OPENAI_API_KEY // For embeddings
  },
  worker: {
    concurrency: envConfig.WORKER_CONCURRENCY,
    queueName: envConfig.QUEUE_NAME
  }
};

/**
 * Initialize the AI worker
 */
async function main(): Promise<void> {
  logger.info('[AIWorker] Starting AI Worker service...');

  // Validate AI worker-specific required environment variables
  if (!envConfig.OPENAI_API_KEY) {
    logger.fatal('OPENAI_API_KEY environment variable is required for memory embeddings');
    process.exit(1);
  }
  logger.info({
    redis: {
      host: config.redis.host,
      port: config.redis.port,
      hasPassword: config.redis.password !== undefined,
      connectTimeout: config.redis.connectTimeout,
      commandTimeout: config.redis.commandTimeout
    },
    worker: config.worker
  }, '[AIWorker] Configuration:');

  // Initialize vector memory manager (pgvector)
  let memoryManager: PgvectorMemoryAdapter | undefined;

  logger.info('[AIWorker] Initializing pgvector memory connection...');

  try {
    memoryManager = new PgvectorMemoryAdapter();
    const healthy = await memoryManager.healthCheck();

    if (healthy) {
      logger.info('[AIWorker] Pgvector memory initialized successfully');
    } else {
      logger.warn('[AIWorker] Pgvector health check failed');
      logger.warn('[AIWorker] Continuing without vector memory - responses will have no long-term memory');
      await memoryManager.disconnect(); // Clean up Prisma connection
      memoryManager = undefined;
    }
  } catch (error) {
    logger.error({ err: error }, '[AIWorker] Failed to initialize pgvector memory');
    logger.warn('[AIWorker] Continuing without vector memory - responses will have no long-term memory');
    if (memoryManager) {
      await memoryManager.disconnect(); // Clean up Prisma connection
    }
    memoryManager = undefined;
  }

  // Initialize job processor
  const jobProcessor = new AIJobProcessor(memoryManager);

  // Create BullMQ worker
  logger.info('[AIWorker] Creating BullMQ worker...');
  const worker = new Worker<AIJobData, AIJobResult>(
    config.worker.queueName,
    async (job: Job<AIJobData>) => {
      return await jobProcessor.processJob(job);
    },
    {
      connection: config.redis,
      concurrency: config.worker.concurrency,
      removeOnComplete: { count: 100 }, // Keep last 100 completed jobs
      removeOnFail: { count: 500 }      // Keep last 500 failed jobs for debugging
    }
  );

  // Worker event handlers
  worker.on('ready', () => {
    logger.info(`[AIWorker] Worker is ready and listening on queue: ${config.worker.queueName}`);
    logger.info(`[AIWorker] Concurrency: ${config.worker.concurrency}`);
  });

  worker.on('active', (job: Job<AIJobData>) => {
    const jobId = job.id ?? 'unknown';
    logger.debug(`[AIWorker] Processing job ${jobId} for personality: ${job.data.personality.name}`);
  });

  worker.on('completed', (job: Job<AIJobData>, result: AIJobResult) => {
    const jobId = job.id ?? 'unknown';
    logger.info({
      requestId: result.requestId,
      processingTime: result.metadata?.processingTimeMs
    }, `[AIWorker] Job ${jobId} completed successfully`);
  });

  worker.on('failed', (job: Job<AIJobData> | undefined, error: Error) => {
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
    void pendingMemoryProcessor.processPendingMemories().then((stats) => {
      logger.info({ stats }, '[AIWorker] Startup pending memory processing complete');
    }).catch((error) => {
      logger.error({ err: error }, '[AIWorker] Startup pending memory processing failed');
    });
  }

  // Create a separate queue for scheduled jobs
  const scheduledQueue = new Queue('scheduled-jobs', {
    connection: config.redis
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
      removeOnComplete: { count: 10 }, // Keep fewer completed scheduled jobs
      removeOnFail: { count: 50 }
    }
  );

  scheduledWorker.on('completed', (job: Job, result: any) => {
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
        pattern: '*/10 * * * *' // Every 10 minutes (cron format)
      },
      jobId: 'process-pending-memories' // Ensure only one instance
    }
  );

  logger.info('[AIWorker] Pending memory retry system configured (runs every 10 minutes)');

  // Health check endpoint (for Railway health monitoring)
  // We'll add a simple HTTP server for health checks
  if (envConfig.ENABLE_HEALTH_SERVER) {
    await startHealthServer(memoryManager, worker);
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('[AIWorker] Shutting down gracefully...');
    await worker.close();
    await scheduledWorker.close();
    await scheduledQueue.close();
    await pendingMemoryProcessor.disconnect();
    logger.info('[AIWorker] All workers and connections closed');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

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
          const memoryHealthy = memoryManager !== undefined
            ? await memoryManager.healthCheck()
            : true; // If memory is disabled, we're still healthy
          const workerHealthy = !(await worker.closing);

          const status = memoryHealthy && workerHealthy ? 200 : 503;
          const health = {
            status: memoryHealthy && workerHealthy ? 'healthy' : 'degraded',
            memory: memoryManager !== undefined ? memoryHealthy : 'disabled',
            worker: workerHealthy,
            timestamp: new Date().toISOString()
          };

          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(health));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', error: String(error) }));
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