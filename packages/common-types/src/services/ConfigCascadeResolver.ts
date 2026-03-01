/**
 * Config Cascade Resolver
 *
 * Resolves the effective config overrides for a user+personality+channel combination
 * using a 5-tier cascade:
 *
 *   1. HARDCODED_CONFIG_DEFAULTS (always present, lowest priority)
 *   2. AdminSettings.configDefaults (admin tier)
 *   3. Personality.configDefaults (personality tier)
 *   4. ChannelSettings.configOverrides (channel tier)
 *   5. User.configDefaults (user-default tier)
 *   6. UserPersonalityConfig.configOverrides (user+personality tier, highest priority)
 *
 * Higher tiers override lower tiers on a per-field basis.
 * Each resolved field tracks which tier provided it.
 *
 * Follows the same caching pattern as LlmConfigResolver (in-memory TTL cache,
 * cleanup interval, same constructor options).
 */

import { createLogger } from '../utils/logger.js';
import { INTERVALS } from '../constants/timing.js';
import {
  ConfigOverridesSchema,
  HARDCODED_CONFIG_DEFAULTS,
  type ConfigOverrides,
  type ConfigOverrideSource,
  type ResolvedConfigOverrides,
} from '../schemas/api/configOverrides.js';
import { ADMIN_SETTINGS_SINGLETON_ID } from '../schemas/api/adminSettings.js';
import type { PrismaClient } from './prisma.js';

const logger = createLogger('ConfigCascadeResolver');

/** Cache entry with TTL */
interface CacheEntry {
  result: ResolvedConfigOverrides;
  expiresAt: number;
}

/** Tier data for merge: source label and parsed overrides */
interface TierData {
  source: ConfigOverrideSource;
  overrides: ConfigOverrides;
}

/**
 * Config Cascade Resolver - resolves per-field config overrides across 5 tiers
 */
export class ConfigCascadeResolver {
  private prisma: PrismaClient;
  private cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(prisma: PrismaClient, options?: { cacheTtlMs?: number; enableCleanup?: boolean }) {
    this.prisma = prisma;
    this.cacheTtlMs = options?.cacheTtlMs ?? INTERVALS.API_KEY_CACHE_TTL;

    if (options?.enableCleanup !== false) {
      this.startCleanupInterval();
    }
  }

  /**
   * Resolve the effective config overrides for a user+personality+channel combination.
   *
   * @param userId - Discord user ID (or undefined for anonymous)
   * @param personalityId - Personality UUID (or undefined for no personality context)
   * @param channelId - Discord channel ID (or undefined for no channel context)
   * @returns Fully resolved config with per-field source tracking
   */
  async resolveOverrides(
    userId?: string,
    personalityId?: string,
    channelId?: string
  ): Promise<ResolvedConfigOverrides> {
    // Sentinels ('anon','none','no-ch') can't collide: snowflakes are numeric, UUIDs are hex+hyphens
    const cacheKey = `${userId ?? 'anon'}|${personalityId ?? 'none'}|${channelId ?? 'no-ch'}`;

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      logger.debug(
        { userId, personalityId, channelId, source: 'cache' },
        'Config overrides resolved from cache'
      );
      return cached.result;
    }

    // Load tiers from DB
    const tiers = await this.loadTiers(userId, personalityId, channelId);

    // Deep-merge tiers (higher index = higher priority)
    const result = this.mergeTiers(tiers);

    // Cache result
    this.cache.set(cacheKey, { result, expiresAt: Date.now() + this.cacheTtlMs });

    logger.debug(
      { userId, personalityId, channelId, tierCount: tiers.length },
      'Config overrides resolved from database'
    );

