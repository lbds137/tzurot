/**
 * Vision Config Resolver Service
 *
 * Resolves the effective VISION model for a user+personality combination. Any
 * preset in `llm_configs` can occupy a vision slot (its `model` field IS the
 * vision model; the slot assignment is capability-gated at write time) —
 * so this resolver reuses the LLM mapper and walks a parallel cascade.
 *
 * Resolution hierarchy (first match wins):
 *   1. User per-personality override (UserPersonalityConfig.visionConfigId)
 *   2. User global default (User.defaultVisionConfigId)
 *   3. Personality vision default (PersonalityVisionDefaultConfig — separate join table)
 *   4. Global vision default (AdminSettings.globalDefaultVisionConfigId — the paid default)
 *   5. Hardcoded fallback (MODEL_DEFAULTS.VISION_FALLBACK)
 *
 * The cascade waterfall (tiers 1-2) and cache lifecycle live in `BaseConfigResolver`.
 * This subclass owns the vision-specific Prisma queries and the tier 3-5 fallback.
 *
 * Phase-1 scope: this resolves the PAID vision default for the no-override case. The
 * GUEST downgrade stays downstream (AuthStep + selectVisionModel → VISION_FALLBACK_FREE);
 * guest-aware DB resolution (consulting the free-default vision pointer) is deferred
 * alongside the vision editing surface.
 *
 * Sister concerns: `LlmConfigResolver` (text model) and `TtsConfigResolver` (this is
 * templated on TtsConfigResolver, the closest analogue — separate config rows + a
 * personality-default join table).
 */

import {
  BaseConfigResolver,
  type BaseConfigResolverOptions,
  type ConfigOverrideEntry,
  type UserWithDefault,
} from './BaseConfigResolver.js';
import { MODEL_DEFAULTS } from '@tzurot/common-types/constants/ai';
import { INTERVALS } from '@tzurot/common-types/constants/timing';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import {
  LLM_CONFIG_SELECT_WITH_NAME,
  mapLlmConfigFromDbWithName,
  type MappedLlmConfigWithName,
} from '@tzurot/common-types/services/LlmConfigMapper';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  type ResolvedVisionConfig,
  type LoadedVisionPersonality,
} from '@tzurot/common-types/types/configResolution';
import { pickVisionTierParams } from '@tzurot/common-types/types/schemas/personality';
import { TTLCache } from '@tzurot/common-types/utils/TTLCache';

/**
 * Hardcoded fallback when no DB vision config is available at any tier. The bootstrap
 * seeds a global vision default, so this is a true last resort (e.g. a fresh DB before
 * bootstrap runs). Frozen to prevent callers mutating the shared module constant.
 */
const HARDCODED_FALLBACK: ResolvedVisionConfig = Object.freeze({
  model: MODEL_DEFAULTS.VISION_FALLBACK,
  source: 'hardcoded',
});

/** Sentinel cache key for the global-default lookup (no userId/personalityId axis). */
const GLOBAL_DEFAULT_CACHE_KEY = '__vision_global_default__';

/** Sentinel cache key for the free-default lookup (no userId/personalityId axis). */
const FREE_DEFAULT_CACHE_KEY = '__vision_free_default__';

export class VisionConfigResolver extends BaseConfigResolver<
  LoadedVisionPersonality,
  MappedLlmConfigWithName,
  ResolvedVisionConfig
