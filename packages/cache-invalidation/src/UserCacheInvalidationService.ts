/**
 * UserCacheInvalidationService
 *
 * Redis pub/sub for dropping a discordId's provisioning-cache entry across
 * EVERY process. UserService caches `discordId → {userId, defaultPersonaId}`
 * and reads it before the DB, so when account deletion removes the `users`
 * row, every process's cache still maps to the now-dead userId — the next
 * write against it FK-violates (runtime-confirmed: export_jobs, and the same
 * class on ai-worker's usage-log insert).
 *
 * - Publisher: api-gateway (the account-deletion route). It does NOT
 *   subscribe — the route evicts its own process's cache synchronously
 *   instead, which covers a single api-gateway replica. If api-gateway ever
 *   runs multiple replicas, it must also subscribe or the non-deleting
 *   replicas' caches stay stale until the TTL.
 * - Subscriber: ai-worker's context pipeline (the only subscriber today).
 */

import { REDIS_CHANNELS } from '@tzurot/common-types/constants/queue';
import {
  BaseCacheInvalidationService,
  createStandardEventValidator,
  type StandardInvalidationEvent,
} from './BaseCacheInvalidationService.js';
import type { Redis } from 'ioredis';

const isValidUserInvalidationEvent = createStandardEventValidator<StandardInvalidationEvent>();

export class UserCacheInvalidationService extends BaseCacheInvalidationService<StandardInvalidationEvent> {
  constructor(redis: Redis) {
    super(
      redis,
      REDIS_CHANNELS.USER_CACHE_INVALIDATION,
      'UserCacheInvalidationService',
      isValidUserInvalidationEvent,
      {
        getLogContext: event => (event.type === 'user' ? { discordId: event.discordId } : {}),
        getEventDescription: event =>
          event.type === 'all' ? 'ALL user caches' : `user ${event.discordId}`,
      }
    );
  }

  /** Invalidate one user's provisioning cache across all services. */
  async invalidateUser(discordId: string): Promise<void> {
    await this.publish({ type: 'user', discordId });
  }

  /**
   * Invalidate every user's provisioning cache (migrations/admin). No publisher
   * exists yet — kept for symmetry with every sibling `*CacheInvalidationService`
   * (and the `'all'` variant the {@link StandardInvalidationEvent} type requires);
   * a future admin/migration tool is the intended caller.
   */
  async invalidateAll(): Promise<void> {
    await this.publish({ type: 'all' });
  }
}
