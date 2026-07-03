/**
 * Config Cascade Resolver
 *
 * Resolves the effective config overrides for a user+personality+channel combination
 * using a 5-tier cascade (plus hardcoded baseline):
 *
 *   Baseline: HARDCODED_CONFIG_DEFAULTS (always present, lowest priority)
 *   1. AdminSettings.configDefaults (admin tier)
 *   2. Personality.configDefaults (personality tier)
 *   3. ChannelSettings.configOverrides (channel tier)
 *   4. User.configDefaults (user-default tier)
 *   5. UserPersonalityConfig.configOverrides (user+personality tier, highest priority)
 *
 * Higher tiers override lower tiers on a per-field basis.
 * Each resolved field tracks which tier provided it.
 *
 * Follows the same caching pattern as LlmConfigResolver (in-memory TTL cache,
 * cleanup interval, same constructor options).
 */

import { INTERVALS } from '@tzurot/common-types/constants/timing';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import {
  ConfigOverridesSchema,
  HARDCODED_CONFIG_DEFAULTS,
  type ConfigOverrides,
  type ConfigOverrideSource,
  type ResolvedConfigOverrides,
} from '@tzurot/common-types/schemas/api/configOverrides';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { TTLCache } from '@tzurot/common-types/utils/TTLCache';

const logger = createLogger('ConfigCascadeResolver');

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
  private readonly cache: TTLCache<ResolvedConfigOverrides>;

  constructor(
    prisma: PrismaClient,
    options?: {
      cacheTtlMs?: number;
      enableCleanup?: boolean;
      /** Test-only: inject a clock function for fake-timer compatibility with TTLCache. */
      now?: () => number;
    }
  ) {
    this.prisma = prisma;
    this.cache = new TTLCache<ResolvedConfigOverrides>({
      ttl: options?.cacheTtlMs ?? INTERVALS.API_KEY_CACHE_TTL,
      now: options?.now,
    });
    // `enableCleanup` is preserved on the options shape for backwards compatibility
    // with callers that previously toggled the manual cleanup interval. TTLCache
    // bounds memory via LRU and expires on access; the option is now a no-op.
    void options?.enableCleanup;
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

    // Check cache (TTLCache returns null on miss; expiry is enforced internally)
    const cached = this.cache.get(cacheKey);
    if (cached !== null) {
      logger.debug(
        { userId, personalityId, channelId, source: 'cache' },
        'Config overrides resolved from cache'
      );
      return cached;
    }

    // Load tiers from DB
    const tiers = await this.loadTiers(userId, personalityId, channelId);

    // Deep-merge tiers (higher index = higher priority)
    const result = this.mergeTiers(tiers);

    // Cache result
    this.cache.set(cacheKey, result);

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
    // Tier 1: admin → Tier 2: personality → Tier 3: channel → Tier 4: user-default → Tier 5: user-personality
    return [...adminTiers, ...personalityTiers, ...channelTiers, ...userTiers];
  }

  /** Load admin tier (Tier 1: singleton admin settings) */
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

  /** Load personality tier (Tier 2) */
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

  /** Load channel tier (Tier 3: channel-level overrides set by moderators) */
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

  /** Load user-default (Tier 4) and user-personality (Tier 5) tiers in a single query */
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

      // Tier 4: User defaults
      this.pushIfValid(tiers, user.configDefaults, 'user-default');

      // Tier 5: User-personality overrides
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
      showModelFooter: values.showModelFooter as boolean,
      voiceResponseMode: values.voiceResponseMode as 'always' | 'voice-only' | 'never',
      voiceTranscriptionEnabled: values.voiceTranscriptionEnabled as boolean,
      sources,
    };
  }

  /** Invalidate cache for a specific user */
  invalidateUserCache(userId: string): void {
    this.cache.invalidateByPrefix(`${userId}|`);
    logger.debug({ userId }, 'Invalidated config cascade cache for user');
  }

  /** Invalidate cache for a specific personality */
  invalidatePersonalityCache(personalityId: string): void {
    // Cache key format: userId|personalityId|channelId — personality is at position 1.
    // Prefix-match doesn't fit; iterate keys directly.
    // Snapshot before delete — lru-cache's generator iterator can compact
    // mid-iteration.
    const snapshot = [...this.cache.keys()];
    for (const key of snapshot) {
      const parts = key.split('|');
      if (parts[1] === personalityId) {
        this.cache.delete(key);
      }
    }
    logger.debug({ personalityId }, 'Invalidated config cascade cache for personality');
  }

  /** Invalidate cache for a specific channel */
  invalidateChannelCache(channelId: string): void {
    // Cache key format: userId|personalityId|channelId — channel is at position 2.
    // Suffix-match doesn't fit invalidateByPrefix; iterate keys directly.
    // Snapshot before delete — same reason as invalidatePersonalityCache above.
    const snapshot = [...this.cache.keys()];
    for (const key of snapshot) {
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

  /**
   * No-op preserved for backwards compatibility with callers that managed the
   * old manual cleanup interval. TTLCache handles its own lifecycle, so there
   * is nothing to stop. Safe to remove once no callers reference it.
   */
  stopCleanup(): void {
    // intentionally empty
  }
}