> {
  private prisma: PrismaClient;

  /**
   * Negative-result cache for the no-axis system defaults (global AND free vision
   * default). The positive cache (`this.cache`) can't store a null result (TTLCache
   * rejects null values), so without this every pre-seed call (no default row yet)
   * would re-query the DB. A truthy marker under GLOBAL_DEFAULT_CACHE_KEY /
   * FREE_DEFAULT_CACHE_KEY short-circuits those repeated misses for the same TTL
   * window the positive cache uses.
   */
  private readonly noDefaultCache: TTLCache<true>;

  constructor(prisma: PrismaClient, options?: BaseConfigResolverOptions) {
    super('VisionConfigResolver', options);
    this.prisma = prisma;
    this.noDefaultCache = new TTLCache<true>({
      // Same fallback as BaseConfigResolver's positive cache (API_KEY_CACHE_TTL),
      // so the negative sentinel and the positive entry expire on the same window
      // — neither can outlive the other and mask a state transition.
      ttl: options?.cacheTtlMs ?? INTERVALS.API_KEY_CACHE_TTL,
      now: options?.now,
    });
  }

  /** Tier 2: look up the user by Discord ID with their global default vision config joined. */
  protected async findUserWithDefault(
    discordId: string
  ): Promise<UserWithDefault<MappedLlmConfigWithName> | null> {
    const user = await this.prisma.user.findFirst({
      where: { discordId },
      select: {
        id: true,
        defaultVisionConfigId: true,
        defaultVisionConfig: { select: LLM_CONFIG_SELECT_WITH_NAME },
      },
    });

    if (user === null) {
      return null;
    }

    if (user.defaultVisionConfig) {
      const mapped = mapLlmConfigFromDbWithName(user.defaultVisionConfig);
      return { internalId: user.id, defaultOverride: { override: mapped, name: mapped.name } };
    }

    return { internalId: user.id, defaultOverride: null };
  }

  /** Tier 1: the user's per-personality vision override row. */
  protected async findPerPersonalityOverride(
    userInternalId: string,
    personalityId: string
  ): Promise<ConfigOverrideEntry<MappedLlmConfigWithName> | null> {
    const personalityOverride = await this.prisma.userPersonalityConfig.findFirst({
      where: { userId: userInternalId, personalityId, visionConfigId: { not: null } },
      select: { visionConfig: { select: LLM_CONFIG_SELECT_WITH_NAME } },
    });

    if (!personalityOverride?.visionConfig) {
      return null;
    }

    const mapped = mapLlmConfigFromDbWithName(personalityOverride.visionConfig);
    return { override: mapped, name: mapped.name };
  }

  /**
   * Tier 3 (PersonalityVisionDefaultConfig) → tier 4 (global vision default) → tier 5
   * (hardcoded). Async because all three require Prisma queries. The global-default
   * tier surfaces as source='personality' (the "system default" tier), mirroring how
   * the TEXT resolver surfaces its baked-in global default.
   */
  protected async extractFromPersonality(
    personality: LoadedVisionPersonality
  ): Promise<ResolvedVisionConfig> {
    // Tier 3: PersonalityVisionDefaultConfig
    try {
      const personalityDefault = await this.prisma.personalityVisionDefaultConfig.findUnique({
        where: { personalityId: personality.id },
        select: { llmConfig: { select: LLM_CONFIG_SELECT_WITH_NAME } },
      });
      if (personalityDefault?.llmConfig) {
        const mapped = mapLlmConfigFromDbWithName(personalityDefault.llmConfig);
        return {
          model: mapped.model,
          source: 'personality',
          configName: mapped.name,
          params: pickVisionTierParams(mapped),
        };
      }
    } catch (error) {
      // ERROR severity: a user-configured personality vision default couldn't be
      // loaded (Prisma connection issue, schema mismatch). Falling through to the
      // global default is correct runtime behavior but masks the cause — surface it.
      this.logger.error(
        { err: error, personalityId: personality.id },
        'Failed to load PersonalityVisionDefaultConfig — falling through to global default'
      );
    }

    // Tier 4: global vision default (the AdminSettings pointer).
    const globalDefault = await this.getGlobalDefaultConfig();
    if (globalDefault !== null) {
      return globalDefault;
    }

    // Tier 5: hardcoded fallback (fresh DB before bootstrap, or misconfiguration).
    this.logger.warn(
      { personalityId: personality.id },
      'No PersonalityVisionDefaultConfig, no global vision default in DB — using hardcoded fallback'
    );
    return { ...HARDCODED_FALLBACK };
  }

  /** Tiers 1-2: an override REPLACES (model + the row's explicit params — no field merge). */
  protected mergeWithPersonality(
    _personality: LoadedVisionPersonality,
    override: MappedLlmConfigWithName,
    tier: 'user-personality' | 'user-default'
  ): ResolvedVisionConfig {
    return {
      model: override.model,
      source: tier,
      configName: override.name,
      params: pickVisionTierParams(override),
    };
  }

  /** Surface the actual tier from extractFromPersonality to the outer wrapper. */
  protected getExtractSource(extracted: ResolvedVisionConfig): 'personality' | 'hardcoded' {
    return extracted.source === 'hardcoded' ? 'hardcoded' : 'personality';
  }

  /**
   * Clear both caches on invalidation. The base only clears the positive cache
   * (`this.cache`); the negative-default sentinels (global AND free) must be cleared
   * too. Otherwise a pub/sub invalidation fired right after an admin creates the first
   * global/free vision default would leave the stale "no default" marker in place, and
   * the new default would stay invisible until the sentinel's TTL naturally expired.
   */
  override clearCache(): void {
    super.clearCache();
    this.noDefaultCache.clear();
  }

  /**
   * Get the global vision default (the AdminSettings pointer). Cached
   * under the base's free-default sentinel slot — it's the no-axis system default for
   * the vision slot. Returns null if no such row exists (callers fall to hardcoded).
   */
  async getGlobalDefaultConfig(): Promise<ResolvedVisionConfig | null> {
    const cached = this.cache.get(GLOBAL_DEFAULT_CACHE_KEY);
    if (cached !== null) {
      return cached.config;
    }

    // Negative-cache hit: a recent query found no global default — skip the DB.
    if (this.noDefaultCache.has(GLOBAL_DEFAULT_CACHE_KEY)) {
      return null;
    }

    try {
      // Read the admin-set global vision default via the AdminSettings pointer
      // (singleton). The vision slot is capability-gated at write time, so any
      // pointed config is vision-eligible; a null pointer means no admin default —
      // fall through to the hardcoded floor. Replaces the old
      // per-kind flag query.
      const settings = await this.prisma.adminSettings.findUnique({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        select: { globalDefaultVisionConfig: { select: LLM_CONFIG_SELECT_WITH_NAME } },
      });
      const globalConfig = settings?.globalDefaultVisionConfig ?? null;

      if (globalConfig === null) {
        this.logger.debug('No global vision default pointer set in admin_settings');
        this.noDefaultCache.set(GLOBAL_DEFAULT_CACHE_KEY, true);
        return null;
      }

      const mapped = mapLlmConfigFromDbWithName(globalConfig);
      // source='personality' — the global vision default is the "system default" tier,
      // surfaced the same way the text resolver surfaces its baked-in global default.
      const config: ResolvedVisionConfig = {
        model: mapped.model,
        source: 'personality',
        configName: mapped.name,
        params: pickVisionTierParams(mapped),
      };
      this.cache.set(GLOBAL_DEFAULT_CACHE_KEY, {
        config,
        source: 'personality',
        configName: mapped.name,
      });
      this.logger.info(
        { configName: mapped.name, model: config.model },
        'Global vision default loaded from database'
      );
      return config;
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to get global vision default config');
      return null;
    }
  }

  /**
   * Get the free-tier vision default via the AdminSettings pointer
   * (`freeDefaultVisionConfigId`) — the vision analogue of
   * `LlmConfigResolver.getFreeDefaultConfig`. This is the admin-set free-tier
   * fallback the worker's vision path consults before the hardcoded
   * `VISION_FALLBACK_FREE` floor. Returns null if no pointer is set
   * (callers fall through to the hardcoded floor). `source` is 'personality' (the
   * "system default" tier), matching `getGlobalDefaultConfig`.
   */
  async getFreeDefaultVisionConfig(): Promise<ResolvedVisionConfig | null> {
    const cached = this.cache.get(FREE_DEFAULT_CACHE_KEY);
    if (cached !== null) {
      return cached.config;
    }

    // Negative-cache hit: a recent query found no free default — skip the DB.
    if (this.noDefaultCache.has(FREE_DEFAULT_CACHE_KEY)) {
      return null;
    }

    try {
      const settings = await this.prisma.adminSettings.findUnique({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        select: { freeDefaultVisionConfig: { select: LLM_CONFIG_SELECT_WITH_NAME } },
      });
      const freeConfig = settings?.freeDefaultVisionConfig ?? null;

      if (freeConfig === null) {
        this.logger.debug('No free vision default pointer set in admin_settings');
        this.noDefaultCache.set(FREE_DEFAULT_CACHE_KEY, true);
        return null;
      }

      const mapped = mapLlmConfigFromDbWithName(freeConfig);
      const config: ResolvedVisionConfig = {
        model: mapped.model,
        source: 'personality',
        configName: mapped.name,
        params: pickVisionTierParams(mapped),
      };
      this.cache.set(FREE_DEFAULT_CACHE_KEY, {
        config,
        source: 'personality',
        configName: mapped.name,
      });
      this.logger.info(
        { configName: mapped.name, model: config.model },
        'Free vision default loaded from database'
      );
      return config;
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to get free vision default config');
      return null;
    }
  }
}
