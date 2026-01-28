/**
 * BullMQ Queue Setup
 *
 * Configures the Redis-based job queue for AI generation requests.
 */

import { Queue, QueueEvents, FlowProducer } from 'bullmq';
import {
  createLogger,
  getConfig,
  TIMEOUTS,
  INTERVALS,
  QUEUE_CONFIG,
  parseRedisUrl,
  createBullMQRedisConfig,
  JOB_PREFIXES,
} from '@tzurot/common-types';
import { AttachmentStorageService } from './services/AttachmentStorageService.js';

const logger = createLogger('Queue');
const config = getConfig();

// Create attachment storage service for cleanup
const attachmentStorage = new AttachmentStorageService({
  gatewayUrl: config.PUBLIC_GATEWAY_URL ?? config.GATEWAY_URL,
});

// Get Redis connection config from environment
if (config.REDIS_URL === undefined || config.REDIS_URL.length === 0) {
  throw new Error('REDIS_URL environment variable is required');
}

const parsedUrl = parseRedisUrl(config.REDIS_URL);

const redisConfig = createBullMQRedisConfig({
  host: parsedUrl.host,
  port: parsedUrl.port,
  password: parsedUrl.password,
  username: parsedUrl.username,
  family: 6, // Railway private network uses IPv6
});

logger.info(
  {
    host: redisConfig.host,
    port: redisConfig.port,
    hasPassword: redisConfig.password !== undefined,
    connectTimeout: redisConfig.connectTimeout,
    commandTimeout: redisConfig.commandTimeout,
  },
  '[Queue] Redis config:'
);

// Queue name
const QUEUE_NAME = config.QUEUE_NAME;

// Create the AI requests queue
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: BullMQ Queue must be shared across all route handlers to ensure consistent job processing. Creating multiple instances would cause jobs to be processed multiple times or missed entirely.
export const aiQueue = new Queue(QUEUE_NAME, {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3, // Retry failed jobs up to 3 times
    backoff: {
      type: 'exponential',
      delay: TIMEOUTS.QUEUE_RETRY_DELAY,
    },
    removeOnComplete: { count: QUEUE_CONFIG.COMPLETED_HISTORY_LIMIT },
    removeOnFail: { count: QUEUE_CONFIG.FAILED_HISTORY_LIMIT },
  },
});

// Create flow producer for job dependencies
// FlowProducer allows creating parent-child job relationships where parent waits for children
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: FlowProducer must be shared to maintain job dependency relationships. Multiple instances would break parent-child job tracking.
export const flowProducer = new FlowProducer({
  connection: redisConfig,
});

// Create queue events listener
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: QueueEvents listener must be shared to avoid duplicate event handling. Multiple instances would cause events to fire multiple times.
export const queueEvents = new QueueEvents(QUEUE_NAME, {
  connection: redisConfig,
});

// Event handlers
queueEvents.on('completed', ({ jobId }) => {
  logger.info(`[Queue] Job ${jobId} completed`);

  // Clean up temporary attachments after a short delay
  // This ensures ai-worker has finished all async operations
  // Job ID format is llm-{requestId} for main generation jobs
  if (jobId.startsWith(JOB_PREFIXES.LLM_GENERATION)) {
    const requestId = jobId.substring(JOB_PREFIXES.LLM_GENERATION.length);
    setTimeout(() => {
      void attachmentStorage.cleanup(requestId);
    }, INTERVALS.ATTACHMENT_CLEANUP_DELAY);
  }
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error({ failedReason }, `[Queue] Job ${jobId} failed:`);

  // Clean up temporary attachments even on failure
  if (jobId.startsWith(JOB_PREFIXES.LLM_GENERATION)) {
    const requestId = jobId.substring(JOB_PREFIXES.LLM_GENERATION.length);
    setTimeout(() => {
      void attachmentStorage.cleanup(requestId);
    }, INTERVALS.ATTACHMENT_CLEANUP_DELAY);
  }
});

queueEvents.on('error', error => {
  logger.error({ err: error }, '[Queue] Queue error');
});

// Graceful shutdown
export async function closeQueue(): Promise<void> {
  logger.info('[Queue] Closing queue connections...');
  await queueEvents.close();
  await flowProducer.close();
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
