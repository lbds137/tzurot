/**
 * TtsConfigCacheInvalidationService
 *
 * Redis pub/sub service for broadcasting TTS config cache invalidation
 * events across microservices. Mirrors `LlmConfigCacheInvalidationService`
 * exactly — same event shapes, same guarantees, just a different channel.
 *
 * Architecture:
 *   - Publisher: api-gateway (when global TtsConfigs are edited or user
 *     overrides change via the /settings tts UX)
 *   - Subscribers: ai-worker instances (to invalidate TtsConfigResolver cache)
 *
 * Events:
 *   - { type: 'user', discordId } — invalidate TTS config cache for one user
 *   - { type: 'config', configId } — invalidate cache for all users using a config
 *   - { type: 'all' } — invalidate everything (global config changes)
 */

import { REDIS_CHANNELS } from '@tzurot/common-types/constants/queue';
import {
  BaseCacheInvalidationService,
  createEventValidator,
} from './BaseCacheInvalidationService.js';
import type { Redis } from 'ioredis';

/** Event variants for TTS config cache invalidation. */
type TtsConfigInvalidationEvent =
  { type: 'user'; discordId: string } | { type: 'config'; configId: string } | { type: 'all' };

/** Type guard for incoming pub/sub events. */
const isValidTtsConfigInvalidationEvent = createEventValidator<TtsConfigInvalidationEvent>([
  { type: 'user', fields: { discordId: 'string' } },
  { type: 'config', fields: { configId: 'string' } },
  { type: 'all' },
]);

export class TtsConfigCacheInvalidationService extends BaseCacheInvalidationService<TtsConfigInvalidationEvent> {
  constructor(redis: Redis) {
    super(
      redis,
      REDIS_CHANNELS.TTS_CONFIG_CACHE_INVALIDATION,
      'TtsConfigCacheInvalidationService',
      isValidTtsConfigInvalidationEvent,
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
            return 'ALL TTS caches';
          }
          if (event.type === 'user') {
            return `TTS user ${event.discordId}`;
          }
          return `TTS config ${event.configId}`;
        },
      }
    );
  }

  /**
   * Helper: invalidate TTS config cache for a specific user across all services.
   * Use when the user updates their own TTS overrides via /settings tts.
   */
  async invalidateUserTtsConfig(discordId: string): Promise<void> {
    await this.publish({ type: 'user', discordId });
  }

  /**
   * Helper: invalidate cache for all users using a specific TtsConfig.
   * Use when a global config is edited (admin scope).
   */
  async invalidateConfigUsers(configId: string): Promise<void> {
    await this.publish({ type: 'config', configId });
  }

  /**
   * Helper: invalidate all TTS config caches across all services.
   * Use as a heavy hammer when affected users can't be enumerated.
   */
  async invalidateAll(): Promise<void> {
    await this.publish({ type: 'all' });
  }
}
