/**
 * DatabaseNotificationListener
 *
 * Listens for PostgreSQL NOTIFY events and forwards them to Redis pub/sub.
 * This bridges database triggers with application-level cache invalidation.
 *
 * Architecture:
 * 1. PostgreSQL triggers send NOTIFY 'cache_invalidation' when data changes
 * 2. This service LISTENs for those notifications
 * 3. Forwards them to CacheInvalidationService (Redis pub/sub)
 * 4. All services receive Redis events and invalidate caches
 */

import { Client } from 'pg';
import {
  createLogger,
  isValidInvalidationEvent,
  DATABASE_RECONNECT,
} from '@tzurot/common-types';
import type { CacheInvalidationService } from '@tzurot/common-types';

const logger = createLogger('DatabaseNotificationListener');

export class DatabaseNotificationListener {
  private client: Client | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private reconnectAttempts = 0;

  constructor(
    private databaseUrl: string,
    private cacheInvalidationService: CacheInvalidationService
  ) {}

  /**
   * Start listening for database notifications
   */
  async start(): Promise<void> {
    if (this.client) {
      logger.debug('Already listening to database notifications');
      return;
    }

    try {
      await this.connect();
      logger.info('Started listening for database notifications');
    } catch (error) {
      logger.error({ err: error }, 'Failed to start database notification listener');
      // Schedule reconnect
      this.scheduleReconnect();
    }
  }

  /**
   * Connect to database and setup LISTEN
   */
  private async connect(): Promise<void> {
    this.client = new Client({
      connectionString: this.databaseUrl,
    });

    // Handle connection errors
    this.client.on('error', (err) => {
      logger.error({ err }, 'Database notification connection error');
      this.scheduleReconnect();
    });

    // Handle notifications
    this.client.on('notification', (msg) => {
      if (
        msg.channel === 'cache_invalidation' &&
        msg.payload !== null &&
        msg.payload !== undefined &&
        msg.payload.length > 0
      ) {
        this.handleNotification(msg.payload);
      }
    });

    // Connect and setup LISTEN
    await this.client.connect();
    await this.client.query('LISTEN cache_invalidation');

    logger.info('Connected to database notification channel');
  }

  /**
   * Handle received notification
   */
  private handleNotification(payload: string): void {
    try {
      const parsed: unknown = JSON.parse(payload);

      // Validate event structure before forwarding
      if (!isValidInvalidationEvent(parsed)) {
        logger.error({ payload }, 'Invalid notification event structure from database');
        return;
      }

      logger.debug({ event: parsed }, 'Received database notification');

      // Forward to Redis pub/sub (which all services subscribe to)
      this.cacheInvalidationService.publish(parsed).catch((error) => {
        logger.error({ err: error, event: parsed }, 'Failed to forward cache invalidation event');
      });
    } catch (error) {
      logger.error({ err: error, payload }, 'Failed to parse database notification');
    }
  }

  /**
   * Schedule reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.isShuttingDown) {
      return;
    }

    // Give up after max attempts
    if (this.reconnectAttempts >= DATABASE_RECONNECT.MAX_ATTEMPTS) {
      logger.error(
        { attempts: this.reconnectAttempts },
        'Max reconnection attempts reached, giving up on database notifications'
      );
      return;
    }

    // Clean up existing client
    if (this.client) {
      this.client.removeAllListeners();
      this.client.end().catch(() => {
        // Ignore errors during cleanup
      });
      this.client = null;
    }

    // Clear existing timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      DATABASE_RECONNECT.INITIAL_DELAY * Math.pow(2, this.reconnectAttempts),
      DATABASE_RECONNECT.MAX_DELAY
    );

    this.reconnectAttempts++;

    // Attempt reconnect after calculated delay
    this.reconnectTimeout = setTimeout(() => {
      logger.info(
        { attempt: this.reconnectAttempts, delayMs: delay },
        'Attempting to reconnect to database notifications'
      );
      this.connect()
        .then(() => {
          // Reset attempts on successful connection
          this.reconnectAttempts = 0;
          logger.info('Successfully reconnected to database notifications');
        })
        .catch((error) => {
          logger.error({ err: error }, 'Reconnection attempt failed');
          this.scheduleReconnect();
        });
    }, delay);
  }

  /**
   * Stop listening and clean up
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.client) {
      try {
        await this.client.query('UNLISTEN cache_invalidation');
        await this.client.end();
        logger.info('Stopped listening for database notifications');
      } catch (error) {
        logger.error({ err: error }, 'Error stopping database notification listener');
      }
      this.client = null;
    }
  }
}
