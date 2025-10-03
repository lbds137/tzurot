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
import { VectorMemoryManager } from './memory/VectorMemoryManager.js';
import { AIJobProcessor, AIJobData, AIJobResult } from './jobs/AIJobProcessor.js';
import { pino } from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

// Configuration from environment
const config = {
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASSWORD,
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
    logger.error('[Config] Failed to parse REDIS_URL:', error);
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

  // Initialize vector memory manager
  logger.info('[AIWorker] Initializing ChromaDB connection...');
  const memoryManager = new VectorMemoryManager(
    config.chroma.url,
    config.openai.apiKey
  );

  try {
    await memoryManager.initialize();
    logger.info('[AIWorker] ChromaDB initialized successfully');
  } catch (error) {
    logger.error('[AIWorker] Failed to initialize ChromaDB:', error);
    logger.warn('[AIWorker] Continuing without vector memory - responses will have no long-term memory');
    // Don't exit - we can still process jobs without memory, just with degraded functionality
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
      logger.error(`[AIWorker] Job ${jobId} failed:`, error);
    } else {
      logger.error('[AIWorker] Job failed (no job data):', error);
    }
  });

  worker.on('error', (error: Error) => {
    logger.error('[AIWorker] Worker error:', error);
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
  memoryManager: VectorMemoryManager,
  worker: Worker
): Promise<void> {
  const http = await import('http');
  const port = parseInt(process.env.PORT ?? '3001');

  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.url === '/health') {
        try {
          const chromaHealthy = await memoryManager.healthCheck();
          const workerHealthy = !(await worker.closing);

          const status = chromaHealthy && workerHealthy ? 200 : 503;
          const health = {
            status: chromaHealthy && workerHealthy ? 'healthy' : 'degraded',
            chroma: chromaHealthy,
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
  logger.fatal('[AIWorker] Fatal error during startup:', error);
  process.exit(1);
});