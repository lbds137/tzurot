/**
 * BullMQ Queue Setup
 *
 * Configures the Redis-based job queue for AI generation requests.
 */

import { Queue, QueueEvents } from 'bullmq';
import { createLogger, getConfig, TIMEOUTS, parseRedisUrl } from '@tzurot/common-types';
import { cleanupAttachments } from './utils/tempAttachmentStorage.js';

const logger = createLogger('Queue');
const config = getConfig();

// Get Redis connection config from environment
// Prefer REDIS_URL (Railway provides this), fall back to individual variables
const redisConfig = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
  // Railway private networking requires IPv6
  family: 6,
  // Parse Railway's REDIS_URL if provided (overrides individual variables)
  ...(config.REDIS_URL && config.REDIS_URL.length > 0 ? parseRedisUrl(config.REDIS_URL) : {})
};

logger.info({
  host: redisConfig.host,
  port: redisConfig.port,
  hasPassword: redisConfig.password !== undefined
}, '[Queue] Redis config:');

// Queue name
const QUEUE_NAME = config.QUEUE_NAME;

// Create the AI requests queue
export const aiQueue = new Queue(QUEUE_NAME, {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3, // Retry failed jobs up to 3 times
    backoff: {
      type: 'exponential',
      delay: TIMEOUTS.QUEUE_RETRY_DELAY
    },
    removeOnComplete: { count: 100 }, // Keep last 100 completed jobs
    removeOnFail: { count: 500 }      // Keep last 500 failed jobs for debugging
  }
});

// Create queue events listener
export const queueEvents = new QueueEvents(QUEUE_NAME, {
  connection: redisConfig
});

// Event handlers
queueEvents.on('completed', ({ jobId }) => {
  logger.info(`[Queue] Job ${jobId} completed`);

  // Clean up temporary attachments after a short delay
  // This ensures ai-worker has finished all async operations
  // Job ID format is req-{requestId}
  if (jobId.startsWith('req-')) {
    const requestId = jobId.substring(4);
    setTimeout(() => {
      void cleanupAttachments(requestId);
    }, 5000); // 5 second delay
  }
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error({ failedReason }, `[Queue] Job ${jobId} failed:`);

  // Clean up temporary attachments even on failure
  if (jobId.startsWith('req-')) {
    const requestId = jobId.substring(4);
    setTimeout(() => {
      void cleanupAttachments(requestId);
    }, 5000); // 5 second delay
  }
});

queueEvents.on('error', (error) => {
  logger.error({ err: error }, '[Queue] Queue error');
});

// Graceful shutdown
export async function closeQueue(): Promise<void> {
  logger.info('[Queue] Closing queue connections...');
  await queueEvents.close();
  await aiQueue.close();
  logger.info('[Queue] Queue connections closed');
}

// Health check
export async function checkQueueHealth(): Promise<boolean> {
  try {
    const client = await aiQueue.client;
    await client.ping();
    return true;
  } catch (error) {
    logger.error({ err: error }, '[Queue] Health check failed');
    return false;
  }
}
