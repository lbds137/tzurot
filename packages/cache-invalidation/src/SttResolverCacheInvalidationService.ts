/**
 * SttResolverCacheInvalidationService
 *
 * Redis pub/sub service for broadcasting STT resolver cache invalidation
 * events across microservices. Mirrors {@link TtsConfigCacheInvalidationService}
 * exactly — same event shapes, different channel.
 *
 * Architecture:
 *   - Publisher: api-gateway (when /voice stt or /voice provider mutate state)
 *   - Subscribers: ai-worker instances (to invalidate SttResolver cache)
 *
 * Events:
 *   - { type: 'user', discordId } — invalidate STT cache for one user
 *   - { type: 'all' } — invalidate everything (e.g., test resets)
 *
 * Note: no `{ type: 'config', configId }` variant. STT doesn't reference
 * a config row — there's no per-config invalidation surface to model.
 */

import { REDIS_CHANNELS } from '@tzurot/common-types/constants/queue';
import {
  BaseCacheInvalidationService,
  createEventValidator,
} from './BaseCacheInvalidationService.js';
import type { Redis } from 'ioredis';

type SttResolverInvalidationEvent = { type: 'user'; discordId: string } | { type: 'all' };

const isValidSttResolverInvalidationEvent = createEventValidator<SttResolverInvalidationEvent>([
  { type: 'user', fields: { discordId: 'string' } },
  { type: 'all' },
]);

export class SttResolverCacheInvalidationService extends BaseCacheInvalidationService<SttResolverInvalidationEvent> {
  constructor(redis: Redis) {
    super(
      redis,
      REDIS_CHANNELS.STT_RESOLVER_CACHE_INVALIDATION,
      'SttResolverCacheInvalidationService',
      isValidSttResolverInvalidationEvent,
      {
        getLogContext: event => {
          if (event.type === 'user') {
            return { discordId: event.discordId };
          }
          return {};
        },
        getEventDescription: event => {
          if (event.type === 'all') {
            return 'ALL STT caches';
          }
          return `STT user ${event.discordId}`;
        },
      }
    );
  }

  /**
   * Helper: invalidate STT cache for a specific user across all services.
   * Use when /voice stt or /voice provider mutates the user's state.
   */
  async invalidateUserStt(discordId: string): Promise<void> {
    await this.publish({ type: 'user', discordId });
  }

  /** Helper: invalidate every STT cache across all services. */
  async invalidateAll(): Promise<void> {
    await this.publish({ type: 'all' });
  }
}