    return result;
  }

  /**
   * Load all applicable tiers from the database.
   * Returns tiers in priority order (lowest first).
   * All tier queries are independent and run concurrently via Promise.all.
   */
  private async loadTiers(
    userId?: string,
    personalityId?: string,
    channelId?: string
  ): Promise<TierData[]> {
    const [adminTiers, personalityTiers, channelTiers, userTiers] = await Promise.all([
      this.loadAdminTier(),
      personalityId !== undefined
        ? this.loadPersonalityTier(personalityId)
        : Promise.resolve([] as TierData[]),
      channelId !== undefined ? this.loadChannelTier(channelId) : Promise.resolve([] as TierData[]),
      userId !== undefined
        ? this.loadUserTiers(userId, personalityId)
        : Promise.resolve([] as TierData[]),
    ]);

    // Assemble in cascade priority order (lowest first):
    // Tier 2: admin → Tier 3: personality → Tier 4: channel → Tier 5: user-default → Tier 6: user-personality
    return [...adminTiers, ...personalityTiers, ...channelTiers, ...userTiers];
  }

  /** Load admin tier (Tier 2: singleton admin settings) */
  private async loadAdminTier(): Promise<TierData[]> {
    const tiers: TierData[] = [];
    try {
      const admin = await this.prisma.adminSettings.findUnique({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        select: { configDefaults: true },
      });
      this.pushIfValid(tiers, admin?.configDefaults, 'admin');
    } catch (error) {
      logger.warn({ err: error }, 'Failed to load admin config defaults');
    }
    return tiers;
  }

  /** Load personality tier (Tier 3) */
  private async loadPersonalityTier(personalityId: string): Promise<TierData[]> {
    const tiers: TierData[] = [];
    try {
      const personality = await this.prisma.personality.findUnique({
        where: { id: personalityId },
        select: { configDefaults: true },
      });
      this.pushIfValid(tiers, personality?.configDefaults, 'personality');
    } catch (error) {
      logger.warn({ err: error, personalityId }, 'Failed to load personality config defaults');
    }
    return tiers;
  }

  /** Load channel tier (Tier 4: channel-level overrides set by moderators) */
  private async loadChannelTier(channelId: string): Promise<TierData[]> {
    const tiers: TierData[] = [];
    try {
      const channel = await this.prisma.channelSettings.findUnique({
        where: { channelId },
        select: { configOverrides: true },
      });
      this.pushIfValid(tiers, channel?.configOverrides, 'channel');
    } catch (error) {
      logger.warn({ err: error, channelId }, 'Failed to load channel config overrides');
    }
    return tiers;
  }

  /** Load user-default (Tier 5) and user-personality (Tier 6) tiers in a single query */
  private async loadUserTiers(userId: string, personalityId?: string): Promise<TierData[]> {
    const tiers: TierData[] = [];
    try {
      const user = await this.prisma.user.findFirst({
        where: { discordId: userId },
        select: {
          id: true,
          configDefaults: true,
          personalityConfigs:
            personalityId !== undefined
              ? {
                  where: { personalityId },
                  select: { configOverrides: true },
                  take: 1,
                }
              : undefined,
        },
      });
      if (user === null) {
        return tiers;
      }

      // Tier 5: User defaults
      this.pushIfValid(tiers, user.configDefaults, 'user-default');

      // Tier 6: User-personality overrides
      this.pushIfValid(tiers, user.personalityConfigs?.[0]?.configOverrides, 'user-personality');
    } catch (error) {
      logger.warn({ err: error, userId }, 'Failed to load user config defaults');
    }
    return tiers;
  }

  /** Validate JSONB and push to tiers if valid and non-null */
  private pushIfValid(tiers: TierData[], value: unknown, source: ConfigOverrideSource): void {
    if (value === null || value === undefined) {
      return;
    }
    const parsed = this.validateJsonb(value, source);
    if (parsed !== null) {
      tiers.push({ source, overrides: parsed });
    }
  }

  /**
   * Validate a JSONB value against ConfigOverridesSchema.
   * Returns parsed config or null if invalid.
   */
  private validateJsonb(value: unknown, tierName: string): ConfigOverrides | null {
    const result = ConfigOverridesSchema.safeParse(value);
    if (!result.success) {
      logger.warn(
        { tier: tierName, errors: result.error.issues },
        'Invalid JSONB in config cascade tier, skipping'
      );
      return null;
    }
    return result.data;
  }

  /**
   * Deep-merge tiers into a fully resolved config.
   * Higher-index tiers override lower-index tiers per field.
   */
  private mergeTiers(tiers: TierData[]): ResolvedConfigOverrides {
    // Start with hardcoded defaults
    const values = { ...HARDCODED_CONFIG_DEFAULTS } as Record<keyof ConfigOverrides, unknown>;
    const sources = {} as Record<keyof ConfigOverrides, ConfigOverrideSource>;

    // Initialize all sources to 'hardcoded'
    const fields = Object.keys(HARDCODED_CONFIG_DEFAULTS) as (keyof ConfigOverrides)[];
    for (const field of fields) {
      sources[field] = 'hardcoded';
    }

    // Apply each tier (higher priority overrides)
    for (const tier of tiers) {
      for (const field of fields) {
        if (tier.overrides[field] !== undefined) {
          values[field] = tier.overrides[field];
          sources[field] = tier.source;
        }
      }
    }

    return {
      maxMessages: values.maxMessages as number,
      maxAge: values.maxAge as number | null,
      maxImages: values.maxImages as number,
      memoryScoreThreshold: values.memoryScoreThreshold as number,
      memoryLimit: values.memoryLimit as number,
      focusModeEnabled: values.focusModeEnabled as boolean,
      crossChannelHistoryEnabled: values.crossChannelHistoryEnabled as boolean,
      shareLtmAcrossPersonalities: values.shareLtmAcrossPersonalities as boolean,
      sources,
    };
  }

  /** Invalidate cache for a specific user */
  invalidateUserCache(userId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${userId}|`)) {
        this.cache.delete(key);
      }
    }
    logger.debug({ userId }, 'Invalidated config cascade cache for user');
  }

  /** Invalidate cache for a specific personality */
  invalidatePersonalityCache(personalityId: string): void {
    for (const key of this.cache.keys()) {
      // Cache key format: userId|personalityId|channelId
      const parts = key.split('|');
      if (parts[1] === personalityId) {
        this.cache.delete(key);
      }
    }
    logger.debug({ personalityId }, 'Invalidated config cascade cache for personality');
  }

  /** Invalidate cache for a specific channel */
  invalidateChannelCache(channelId: string): void {
    for (const key of this.cache.keys()) {
      // Cache key format: userId|personalityId|channelId
      const parts = key.split('|');
      if (parts[2] === channelId) {
        this.cache.delete(key);
      }
    }
    logger.debug({ channelId }, 'Invalidated config cascade cache for channel');
  }

  /** Clear all cache entries */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Cleared config cascade cache');
  }

  /** Stop the cleanup interval (call on shutdown) */
  stopCleanup(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Start periodic cleanup of expired cache entries.
   *
   * Note: This uses a local setInterval, so each service instance maintains its own
   * cleanup schedule. This is fine for single-instance deployment but would cause
   * redundant work under horizontal scaling. If scaling, consider replacing with
   * a BullMQ repeatable job or Redis TTL-based caching.
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let removedCount = 0;
      for (const [key, entry] of this.cache) {
        if (entry.expiresAt <= now) {
          this.cache.delete(key);
          removedCount++;
        }
      }
      if (removedCount > 0) {
        logger.debug(
          { removedCount, remaining: this.cache.size },
          'Cleaned up expired cache entries'
        );
      }
    }, INTERVALS.CACHE_CLEANUP);

    this.cleanupInterval.unref();
  }
}
