/**
 * CacheInvalidationService
 *
 * Redis pub/sub service for broadcasting cache invalidation events across microservices.
 * When LLM configs change, this service ensures all services invalidate their personality caches.
 *
 * Architecture:
 * - Publisher: Service that modifies LLM configs (api-gateway, scripts)
 * - Subscribers: All services with PersonalityService instances (api-gateway, ai-worker, bot-client)
 *
 * Events:
 * - personality:invalidate:{id} - Invalidate specific personality cache
 * - personality:invalidate:all - Invalidate all personality caches (global default changed)
 */

import { createLogger } from '../utils/logger.js';
import { REDIS_CHANNELS } from '../constants/queue.js';
import type { Redis } from 'ioredis';
import type { PersonalityService } from './personality/index.js';

const logger = createLogger('CacheInvalidationService');

export type InvalidationEvent = { type: 'personality'; personalityId: string } | { type: 'all' };

/**
 * Type guard to validate InvalidationEvent structure
 * Exported for use in DatabaseNotificationListener
 */
export function isValidInvalidationEvent(obj: unknown): obj is InvalidationEvent {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const event = obj as Record<string, unknown>;

  if (event.type === 'all') {
    return Object.keys(event).length === 1;
  }

  if (event.type === 'personality') {
    return typeof event.personalityId === 'string' && Object.keys(event).length === 2;
  }

  return false;
}

export class CacheInvalidationService {
  private subscriber: Redis | null = null;

  constructor(
    private redis: Redis,
    private personalityService: PersonalityService
  ) {}

  /**
   * Start listening for cache invalidation events
   * Call this during service initialization
   */
  async subscribe(): Promise<void> {
    // Prevent resource leak from double-subscribe
    if (this.subscriber) {
      logger.debug('Already subscribed to cache invalidation events, skipping');
      return;
    }

    try {
      // Create a separate Redis connection for subscribing
      // (Redis pub/sub requires dedicated connection)
      this.subscriber = this.redis.duplicate();

      await this.subscriber.subscribe(REDIS_CHANNELS.CACHE_INVALIDATION);

      this.subscriber.on('message', (channel: string, message: string) => {
        if (channel !== REDIS_CHANNELS.CACHE_INVALIDATION) {
          return;
        }

        try {
          const parsed: unknown = JSON.parse(message);

          if (!isValidInvalidationEvent(parsed)) {
            logger.error({ message }, 'Invalid invalidation event structure');
            return;
          }

          this.handleInvalidationEvent(parsed);
        } catch (error) {
          // Note: Failed invalidations are logged but not retried. This is acceptable
          // because personality cache has a TTL (5 minutes), so stale data will
          // eventually be invalidated. Critical config changes should be verified
          // manually after execution.
          logger.error({ err: error, message }, 'Failed to parse invalidation event');
        }
      });

      logger.info('Subscribed to cache invalidation events');
    } catch (error) {
      // Clean up the subscriber connection on failure to prevent resource leak
      if (this.subscriber) {
        this.subscriber.disconnect();
        this.subscriber = null;
      }
      logger.error({ err: error }, 'Failed to subscribe to cache invalidation events');
      throw error;
    }
  }

  /**
   * Publish a cache invalidation event
   * Call this when LLM configs are modified
   */
  async publish(event: InvalidationEvent): Promise<void> {
    try {
      const message = JSON.stringify(event);
      await this.redis.publish(REDIS_CHANNELS.CACHE_INVALIDATION, message);

      if (event.type === 'all') {
        logger.info('Published cache invalidation event: ALL personalities');
      } else {
        logger.info(
          { personalityId: event.personalityId },
          'Published cache invalidation event for personality'
        );
      }
    } catch (error) {
      logger.error({ err: error, event }, 'Failed to publish invalidation event');
      throw error;
    }
  }

  /**
   * Handle received invalidation event
   * @private
   */
  private handleInvalidationEvent(event: InvalidationEvent): void {
    if (event.type === 'all') {
      logger.info('Received cache invalidation event: ALL personalities');
      this.personalityService.invalidateAll();
    } else {
      logger.info(
        { personalityId: event.personalityId },
        'Received cache invalidation event for personality'
      );
      this.personalityService.invalidatePersonality(event.personalityId);
    }
  }

  /**
   * Clean up subscription on shutdown
   */
  async unsubscribe(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe(REDIS_CHANNELS.CACHE_INVALIDATION);
      this.subscriber.disconnect();
      this.subscriber = null;
      logger.info('Unsubscribed from cache invalidation events');
    }
  }

  /**
   * Helper: Invalidate specific personality across all services
   */
  async invalidatePersonality(personalityId: string): Promise<void> {
    await this.publish({ type: 'personality', personalityId });
  }

  /**
   * Helper: Invalidate all personalities across all services
   * Use when global default LLM config changes
   */
  async invalidateAll(): Promise<void> {
    await this.publish({ type: 'all' });
  }
}
