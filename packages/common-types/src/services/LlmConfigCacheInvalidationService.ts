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

import { REDIS_CHANNELS } from '../constants/queue.js';
import {
  BaseCacheInvalidationService,
  createEventValidator,
} from './BaseCacheInvalidationService.js';
import type { Redis } from 'ioredis';

/**
 * Event types for LLM config cache invalidation
 * Extends standard events with config-specific invalidation
 */
type LlmConfigInvalidationEvent =
  | { type: 'user'; discordId: string }
  | { type: 'config'; configId: string }
  | { type: 'all' };

/**
 * Type guard to validate LlmConfigInvalidationEvent structure
 */
export const isValidLlmConfigInvalidationEvent = createEventValidator<LlmConfigInvalidationEvent>([
  { type: 'user', fields: { discordId: 'string' } },
  { type: 'config', fields: { configId: 'string' } },
  { type: 'all' },
]);

/**
 * LLM Config Cache Invalidation Service
 *
 * Lightweight service for publishing and subscribing to LLM config cache invalidation events.
 */
export class LlmConfigCacheInvalidationService extends BaseCacheInvalidationService<LlmConfigInvalidationEvent> {
  constructor(redis: Redis) {
    super(
      redis,
      REDIS_CHANNELS.LLM_CONFIG_CACHE_INVALIDATION,
      'LlmConfigCacheInvalidationService',
      isValidLlmConfigInvalidationEvent,
      {
        getLogContext: event => {
          if (event.type === 'user') {
            return { discordId: event.discordId };
          }
          if (event.type === 'config') {
            return { configId: event.configId };
          }
          return {};
        },
        getEventDescription: event => {
          if (event.type === 'all') {
            return 'ALL caches';
          }
          if (event.type === 'user') {
            return `user ${event.discordId}`;
          }
          return `config ${event.configId}`;
        },
      }
    );
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
