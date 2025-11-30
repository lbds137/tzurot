/**
 * Results Listener - Redis Stream Consumer
 *
 * Subscribes to the job-results Redis Stream and delivers completed
 * AI job results to Discord channels.
 *
 * Uses consumer groups for reliability and scalability.
 * Uses ioredis (unified Redis client for all services - BullMQ requires it anyway)
 */

import { Redis as IORedis } from 'ioredis';
import {
  createLogger,
  getConfig,
  parseRedisUrl,
  createBullMQRedisConfig,
  type LLMGenerationResult,
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
  private redis: IORedis;
  private isListening = false;
  private onResult?: (jobId: string, result: LLMGenerationResult) => Promise<void>;

  constructor() {
    // Create dedicated Redis connection for consuming stream
    // (best practice: separate connection for blocking reads)
    if (config.REDIS_URL === undefined || config.REDIS_URL.length === 0) {
      throw new Error('REDIS_URL environment variable is required');
    }

    const parsedUrl = parseRedisUrl(config.REDIS_URL);

    const ioredisConfig = createBullMQRedisConfig({
      host: parsedUrl.host,
      port: parsedUrl.port,
      password: parsedUrl.password,
      username: parsedUrl.username,
      family: 6, // Railway private network uses IPv6
    });

    this.redis = new IORedis({
      host: ioredisConfig.host,
      port: ioredisConfig.port,
      password: ioredisConfig.password,
      username: ioredisConfig.username,
      family: ioredisConfig.family,
      connectTimeout: ioredisConfig.connectTimeout,
      commandTimeout: ioredisConfig.commandTimeout,
      keepAlive: ioredisConfig.keepAlive,
      lazyConnect: true, // Connect manually in start()
      enableReadyCheck: ioredisConfig.enableReadyCheck,
    });

    this.redis.on('error', (error: Error) => {
      logger.error({ err: error }, '[ResultsListener] Redis client error');
    });
  }

  /**
   * Start listening for job results
   * @param onResult Callback to handle completed results
   */
  async start(
    onResult: (jobId: string, result: LLMGenerationResult) => Promise<void>
  ): Promise<void> {
    this.onResult = onResult;

    try {
      // Connect to Redis (manual since lazyConnect is true)
      await this.redis.connect();
      logger.info('[ResultsListener] Connected to Redis (ioredis)');

      // Create consumer group (idempotent - won't error if exists)
      try {
        // ioredis xgroup: xgroup('CREATE', stream, group, id, 'MKSTREAM')
        await this.redis.xgroup('CREATE', STREAM_NAME, CONSUMER_GROUP, '0', 'MKSTREAM');
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
      void this.consumeLoop();

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
        // ioredis xreadgroup: xreadgroup('GROUP', group, consumer, 'COUNT', n, 'STREAMS', key, id)
        const pendingMessages = await this.redis.xreadgroup(
          'GROUP',
          CONSUMER_GROUP,
          CONSUMER_NAME,
          'COUNT',
          READ_COUNT,
          'STREAMS',
          STREAM_NAME,
          '0' // '0' means pending messages
        );

        if (pendingMessages !== null && pendingMessages.length > 0) {
          await this.processMessages(pendingMessages);
        }

        // Read new messages (block until available)
        // ioredis xreadgroup with BLOCK: xreadgroup('GROUP', group, consumer, 'COUNT', n, 'BLOCK', ms, 'STREAMS', key, id)
        const newMessages = await this.redis.xreadgroup(
          'GROUP',
          CONSUMER_GROUP,
          CONSUMER_NAME,
          'COUNT',
          READ_COUNT,
          'BLOCK',
          BLOCK_MS,
          'STREAMS',
          STREAM_NAME,
          '>' // '>' means only new messages
        );

        if (newMessages !== null && newMessages.length > 0) {
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
   *
   * ioredis xreadgroup returns: [[streamName, [[messageId, [field, value, field, value, ...]], ...]]]
   */
  private async processMessages(messages: unknown): Promise<void> {
    // ioredis returns nested arrays: [[streamName, [[id, [f1, v1, f2, v2, ...]], ...]]]
    const streamResults = messages as [string, [string, string[]][]][];

    for (const [_streamName, entries] of streamResults) {
      for (const [messageId, fields] of entries) {
        try {
          // Convert flat array [f1, v1, f2, v2, ...] to object
          const messageObj: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) {
            messageObj[fields[i]] = fields[i + 1];
          }

          const data: JobResultMessage = {
            jobId: messageObj.jobId,
            requestId: messageObj.requestId,
            result: messageObj.result,
            completedAt: messageObj.completedAt,
          };

          logger.info({ jobId: data.jobId, messageId }, '[ResultsListener] Received job result');

          // Parse LLMGenerationResult from JSON string
          const result = JSON.parse(data.result) as LLMGenerationResult;

          // Deliver to handler
          if (this.onResult) {
            await this.onResult(data.jobId, result);
          }

          // Acknowledge message (removes from pending)
          // ioredis xack: xack(stream, group, id)
          await this.redis.xack(STREAM_NAME, CONSUMER_GROUP, messageId);

          logger.debug({ messageId }, '[ResultsListener] Acknowledged message');
        } catch (error) {
          logger.error(
            { err: error, messageId },
            '[ResultsListener] Error processing message - will retry'
          );
          // Don't ACK - message stays in pending list for retry
        }
      }
    }
  }
}
