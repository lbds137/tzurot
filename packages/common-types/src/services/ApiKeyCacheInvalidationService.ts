/**
 * ApiKeyCacheInvalidationService
 *
 * Redis pub/sub service for broadcasting API key cache invalidation events across microservices.
 * When users update or remove their API keys, this service ensures all ai-worker instances
 * invalidate their local caches.
 *
 * Architecture:
 * - Publisher: api-gateway (when API keys are set/removed)
 * - Subscribers: ai-worker instances (to invalidate ApiKeyResolver cache)
 *
 * Events:
 * - { type: 'user', discordId } - Invalidate API key cache for specific user
 * - { type: 'all' } - Invalidate all API key caches (e.g., for key rotation)
 */

import { createLogger } from '../utils/logger.js';
import { REDIS_CHANNELS } from '../constants/queue.js';
import type { Redis } from 'ioredis';

const logger = createLogger('ApiKeyCacheInvalidationService');

/**
 * Event types for API key cache invalidation
 */
export type ApiKeyInvalidationEvent = { type: 'user'; discordId: string } | { type: 'all' };

/**
 * Callback function for handling invalidation events
 */
export type ApiKeyInvalidationCallback = (event: ApiKeyInvalidationEvent) => void;

/**
 * Type guard to validate ApiKeyInvalidationEvent structure
 */
export function isValidApiKeyInvalidationEvent(obj: unknown): obj is ApiKeyInvalidationEvent {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const event = obj as Record<string, unknown>;

  if (event.type === 'all') {
    return Object.keys(event).length === 1;
  }

  if (event.type === 'user') {
    return typeof event.discordId === 'string' && Object.keys(event).length === 2;
  }

  return false;
}

/**
 * API Key Cache Invalidation Service
 *
 * Lightweight service for publishing and subscribing to API key cache invalidation events.
 * Unlike the personality CacheInvalidationService, this service uses callbacks instead
 * of coupling directly to a specific service (keeps it more flexible).
 */
export class ApiKeyCacheInvalidationService {
  private subscriber: Redis | null = null;
  private callbacks: ApiKeyInvalidationCallback[] = [];

  constructor(private redis: Redis) {}

  /**
   * Start listening for API key cache invalidation events
   * Call this during ai-worker initialization
   */
  async subscribe(callback: ApiKeyInvalidationCallback): Promise<void> {
    // Store callback
    this.callbacks.push(callback);

    // Only create subscriber connection once
    if (this.subscriber !== null) {
      logger.debug('Already subscribed to API key cache invalidation events');
      return;
    }

    try {
      // Create a separate Redis connection for subscribing
      // (Redis pub/sub requires dedicated connection)
      this.subscriber = this.redis.duplicate();

      await this.subscriber.subscribe(REDIS_CHANNELS.API_KEY_CACHE_INVALIDATION);

      this.subscriber.on('message', (channel: string, message: string) => {
        if (channel !== REDIS_CHANNELS.API_KEY_CACHE_INVALIDATION) {
          return;
        }

        try {
          const parsed: unknown = JSON.parse(message);

          if (!isValidApiKeyInvalidationEvent(parsed)) {
            logger.error({ message }, 'Invalid API key invalidation event structure');
            return;
          }

          this.handleInvalidationEvent(parsed);
        } catch (error) {
          logger.error({ err: error, message }, 'Failed to parse API key invalidation event');
        }
      });

      logger.info('Subscribed to API key cache invalidation events');
    } catch (error) {
      // Clean up the subscriber connection on failure to prevent resource leak
      if (this.subscriber) {
        this.subscriber.disconnect();
        this.subscriber = null;
      }
      logger.error({ err: error }, 'Failed to subscribe to API key cache invalidation events');
      throw error;
    }
  }

  /**
   * Publish an API key cache invalidation event
   * Call this when API keys are modified via api-gateway
   */
  async publish(event: ApiKeyInvalidationEvent): Promise<void> {
    try {
      const message = JSON.stringify(event);
      await this.redis.publish(REDIS_CHANNELS.API_KEY_CACHE_INVALIDATION, message);

      if (event.type === 'all') {
        logger.info('Published API key cache invalidation event: ALL users');
      } else {
        logger.info(
          { discordId: event.discordId },
          'Published API key cache invalidation event for user'
        );
      }
    } catch (error) {
      logger.error({ err: error, event }, 'Failed to publish API key cache invalidation event');
      throw error;
    }
  }

  /**
   * Handle received invalidation event
   * @private
   */
  private handleInvalidationEvent(event: ApiKeyInvalidationEvent): void {
    if (event.type === 'all') {
      logger.info('Received API key cache invalidation event: ALL users');
    } else {
      logger.info(
        { discordId: event.discordId },
        'Received API key cache invalidation event for user'
      );
    }

    // Notify all registered callbacks
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (error) {
        logger.error({ err: error }, 'Error in API key invalidation callback');
      }
    }
  }

  /**
   * Clean up subscription on shutdown
   */
  async unsubscribe(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe(REDIS_CHANNELS.API_KEY_CACHE_INVALIDATION);
      this.subscriber.disconnect();
      this.subscriber = null;
      this.callbacks = [];
      logger.info('Unsubscribed from API key cache invalidation events');
    }
  }

  /**
   * Helper: Invalidate API key cache for specific user across all services
   */
  async invalidateUserApiKeys(discordId: string): Promise<void> {
    await this.publish({ type: 'user', discordId });
  }

  /**
   * Helper: Invalidate all API key caches across all services
   * Use when encryption key is rotated
   */
  async invalidateAll(): Promise<void> {
    await this.publish({ type: 'all' });
  }
}
