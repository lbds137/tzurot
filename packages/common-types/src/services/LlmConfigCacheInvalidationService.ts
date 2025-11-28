/**
 * LlmConfigCacheInvalidationService
 *
 * Redis pub/sub service for broadcasting LLM config cache invalidation events across microservices.
 * When admins update global configs or users update their overrides, this service ensures all
 * ai-worker instances invalidate their local LlmConfigResolver caches.
 *
 * Architecture:
 * - Publisher: api-gateway (when global configs are edited, or user overrides change)
 * - Subscribers: ai-worker instances (to invalidate LlmConfigResolver cache)
 *
 * Events:
 * - { type: 'user', discordId } - Invalidate LLM config cache for specific user
 * - { type: 'config', configId } - Invalidate cache for all users using a specific config
 * - { type: 'all' } - Invalidate all LLM config caches (e.g., for global config changes)
 */

import { createLogger } from '../utils/logger.js';
import { REDIS_CHANNELS } from '../constants/queue.js';
import type { Redis } from 'ioredis';

const logger = createLogger('LlmConfigCacheInvalidationService');

/**
 * Event types for LLM config cache invalidation
 */
export type LlmConfigInvalidationEvent =
  | { type: 'user'; discordId: string }
  | { type: 'config'; configId: string }
  | { type: 'all' };

/**
 * Callback function for handling invalidation events
 */
export type LlmConfigInvalidationCallback = (event: LlmConfigInvalidationEvent) => void;

/**
 * Type guard to validate LlmConfigInvalidationEvent structure
 */
export function isValidLlmConfigInvalidationEvent(obj: unknown): obj is LlmConfigInvalidationEvent {
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

  if (event.type === 'config') {
    return typeof event.configId === 'string' && Object.keys(event).length === 2;
  }

  return false;
}

/**
 * LLM Config Cache Invalidation Service
 *
 * Lightweight service for publishing and subscribing to LLM config cache invalidation events.
 */
export class LlmConfigCacheInvalidationService {
  private subscriber: Redis | null = null;
  private callbacks: LlmConfigInvalidationCallback[] = [];

  constructor(private redis: Redis) {}

  /**
   * Start listening for LLM config cache invalidation events
   * Call this during ai-worker initialization
   */
  async subscribe(callback: LlmConfigInvalidationCallback): Promise<void> {
    // Store callback
    this.callbacks.push(callback);

    // Only create subscriber connection once
    if (this.subscriber !== null) {
      logger.debug('Already subscribed to LLM config cache invalidation events');
      return;
    }

    try {
      // Create a separate Redis connection for subscribing
      // (Redis pub/sub requires dedicated connection)
      this.subscriber = this.redis.duplicate();

      await this.subscriber.subscribe(REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION);

      this.subscriber.on('message', (channel: string, message: string) => {
        if (channel !== REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION) {
          return;
        }

        try {
          const parsed: unknown = JSON.parse(message);

          if (!isValidLlmConfigInvalidationEvent(parsed)) {
            logger.error({ message }, 'Invalid LLM config invalidation event structure');
            return;
          }

          this.handleInvalidationEvent(parsed);
        } catch (error) {
          logger.error({ err: error, message }, 'Failed to parse LLM config invalidation event');
        }
      });

      logger.info('Subscribed to LLM config cache invalidation events');
    } catch (error) {
      // Clean up the subscriber connection on failure to prevent resource leak
      if (this.subscriber) {
        this.subscriber.disconnect();
        this.subscriber = null;
      }
      logger.error({ err: error }, 'Failed to subscribe to LLM config cache invalidation events');
      throw error;
    }
  }

  /**
   * Publish an LLM config cache invalidation event
   * Call this when LLM configs are modified via api-gateway
   */
  async publish(event: LlmConfigInvalidationEvent): Promise<void> {
    try {
      const message = JSON.stringify(event);
      await this.redis.publish(REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION, message);

      if (event.type === 'all') {
        logger.info('Published LLM config cache invalidation event: ALL caches');
      } else if (event.type === 'user') {
        logger.info(
          { discordId: event.discordId },
          'Published LLM config cache invalidation event for user'
        );
      } else {
        logger.info(
          { configId: event.configId },
          'Published LLM config cache invalidation event for config'
        );
      }
    } catch (error) {
      logger.error({ err: error, event }, 'Failed to publish LLM config cache invalidation event');
      throw error;
    }
  }

  /**
   * Handle received invalidation event
   * @private
   */
  private handleInvalidationEvent(event: LlmConfigInvalidationEvent): void {
    if (event.type === 'all') {
      logger.info('Received LLM config cache invalidation event: ALL caches');
    } else if (event.type === 'user') {
      logger.info(
        { discordId: event.discordId },
        'Received LLM config cache invalidation event for user'
      );
    } else {
      logger.info(
        { configId: event.configId },
        'Received LLM config cache invalidation event for config'
      );
    }

    // Notify all registered callbacks
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (error) {
        logger.error({ err: error }, 'Error in LLM config invalidation callback');
      }
    }
  }

  /**
   * Clean up subscription on shutdown
   */
  async unsubscribe(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe(REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION);
      this.subscriber.disconnect();
      this.subscriber = null;
      this.callbacks = [];
      logger.info('Unsubscribed from LLM config cache invalidation events');
    }
  }

  /**
   * Helper: Invalidate LLM config cache for specific user across all services
   * Use when user updates their own model overrides
   */
  async invalidateUserLlmConfig(discordId: string): Promise<void> {
    await this.publish({ type: 'user', discordId });
  }

  /**
   * Helper: Invalidate cache for all users using a specific config
   * Use when a global config is edited
   */
  async invalidateConfigUsers(configId: string): Promise<void> {
    await this.publish({ type: 'config', configId });
  }

  /**
   * Helper: Invalidate all LLM config caches across all services
   * Use when global configs are modified and we can't determine affected users
   */
  async invalidateAll(): Promise<void> {
    await this.publish({ type: 'all' });
  }
}
