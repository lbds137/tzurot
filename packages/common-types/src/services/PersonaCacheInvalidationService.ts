/**
 * PersonaCacheInvalidationService
 *
 * Redis pub/sub service for broadcasting persona cache invalidation events across microservices.
 * When users edit their personas via bot-client, this service ensures all ai-worker instances
 * invalidate their local PersonaResolver caches.
 *
 * Architecture:
 * - Publisher: bot-client (when users edit personas via /persona commands)
 * - Subscribers: ai-worker instances (to invalidate PersonaResolver cache)
 *
 * Events:
 * - { type: 'user', discordId } - Invalidate persona cache for specific user
 * - { type: 'all' } - Invalidate all persona caches (e.g., for migrations)
 */

import { REDIS_CHANNELS } from '../constants/queue.js';
import {
  BaseCacheInvalidationService,
  createStandardEventValidator,
  type StandardInvalidationEvent,
} from './BaseCacheInvalidationService.js';
import type { Redis } from 'ioredis';

/**
 * Event types for persona cache invalidation
 */
export type PersonaInvalidationEvent = StandardInvalidationEvent;

/**
 * Type guard to validate PersonaInvalidationEvent structure
 */
export const isValidPersonaInvalidationEvent =
  createStandardEventValidator<PersonaInvalidationEvent>();

/**
 * Persona Cache Invalidation Service
 *
 * Lightweight service for publishing and subscribing to persona cache invalidation events.
 */
export class PersonaCacheInvalidationService extends BaseCacheInvalidationService<PersonaInvalidationEvent> {
  constructor(redis: Redis) {
    super(
      redis,
      REDIS_CHANNELS.PERSONA_CACHE_INVALIDATION,
      'PersonaCacheInvalidationService',
      isValidPersonaInvalidationEvent,
      {
        getLogContext: event => (event.type === 'user' ? { discordId: event.discordId } : {}),
        getEventDescription: event =>
          event.type === 'all' ? 'ALL caches' : `user ${event.discordId}`,
      }
    );
  }

  /**
   * Helper: Invalidate persona cache for specific user across all services
   * Use when user updates their persona
   */
  async invalidateUserPersona(discordId: string): Promise<void> {
    await this.publish({ type: 'user', discordId });
  }

  /**
   * Helper: Invalidate all persona caches across all services
   * Use for migrations or admin operations
   */
  async invalidateAll(): Promise<void> {
    await this.publish({ type: 'all' });
  }
}
