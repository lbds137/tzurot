/**
 * SystemSettingsCacheInvalidationService
 *
 * Redis pub/sub service for broadcasting system-settings invalidation events
 * (the `admin_settings.system_settings` JSONB bag) across services.
 *
 * Architecture:
 * - Publisher: api-gateway (the system-settings write route)
 * - Subscribers: ai-worker AND api-gateway itself (self-subscribe, so the
 *   gateway's own SystemSettingsService cache refreshes on its own writes)
 *
 * Events:
 * - { type: 'keys', keys: [...] } - Named settings changed. The key list is
 *   informational (audit/log readability); subscribers clear the whole tiny
 *   cache either way.
 * - { type: 'all' } - Full refresh (seed pass, bulk import).
 */

import { REDIS_CHANNELS } from '@tzurot/common-types/constants/queue';
import { BaseCacheInvalidationService } from './BaseCacheInvalidationService.js';
import type { Redis } from 'ioredis';

/**
 * Event types for system-settings cache invalidation
 */
export type SystemSettingsInvalidationEvent = { type: 'keys'; keys: string[] } | { type: 'all' };

/**
 * Type guard to validate SystemSettingsInvalidationEvent structure.
 * Hand-written because the declarative `createEventValidator` only supports
 * scalar field types and `keys` is a string array.
 */
export function isValidSystemSettingsInvalidationEvent(
  obj: unknown
): obj is SystemSettingsInvalidationEvent {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const event = obj as Record<string, unknown>;

  if (event.type === 'all') {
    return Object.keys(event).length === 1;
  }

  if (event.type === 'keys') {
    return (
      Object.keys(event).length === 2 &&
      Array.isArray(event.keys) &&
      event.keys.length > 0 &&
      event.keys.every(key => typeof key === 'string')
    );
  }

  return false;
}

/**
 * System Settings Cache Invalidation Service
 *
 * Publishes and subscribes to system-settings invalidation events so every
 * service's SystemSettingsService cache refreshes promptly after a write
 * (the TTL alone would bound staleness, but a write should propagate now).
 */
export class SystemSettingsCacheInvalidationService extends BaseCacheInvalidationService<SystemSettingsInvalidationEvent> {
  constructor(redis: Redis) {
    super(
      redis,
      REDIS_CHANNELS.SYSTEM_SETTINGS_CACHE_INVALIDATION,
      'SystemSettingsCacheInvalidation',
      isValidSystemSettingsInvalidationEvent,
      {
        getLogContext: event => (event.type === 'keys' ? { keys: event.keys } : {}),
        getEventDescription: event =>
          event.type === 'keys' ? `keys: ${event.keys.join(', ')}` : 'ALL settings (full refresh)',
      }
    );
  }

  /**
   * Publish a changed-keys event (the write route's per-edit publish)
   */
  async invalidateKeys(keys: string[]): Promise<void> {
    await this.publish({ type: 'keys', keys });
  }

  /**
   * Publish a full-refresh event
   */
  async invalidateAll(): Promise<void> {
    await this.publish({ type: 'all' });
  }
}
