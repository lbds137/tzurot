/**
 * DenylistCache
 *
 * In-memory cache for denylist entries, optimized for O(1) lookups.
 * Hydrated on startup from the API gateway, then kept in sync
 * via Redis pub/sub invalidation events.
 *
 * Stores mode (BLOCK or MUTE) per entry:
 * - BLOCK: Full deny — bot doesn't respond AND messages filtered from context
 * - MUTE: Soft deny — bot doesn't respond but messages remain in context
 *
 * Five data structures for different scope lookups:
 * - botUsers: Map of user Discord ID → DenylistMode
 * - botGuilds: Map of guild Discord ID → DenylistMode
 * - guildUsers: Map of userId → Map of guildId → DenylistMode
 * - channelUsers: Map of userId → Map of channelId → DenylistMode
 * - personalityUsers: Map of userId → Map of personalityId → DenylistMode
 */

import {
  createLogger,
  type DenylistInvalidationEvent,
  type DenylistCacheResponse,
  type DenylistMode,
} from '@tzurot/common-types';
import type { GatewayClient } from '../utils/GatewayClient.js';

const logger = createLogger('DenylistCache');

/** Default mode for entries that don't specify one (backward compat with hydration) */
const DEFAULT_MODE: DenylistMode = 'BLOCK';

export class DenylistCache {
  private botUsers = new Map<string, DenylistMode>();
  private botGuilds = new Map<string, DenylistMode>();
  private guildUsers = new Map<string, Map<string, DenylistMode>>();
  private channelUsers = new Map<string, Map<string, DenylistMode>>();
  private personalityUsers = new Map<string, Map<string, DenylistMode>>();

