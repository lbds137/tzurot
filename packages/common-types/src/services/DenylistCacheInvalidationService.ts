/**
 * DenylistCacheInvalidationService
 *
 * Redis pub/sub service for broadcasting denylist cache invalidation events
 * across bot-client instances. When a user or guild is denied/un-denied,
 * this service ensures all bot-client instances update their in-memory denylist caches.
 *
 * Architecture:
 * - Publisher: api-gateway (when admin adds/removes denylist entries)
 * - Subscribers: All bot-client instances (to update their local DenylistCache)
 *
 * Events:
 * - { type: 'add', entry: {...} } - Entry added, insert into local cache
 * - { type: 'remove', entry: {...} } - Entry removed, delete from local cache
 * - { type: 'all' } - Full cache reload (for migrations or bulk changes)
 */

import { REDIS_CHANNELS } from '../constants/queue.js';
import {
  BaseCacheInvalidationService,
  type EventValidator,
} from './BaseCacheInvalidationService.js';
import type { Redis } from 'ioredis';

/**
 * Entry reference for add/remove events (minimal fields needed for cache updates)
 */
export interface DenylistEntryRef {
  type: string;
  discordId: string;
  scope: string;
  scopeId: string;
}

/**
 * Event types for denylist cache invalidation
 */
export type DenylistInvalidationEvent =
  | { type: 'add'; entry: DenylistEntryRef }
  | { type: 'remove'; entry: DenylistEntryRef }
  | { type: 'all' };

/**
 * Type guard to validate DenylistInvalidationEvent structure
 */
export function isValidDenylistInvalidationEvent(obj: unknown): obj is DenylistInvalidationEvent {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const event = obj as Record<string, unknown>;

  if (event.type === 'all') {
    return Object.keys(event).length === 1;
  }

  if (event.type === 'add' || event.type === 'remove') {
    if (typeof event.entry !== 'object' || event.entry === null) {
      return false;
    }
    const entry = event.entry as Record<string, unknown>;
    return (
      typeof entry.type === 'string' &&
      typeof entry.discordId === 'string' &&
      typeof entry.scope === 'string' &&
      typeof entry.scopeId === 'string' &&
      Object.keys(event).length === 2
    );
  }

  return false;
}

/**
 * Denylist Cache Invalidation Service
 *
 * Publishes and subscribes to denylist cache invalidation events
 * so all bot-client instances stay in sync.
 */
export class DenylistCacheInvalidationService extends BaseCacheInvalidationService<DenylistInvalidationEvent> {
  constructor(redis: Redis) {
    super(
      redis,
      REDIS_CHANNELS.DENYLIST_CACHE_INVALIDATION,
      'DenylistCacheInvalidation',
      isValidDenylistInvalidationEvent as EventValidator<DenylistInvalidationEvent>,
      {
        getLogContext: event => {
          if (event.type === 'all') {
            return {};
          }
          return { entityType: event.entry.type, discordId: event.entry.discordId };
        },
        getEventDescription: event => {
          if (event.type === 'all') {
            return 'ALL entries (full reload)';
          }
          return `${event.type} ${event.entry.type} ${event.entry.discordId} (${event.entry.scope}/${event.entry.scopeId})`;
        },
      }
    );
  }

  /**
   * Publish an entry-added event
   */
  async publishAdd(entry: DenylistEntryRef): Promise<void> {
    await this.publish({ type: 'add', entry });
  }

  /**
   * Publish an entry-removed event
   */
  async publishRemove(entry: DenylistEntryRef): Promise<void> {
    await this.publish({ type: 'remove', entry });
  }

  /**
   * Publish a full reload event (invalidate all caches)
   */
  async publishReloadAll(): Promise<void> {
    await this.publish({ type: 'all' });
  }
}
