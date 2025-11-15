/**
 * Results Listener - Redis Stream Consumer
 *
 * Subscribes to the job-results Redis Stream and delivers completed
 * AI job results to Discord channels.
 *
 * Uses consumer groups for reliability and scalability.
 */

import { createClient, type RedisClientType } from 'redis';
import {
  createLogger,
  getConfig,
  parseRedisUrl,
  createRedisSocketConfig,
  type JobResult,
} from '@tzurot/common-types';

const logger = createLogger('ResultsListener');
const config = getConfig();

const STREAM_NAME = 'job-results';
const CONSUMER_GROUP = 'bot-client-results';
const CONSUMER_NAME = `bot-${process.pid}`;
const BLOCK_MS = 5000; // Block for 5s waiting for new messages
const READ_COUNT = 10; // Read up to 10 messages at a time

interface JobResultMessage {
  jobId: string;
  requestId: string;
  result: string; // JSON-stringified JobResult
  completedAt: string;
}

export class ResultsListener {
  private redis: RedisClientType;
  private isListening = false;
  private onResult?: (jobId: string, result: JobResult) => Promise<void>;

  constructor() {

    // Create dedicated Redis connection for consuming stream
    // (best practice: separate connection for blocking reads)
    const parsedUrl =
      config.REDIS_URL && config.REDIS_URL.length > 0 ? parseRedisUrl(config.REDIS_URL) : null;

    const redisConfig = createRedisSocketConfig({
      host: parsedUrl?.host || config.REDIS_HOST,
      port: parsedUrl?.port || config.REDIS_PORT,
      password: parsedUrl?.password || config.REDIS_PASSWORD,
      username: parsedUrl?.username,
      family: 6, // Railway private network uses IPv6
    });

    this.redis = createClient(redisConfig) as RedisClientType;

    this.redis.on('error', error => {
      logger.error({ err: error }, '[ResultsListener] Redis client error');
    });
  }

  /**
   * Start listening for job results
   * @param onResult Callback to handle completed results
   */
  async start(onResult: (jobId: string, result: JobResult) => Promise<void>): Promise<void> {
    this.onResult = onResult;

    try {
      // Connect to Redis
      await this.redis.connect();
      logger.info('[ResultsListener] Connected to Redis');

      // Create consumer group (idempotent - won't error if exists)
      try {
        await this.redis.xGroupCreate(STREAM_NAME, CONSUMER_GROUP, '0', {
          MKSTREAM: true, // Create stream if it doesn't exist
        });
        logger.info(
          { stream: STREAM_NAME, group: CONSUMER_GROUP },
          '[ResultsListener] Created consumer group'
        );
      } catch (error: unknown) {
        // BUSYGROUP error means group already exists - this is fine
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('BUSYGROUP')) {
          logger.info({ group: CONSUMER_GROUP }, '[ResultsListener] Consumer group already exists');
        } else {
          throw error;
        }
      }

      // Start consuming loop
      this.isListening = true;
      this.consumeLoop();

      logger.info(
        { consumer: CONSUMER_NAME, group: CONSUMER_GROUP },
        '[ResultsListener] Started listening for job results'
      );
    } catch (error) {
      logger.error({ err: error }, '[ResultsListener] Failed to start listening');
      throw error;
    }
  }

  /**
   * Stop listening and disconnect
   */
  async stop(): Promise<void> {
    this.isListening = false;
    await this.redis.quit();
    logger.info('[ResultsListener] Stopped listening');
  }

  /**
   * Main consumption loop - runs continuously
   */
  private async consumeLoop(): Promise<void> {
    while (this.isListening) {
      try {
        // Read pending messages first (messages that were read but not ACKed)
        const pendingMessages = await this.redis.xReadGroup(
          CONSUMER_GROUP,
          CONSUMER_NAME,
          [{ key: STREAM_NAME, id: '0' }], // '0' means pending messages
          { COUNT: READ_COUNT }
        );

        if (pendingMessages && pendingMessages.length > 0) {
          await this.processMessages(pendingMessages);
        }

        // Read new messages (block until available)
        const newMessages = await this.redis.xReadGroup(
          CONSUMER_GROUP,
          CONSUMER_NAME,
          [{ key: STREAM_NAME, id: '>' }], // '>' means only new messages
          { COUNT: READ_COUNT, BLOCK: BLOCK_MS }
        );

        if (newMessages && newMessages.length > 0) {
          await this.processMessages(newMessages);
        }
      } catch (error) {
        logger.error({ err: error }, '[ResultsListener] Error in consume loop');
        // Sleep briefly before retrying to avoid tight error loop
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Process messages from Redis Stream
   */
  private async processMessages(messages: unknown): Promise<void> {
    // Type assertion - xReadGroup returns a specific structure
    const streamMessages = messages as Array<{
      name: string;
      messages: Array<{
        id: string;
        message: Record<string, string>;
      }>;
    }>;

    for (const stream of streamMessages) {
      for (const msg of stream.messages) {
        try {
          const data: JobResultMessage = {
            jobId: msg.message.jobId,
            requestId: msg.message.requestId,
            result: msg.message.result,
            completedAt: msg.message.completedAt,
          };

          logger.info(
            { jobId: data.jobId, messageId: msg.id },
            '[ResultsListener] Received job result'
          );

          // Parse inner result object from JSON string
          const parsedResult = JSON.parse(data.result);

          // Construct proper JobResult with all required fields
          const jobResult: JobResult = {
            jobId: data.jobId,
            status: 'completed',
            result: parsedResult,
          };

          // Deliver to handler
          if (this.onResult) {
            await this.onResult(data.jobId, jobResult);
          }

          // Acknowledge message (removes from pending)
          await this.redis.xAck(STREAM_NAME, CONSUMER_GROUP, msg.id);

          logger.debug({ messageId: msg.id }, '[ResultsListener] Acknowledged message');
        } catch (error) {
          logger.error(
            { err: error, messageId: msg.id },
            '[ResultsListener] Error processing message - will retry'
          );
          // Don't ACK - message stays in pending list for retry
        }
      }
    }
  }
}
