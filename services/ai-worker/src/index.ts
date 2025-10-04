/**
 * AI Worker - Main Entry Point
 *
 * This service:
 * 1. Connects to ChromaDB for vector memory
 * 2. Initializes the RAG service
 * 3. Listens to BullMQ queue for AI generation jobs
 * 4. Processes jobs and returns results
 */

import { Worker, Job } from 'bullmq';
import { QdrantMemoryAdapter } from './memory/QdrantMemoryAdapter.js';
import { AIJobProcessor, AIJobData, AIJobResult } from './jobs/AIJobProcessor.js';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('ai-worker');

// Configuration from environment
const config = {
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASSWORD,
    // Railway private networking requires IPv6
    family: 6,
    // Parse Railway's REDIS_URL if provided
    ...(process.env.REDIS_URL !== undefined && process.env.REDIS_URL.length > 0 ? parseRedisUrl(process.env.REDIS_URL) : {})
  },
  chroma: {
    url: process.env.CHROMA_URL ?? 'http://localhost:8000'
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY // For embeddings
  },
  worker: {
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '5'),
    queueName: process.env.QUEUE_NAME ?? 'ai-requests'
  },
  features: {
    enableMemory: process.env.ENABLE_MEMORY === 'true'
  }
};

/**
 * Parse Railway's REDIS_URL format
 * Format: redis://default:password@host:port
 */
function parseRedisUrl(url: string): { host: string; port: number; password?: string; username?: string } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379'),
      password: parsed.password || undefined,
      username: parsed.username !== 'default' ? parsed.username : undefined
    };
  } catch (error) {
    logger.error({ err: error }, '[Config] Failed to parse REDIS_URL');
    return {
      host: 'localhost',
      port: 6379
    };
  }
}

/**
 * Initialize the AI worker
 */
async function main(): Promise<void> {
  logger.info('[AIWorker] Starting AI Worker service...');
  logger.info('[AIWorker] Configuration:', {
    redis: { ...config.redis, password: config.redis.password ? '***' : undefined },
    chroma: config.chroma,
    worker: config.worker
  });

  // Initialize vector memory manager (only if enabled)
  let memoryManager: QdrantMemoryAdapter | undefined;

  if (config.features.enableMemory) {
    logger.info('[AIWorker] Initializing Qdrant connection...');

    try {
      memoryManager = new QdrantMemoryAdapter();
      const healthy = await memoryManager.healthCheck();

      if (healthy) {
        logger.info('[AIWorker] Qdrant initialized successfully');
      } else {
        logger.warn('[AIWorker] Qdrant health check failed');
        logger.warn('[AIWorker] Continuing without vector memory - responses will have no long-term memory');
        memoryManager = undefined;
      }
    } catch (error) {
      logger.error({ err: error }, '[AIWorker] Failed to initialize Qdrant');
      logger.warn('[AIWorker] Continuing without vector memory - responses will have no long-term memory');
      memoryManager = undefined;
    }
  } else {
    logger.info('[AIWorker] Vector memory disabled (ENABLE_MEMORY=false)');
  }

  // Initialize job processor
  const jobProcessor = new AIJobProcessor(memoryManager);

  // Create BullMQ worker
  logger.info('[AIWorker] Creating BullMQ worker...');
  const worker = new Worker<AIJobData, AIJobResult>(
    config.worker.queueName,
    async (job: Job<AIJobData>) => {
      // Process the job based on type
      if (job.data.jobType === 'stream') {
        return await jobProcessor.processStreamJob(job);
      } else {
        return await jobProcessor.processJob(job);
      }
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
    logger.info(`[AIWorker] Job ${jobId} completed successfully`, {
      requestId: result.requestId,
      processingTime: result.metadata?.processingTimeMs
    });
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

  // Health check endpoint (for Railway health monitoring)
  // We'll add a simple HTTP server for health checks
  if (process.env.ENABLE_HEALTH_SERVER !== 'false') {
    await startHealthServer(memoryManager, worker);
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('[AIWorker] Shutting down gracefully...');
    await worker.close();
    logger.info('[AIWorker] Worker closed');
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
  memoryManager: QdrantMemoryAdapter | undefined,
  worker: Worker
): Promise<void> {
  const http = await import('http');
  const port = parseInt(process.env.PORT ?? '3001');

  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.url === '/health') {
        try {
          const qdrantHealthy = memoryManager !== undefined
            ? await memoryManager.healthCheck()
            : true; // If memory is disabled, we're still healthy
          const workerHealthy = !(await worker.closing);

          const status = qdrantHealthy && workerHealthy ? 200 : 503;
          const health = {
            status: qdrantHealthy && workerHealthy ? 'healthy' : 'degraded',
            qdrant: memoryManager !== undefined ? qdrantHealthy : 'disabled',
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