  /**
   * Hydrate cache from the API gateway on startup.
   *
   * Fail-open by design: if the gateway is unreachable, the bot starts with
   * an empty denylist cache and operates permissively. This favors availability
   * over strictness — better to allow everyone temporarily than to block all
   * users because of a transient gateway outage. The cache will be populated
   * once the gateway becomes reachable (via retry or pub/sub sync).
   *
   * Note: The gateway endpoint returns up to 10,000 entries (hardcoded limit).
   * At current scale this is more than sufficient, but if the denylist grows
   * significantly, pagination or streaming would be needed.
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
      const mode = this.resolveMode(entry.mode);
      this.addEntry(entry.type, entry.discordId, entry.scope, entry.scopeId, mode);
    }
  }

  /**
   * Handle a cache invalidation event from Redis pub/sub
   */
  handleEvent(event: DenylistInvalidationEvent): void {
    if (event.type === 'add') {
      const mode = this.resolveMode(event.entry.mode);
      this.addEntry(
        event.entry.type,
        event.entry.discordId,
        event.entry.scope,
        event.entry.scopeId,
        mode
      );
      logger.debug(
        { entityType: event.entry.type, discordId: event.entry.discordId, mode },
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
   * Check if a user or guild is denied bot-wide (both BLOCK and MUTE)
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
   * Check if a user is denied within a specific guild (USER+GUILD scope, both modes)
   */
  isUserGuildDenied(userId: string, guildId: string): boolean {
    const guilds = this.guildUsers.get(userId);
    if (guilds === undefined) {
      return false;
    }
    return guilds.has(guildId);
  }

  /**
   * Check if a user is denied for a specific channel (both BLOCK and MUTE)
   */
  isChannelDenied(userId: string, channelId: string): boolean {
    const channels = this.channelUsers.get(userId);
    if (channels === undefined) {
      return false;
    }
    return channels.has(channelId);
  }

  /**
   * Check if a user is denied for a specific personality (both BLOCK and MUTE)
   */
  isPersonalityDenied(userId: string, personalityId: string): boolean {
    const personalities = this.personalityUsers.get(userId);
    if (personalities === undefined) {
      return false;
    }
    return personalities.has(personalityId);
  }

  /**
   * Check if a user is BLOCK-denied (messages should be filtered from context).
   * Checks all scopes in priority order and returns true if ANY matching entry is BLOCK mode.
   * Used by the context builder to filter messages from extended context.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Sequential scope checks: bot-user → bot-guild → guild-user → channel-user (+ parent thread) → personality-user
  isBlocked(
    userId: string,
    guildId?: string,
    channelId?: string,
    personalityId?: string,
    parentChannelId?: string
  ): boolean {
    // Check bot-wide user block
    if (userId.length > 0) {
      const userMode = this.botUsers.get(userId);
      if (userMode === 'BLOCK') {
        return true;
      }
    }

    // Check bot-wide guild block
    if (guildId !== undefined) {
      const guildMode = this.botGuilds.get(guildId);
      if (guildMode === 'BLOCK') {
        return true;
      }
    }

    // Check guild-scoped user block
    if (guildId !== undefined) {
      const guildMap = this.guildUsers.get(userId);
      if (guildMap !== undefined) {
        const mode = guildMap.get(guildId);
        if (mode === 'BLOCK') {
          return true;
        }
      }
    }

    // Check channel-scoped user block (with thread→parent inheritance)
    if (channelId !== undefined) {
      const channelMap = this.channelUsers.get(userId);
      if (channelMap !== undefined) {
        const mode = channelMap.get(channelId);
        if (mode === 'BLOCK') {
          return true;
        }
        // Only inherit from parent if thread has NO explicit entry (MUTE overrides parent BLOCK)
        if (mode === undefined && parentChannelId !== undefined) {
          const parentMode = channelMap.get(parentChannelId);
          if (parentMode === 'BLOCK') {
            return true;
          }
        }
      }
    }

    // Check personality-scoped user block
    if (personalityId !== undefined) {
      const persMap = this.personalityUsers.get(userId);
      if (persMap !== undefined) {
        const mode = persMap.get(personalityId);
        if (mode === 'BLOCK') {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get the map of bot-denied guild IDs (for guild-leave checks)
   */
  getDeniedGuildIds(): ReadonlyMap<string, DenylistMode> {
    return this.botGuilds;
  }

  /** Map from non-BOT scope name to the corresponding Map<discordId, Map<scopeId, mode>> */
  private readonly scopeMaps: Record<string, Map<string, Map<string, DenylistMode>>> = {
    GUILD: this.guildUsers,
    CHANNEL: this.channelUsers,
    PERSONALITY: this.personalityUsers,
  };

  /** Resolve mode string to DenylistMode, defaulting to BLOCK for missing/unknown values */
  private resolveMode(mode: string | undefined): DenylistMode {
    if (mode === 'MUTE') {
      return 'MUTE';
    }
    return DEFAULT_MODE;
  }

  private addEntry(
    type: string,
    discordId: string,
    scope: string,
    scopeId: string,
    mode: DenylistMode
  ): void {
    if (scope === 'BOT') {
      const target = type === 'USER' ? this.botUsers : type === 'GUILD' ? this.botGuilds : null;
      target?.set(discordId, mode);
      return;
    }
    if (type === 'USER') {
      this.addToScopeMap(scope, discordId, scopeId, mode);
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

  private addToScopeMap(
    scope: string,
    discordId: string,
    scopeId: string,
    mode: DenylistMode
  ): void {
    const map = this.scopeMaps[scope];
    if (map === undefined) {
      return;
    }
    let inner = map.get(discordId);
    if (inner === undefined) {
      inner = new Map<string, DenylistMode>();
      map.set(discordId, inner);
    }
    inner.set(scopeId, mode);
  }

  private removeFromScopeMap(scope: string, discordId: string, scopeId: string): void {
    const map = this.scopeMaps[scope];
    if (map === undefined) {
      return;
    }
    const inner = map.get(discordId);
    if (inner === undefined) {
      return;
    }
    inner.delete(scopeId);
    if (inner.size === 0) {
      map.delete(discordId);
    }
  }
}
