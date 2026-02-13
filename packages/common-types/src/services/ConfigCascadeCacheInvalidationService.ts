/**
 * ConfigCascadeCacheInvalidationService
 *
 * Redis pub/sub service for broadcasting config cascade cache invalidation events.
 * When config overrides are updated (admin, personality, user, or user+personality),
 * this service ensures all ai-worker instances invalidate their ConfigCascadeResolver caches.
 *
 * Architecture:
 * - Publisher: api-gateway (when config overrides change)
 * - Subscribers: ai-worker instances (to invalidate ConfigCascadeResolver cache)
 *
 * Events:
 * - { type: 'user', discordId } - User's config defaults changed
 * - { type: 'personality', personalityId } - Personality config defaults changed
 * - { type: 'admin' } - Admin defaults changed (invalidate all)
 * - { type: 'all' } - Full cache clear
 */

import { REDIS_CHANNELS } from '../constants/queue.js';
import {
  BaseCacheInvalidationService,
  type EventValidator,
} from './BaseCacheInvalidationService.js';
import type { Redis } from 'ioredis';

/**
 * Event types for config cascade cache invalidation
 */
export type ConfigCascadeInvalidationEvent =
  | { type: 'user'; discordId: string }
  | { type: 'personality'; personalityId: string }
  | { type: 'admin' }
  | { type: 'all' };

/**
 * Type guard to validate ConfigCascadeInvalidationEvent structure
 */
export const isValidConfigCascadeInvalidationEvent: EventValidator<
  ConfigCascadeInvalidationEvent
> = (obj: unknown): obj is ConfigCascadeInvalidationEvent => {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const event = obj as Record<string, unknown>;

  if (event.type === 'all') {
    return Object.keys(event).length === 1;
  }

  if (event.type === 'admin') {
    return Object.keys(event).length === 1;
  }

  if (event.type === 'user') {
    return typeof event.discordId === 'string' && Object.keys(event).length === 2;
  }

  if (event.type === 'personality') {
    return typeof event.personalityId === 'string' && Object.keys(event).length === 2;
  }

  return false;
};

/**
 * Config Cascade Cache Invalidation Service
 */
export class ConfigCascadeCacheInvalidationService extends BaseCacheInvalidationService<ConfigCascadeInvalidationEvent> {
  constructor(redis: Redis) {
    super(
      redis,
      REDIS_CHANNELS.CONFIG_CASCADE_CACHE_INVALIDATION,
      'ConfigCascadeCacheInvalidationService',
      isValidConfigCascadeInvalidationEvent,
      {
        getLogContext: event => {
          if (event.type === 'user') {
            return { discordId: event.discordId };
          }
          if (event.type === 'personality') {
            return { personalityId: event.personalityId };
          }
          return {};
        },
        getEventDescription: event => {
          if (event.type === 'all') {
            return 'ALL caches';
          }
          if (event.type === 'admin') {
            return 'admin defaults changed';
          }
          if (event.type === 'user') {
            return `user ${event.discordId}`;
          }
          return `personality ${event.personalityId}`;
        },
      }
    );
  }

  /** Invalidate cache for a specific user */
  async invalidateUser(discordId: string): Promise<void> {
    await this.publish({ type: 'user', discordId });
  }

  /** Invalidate cache for a specific personality */
  async invalidatePersonality(personalityId: string): Promise<void> {
    await this.publish({ type: 'personality', personalityId });
  }

  /** Invalidate all caches (admin defaults changed) */
  async invalidateAdmin(): Promise<void> {
    await this.publish({ type: 'admin' });
  }

  /** Full cache clear */
  async invalidateAll(): Promise<void> {
    await this.publish({ type: 'all' });
  }
}
