/**
 * BullMQ Queue Setup
 *
 * Configures the Redis-based job queue for AI generation requests.
 */

import { Queue, QueueEvents } from 'bullmq';
import { createLogger, getConfig, TIMEOUTS } from '@tzurot/common-types';

const logger = createLogger('Queue');
const config = getConfig();

// Get Redis connection config from environment (using Railway's individual variables)
const redisConfig = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
  // Railway private networking requires IPv6
  family: 6
};

logger.info('[Queue] Redis config:', {
  host: redisConfig.host,
  port: redisConfig.port,
  hasPassword: redisConfig.password !== undefined
});

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
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error(`[Queue] Job ${jobId} failed:`, failedReason);
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
