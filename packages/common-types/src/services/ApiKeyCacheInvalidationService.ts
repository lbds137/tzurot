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

import { REDIS_CHANNELS } from '../constants/queue.js';
import {
  BaseCacheInvalidationService,
  createStandardEventValidator,
  type StandardInvalidationEvent,
} from './BaseCacheInvalidationService.js';
import type { Redis } from 'ioredis';

/**
 * Event types for API key cache invalidation
 */
export type ApiKeyInvalidationEvent = StandardInvalidationEvent;

/**
 * Type guard to validate ApiKeyInvalidationEvent structure
 */
export const isValidApiKeyInvalidationEvent =
  createStandardEventValidator<ApiKeyInvalidationEvent>();

/**
 * API Key Cache Invalidation Service
 *
 * Lightweight service for publishing and subscribing to API key cache invalidation events.
 */
export class ApiKeyCacheInvalidationService extends BaseCacheInvalidationService<ApiKeyInvalidationEvent> {
  constructor(redis: Redis) {
    super(
      redis,
      REDIS_CHANNELS.API_KEY_CACHE_INVALIDATION,
      'ApiKeyCacheInvalidationService',
      isValidApiKeyInvalidationEvent,
      {
        getLogContext: event => (event.type === 'user' ? { discordId: event.discordId } : {}),
        getEventDescription: event =>
          event.type === 'all' ? 'ALL users' : `user ${event.discordId}`,
      }
    );
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
