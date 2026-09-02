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
 *
 * Failed invalidations are logged, not retried: the personality cache TTL
 * (5 minutes) bounds staleness, so a dropped event self-heals rather than
 * needing a redelivery mechanism. Critical config changes should be verified
 * manually after execution.
 */

import { REDIS_CHANNELS } from '@tzurot/common-types/constants/queue';
import {
  BaseCacheInvalidationService,
  createEventValidator,
  type InvalidationCallback,
} from './BaseCacheInvalidationService.js';
import type { Redis } from 'ioredis';

/**
 * The minimal cache surface this service drives. PersonalityService
 * satisfies it structurally; so does any other personality cache that needs
 * pub/sub-driven invalidation (e.g. bot-client's HttpPersonalityLoader in
 * CONTEXT_MODE=service).
 */
export interface PersonalityCacheTarget {
  /** Invalidation events always carry the personality UUID, never a name. */
  invalidatePersonality(personalityId: string): void;
  invalidateAll(): void;
}

type InvalidationEvent = { type: 'personality'; personalityId: string } | { type: 'all' };

/**
 * Type guard to validate InvalidationEvent structure
 * Exported for use in DatabaseNotificationListener
 */
export const isValidInvalidationEvent = createEventValidator<InvalidationEvent>([
  { type: 'personality', fields: { personalityId: 'string' } },
  { type: 'all' },
]);

export class CacheInvalidationService extends BaseCacheInvalidationService<InvalidationEvent> {
  constructor(
    redis: Redis,
    private readonly personalityService: PersonalityCacheTarget
  ) {
    super(
      redis,
      REDIS_CHANNELS.CACHE_INVALIDATION,
      'CacheInvalidationService',
      isValidInvalidationEvent,
      {
        getLogContext: event =>
          event.type === 'personality' ? { personalityId: event.personalityId } : {},
        getEventDescription: event =>
          event.type === 'personality' ? 'personality' : 'ALL personalities',
      }
    );
  }

  // ONE stable reference on purpose: the base class dedupes registrations by
  // identity, so repeated subscribe() calls register exactly one dispatcher —
  // the replacement for the old "already subscribed, skipping" early return,
  // and safe under concurrent first calls where that guard was not. Pinned by
  // "should prevent resource leak from double-subscribe" here and by
  // "dedupes a repeated subscribe(sameFn)" in the base class's tests.
  private readonly dispatch = (event: InvalidationEvent): void => {
    if (event.type === 'all') {
      this.personalityService.invalidateAll();
      return;
    }
    this.personalityService.invalidatePersonality(event.personalityId);
  };

  /**
   * Start listening for cache invalidation events; call during service
   * initialization. Registers the personality-cache dispatcher by default.
   * The parameter is there so a caller holding this instance through the
   * base-class type gets the base contract — its own callback registered —
   * instead of a zero-arity override silently ignoring the argument.
   * Pinned by "registers an explicitly passed callback instead of the default
   * dispatcher".
   */
  override async subscribe(
    callback: InvalidationCallback<InvalidationEvent> = this.dispatch
  ): Promise<void> {
    await super.subscribe(callback);
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
