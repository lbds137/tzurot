/**
 * DenylistCache
 *
 * In-memory cache for denylist entries, optimized for O(1) lookups.
 * Hydrated on startup from the API gateway, then kept in sync
 * via Redis pub/sub invalidation events.
 *
 * Four data structures for different scope lookups:
 * - botUsers: Set of user Discord IDs denied bot-wide
 * - botGuilds: Set of guild Discord IDs denied bot-wide
 * - channelUsers: Map of userId → Set of channelIds
 * - personalityUsers: Map of userId → Set of personalityIds
 */

import {
  createLogger,
  type DenylistInvalidationEvent,
  type DenylistCacheResponse,
} from '@tzurot/common-types';
import type { GatewayClient } from '../utils/GatewayClient.js';

const logger = createLogger('DenylistCache');

export class DenylistCache {
  private botUsers = new Set<string>();
  private botGuilds = new Set<string>();
  private guildUsers = new Map<string, Set<string>>();
  private channelUsers = new Map<string, Set<string>>();
  private personalityUsers = new Map<string, Set<string>>();

  /**
   * Hydrate cache from the API gateway on startup
   */
  async hydrate(gatewayClient: GatewayClient): Promise<void> {
    try {
      const response = await gatewayClient.getDenylistEntries();
      this.loadEntries(response);
      logger.info(
        {
          botUsers: this.botUsers.size,
          botGuilds: this.botGuilds.size,
          guildUsers: this.guildUsers.size,
          channelUsers: this.channelUsers.size,
          personalityUsers: this.personalityUsers.size,
        },
        '[DenylistCache] Hydrated from gateway'
      );
    } catch (error) {
      logger.error({ err: error }, '[DenylistCache] Failed to hydrate - starting with empty cache');
    }
  }

  /**
   * Load entries from a cache response (used by hydrate and reload)
   */
  private loadEntries(response: DenylistCacheResponse): void {
    // Clear existing data
    this.botUsers.clear();
    this.botGuilds.clear();
    this.guildUsers.clear();
    this.channelUsers.clear();
    this.personalityUsers.clear();

    for (const entry of response.entries) {
      this.addEntry(entry.type, entry.discordId, entry.scope, entry.scopeId);
    }
  }

  /**
   * Handle a cache invalidation event from Redis pub/sub
   */
  handleEvent(event: DenylistInvalidationEvent): void {
    if (event.type === 'add') {
      this.addEntry(
        event.entry.type,
        event.entry.discordId,
        event.entry.scope,
        event.entry.scopeId
      );
      logger.debug(
        { entityType: event.entry.type, discordId: event.entry.discordId },
        '[DenylistCache] Added entry from event'
      );
    } else if (event.type === 'remove') {
      this.removeEntry(
        event.entry.type,
        event.entry.discordId,
        event.entry.scope,
        event.entry.scopeId
      );
      logger.debug(
        { entityType: event.entry.type, discordId: event.entry.discordId },
        '[DenylistCache] Removed entry from event'
      );
    }
    // 'all' events trigger a full re-hydration (handled by caller)
  }

  /**
   * Check if a user or guild is denied bot-wide
   */
  isBotDenied(userId: string, guildId?: string): boolean {
    if (userId.length > 0 && this.botUsers.has(userId)) {
      return true;
    }
    if (guildId !== undefined && this.botGuilds.has(guildId)) {
      return true;
    }
    return false;
  }

  /**
   * Check if a user is denied within a specific guild
   */
  isGuildDenied(userId: string, guildId: string): boolean {
    const guilds = this.guildUsers.get(userId);
    if (guilds === undefined) {
      return false;
    }
    return guilds.has(guildId);
  }

  /**
   * Check if a user is denied for a specific channel
   */
  isChannelDenied(userId: string, channelId: string): boolean {
    const channels = this.channelUsers.get(userId);
    if (channels === undefined) {
      return false;
    }
    return channels.has(channelId);
  }

  /**
   * Check if a user is denied for a specific personality
   */
  isPersonalityDenied(userId: string, personalityId: string): boolean {
    const personalities = this.personalityUsers.get(userId);
    if (personalities === undefined) {
      return false;
    }
    return personalities.has(personalityId);
  }

  /**
   * Get the set of bot-denied guild IDs (for guild-leave checks)
   */
  getDeniedGuildIds(): ReadonlySet<string> {
    return this.botGuilds;
  }

  /** Map from non-BOT scope name to the corresponding Map<discordId, Set<scopeId>> */
  private readonly scopeMaps: Record<string, Map<string, Set<string>>> = {
    GUILD: this.guildUsers,
    CHANNEL: this.channelUsers,
    PERSONALITY: this.personalityUsers,
  };

  private addEntry(type: string, discordId: string, scope: string, scopeId: string): void {
    if (scope === 'BOT') {
      const target = type === 'USER' ? this.botUsers : type === 'GUILD' ? this.botGuilds : null;
      target?.add(discordId);
      return;
    }
    if (type === 'USER') {
      this.addToScopeMap(scope, discordId, scopeId);
    }
  }

  private removeEntry(type: string, discordId: string, scope: string, scopeId: string): void {
    if (scope === 'BOT') {
      const target = type === 'USER' ? this.botUsers : type === 'GUILD' ? this.botGuilds : null;
      target?.delete(discordId);
      return;
    }
    if (type === 'USER') {
      this.removeFromScopeMap(scope, discordId, scopeId);
    }
  }

  private addToScopeMap(scope: string, discordId: string, scopeId: string): void {
    const map = this.scopeMaps[scope];
    if (map === undefined) {
      return;
    }
    let set = map.get(discordId);
    if (set === undefined) {
      set = new Set<string>();
      map.set(discordId, set);
    }
    set.add(scopeId);
  }

  private removeFromScopeMap(scope: string, discordId: string, scopeId: string): void {
    const map = this.scopeMaps[scope];
    if (map === undefined) {
      return;
    }
    const set = map.get(discordId);
    if (set === undefined) {
      return;
    }
    set.delete(scopeId);
    if (set.size === 0) {
      map.delete(discordId);
    }
  }
}
