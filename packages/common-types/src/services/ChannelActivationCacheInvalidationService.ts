/**
 * ChannelActivationCacheInvalidationService
 *
 * Redis pub/sub service for broadcasting channel activation cache invalidation events
 * across bot-client instances. When a channel is activated or deactivated, this service
 * ensures all bot-client instances invalidate their local channel activation caches.
 *
 * This prevents the critical horizontal scaling issue where:
 * - Instance A handles /channel activate
 * - Instance A invalidates its local cache
 * - Instance B still has stale "not activated" data for up to 30 seconds
 * - Messages in that channel are incorrectly handled on Instance B
 *
 * Architecture:
 * - Publisher: bot-client (when /channel activate or /channel deactivate runs)
 * - Subscribers: All bot-client instances (to invalidate their local cache)
 *
 * Events:
 * - { type: 'channel', channelId } - Invalidate cache for specific channel
 * - { type: 'all' } - Invalidate all channel activation caches (for edge cases)
 */

import { REDIS_CHANNELS } from '../constants/queue.js';
import {
  BaseCacheInvalidationService,
  type EventValidator,
} from './BaseCacheInvalidationService.js';
import type { Redis } from 'ioredis';

/**
 * Event types for channel activation cache invalidation
 */
export type ChannelActivationInvalidationEvent =
  | { type: 'channel'; channelId: string }
  | { type: 'all' };

/**
 * Type guard to validate ChannelActivationInvalidationEvent structure
 */
export function isValidChannelActivationInvalidationEvent(
  obj: unknown
): obj is ChannelActivationInvalidationEvent {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const event = obj as Record<string, unknown>;

  if (event.type === 'all') {
    return Object.keys(event).length === 1;
  }

  if (event.type === 'channel') {
    return typeof event.channelId === 'string' && Object.keys(event).length === 2;
  }

  return false;
}

/**
 * Channel Activation Cache Invalidation Service
 *
 * Lightweight service for publishing and subscribing to channel activation cache
 * invalidation events across multiple bot-client instances.
 */
export class ChannelActivationCacheInvalidationService extends BaseCacheInvalidationService<ChannelActivationInvalidationEvent> {
  constructor(redis: Redis) {
    super(
      redis,
      REDIS_CHANNELS.CHANNEL_ACTIVATION_CACHE_INVALIDATION,
      'ChannelActivationCacheInvalidation',
      isValidChannelActivationInvalidationEvent as EventValidator<ChannelActivationInvalidationEvent>,
      {
        getLogContext: event => (event.type === 'channel' ? { channelId: event.channelId } : {}),
        getEventDescription: event =>
          event.type === 'all' ? 'ALL channels' : `channel ${event.channelId}`,
      }
    );
  }

  /**
   * Helper: Invalidate channel activation cache for specific channel across all instances
   * Use when a channel is activated or deactivated
   */
  async invalidateChannel(channelId: string): Promise<void> {
    await this.publish({ type: 'channel', channelId });
  }

  /**
   * Helper: Invalidate all channel activation caches across all instances
   * Use for migrations or admin operations
   */
  async invalidateAll(): Promise<void> {
    await this.publish({ type: 'all' });
  }
}
