/**
 * LLM Config Resolver Service
 *
 * Resolves the effective LLM configuration for a user+personality combination.
 *
 * Resolution hierarchy (first match wins):
 * 1. User per-personality override (UserPersonalityConfig.llmConfigId)
 * 2. User global default (User.defaultLlmConfigId)
 * 3. Personality default (already baked into LoadedPersonality)
 * 4. System global default (already handled as fallback in LoadedPersonality)
 *
 * This service only handles levels 1 and 2 — levels 3 and 4 are already in the personality.
 *
 * The cascade waterfall structure + cache lifecycle live in `BaseConfigResolver`.
 * This subclass provides LLM-specific Prisma queries, field extraction/merging,
 * and the LLM-specific `getFreeDefaultConfig` lookup.
 */

import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { LLM_CONFIG_OVERRIDE_KEYS } from '@tzurot/common-types/schemas/llmAdvancedParams';
import {
  LLM_CONFIG_SELECT_WITH_NAME,
  mapLlmConfigFromDbWithName,
  type MappedLlmConfigWithName,
} from '@tzurot/common-types/services/LlmConfigMapper';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type ResolvedLlmConfig } from '@tzurot/common-types/types/configResolution';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import {
  BaseConfigResolver,
  type BaseConfigResolverOptions,
  type ConfigOverrideEntry,
  type UserWithDefault,
} from './BaseConfigResolver.js';

/** Sentinel cache key for the free-default lookup (no userId/personalityId axis). */
const FREE_DEFAULT_CACHE_KEY = '__free_default__';

/** Sentinel cache key for the global-default lookup (no userId/personalityId axis). */
const GLOBAL_DEFAULT_CACHE_KEY = '__global_default__';

/**
 * LLM Config Resolver — resolves user-specific config overrides.
 */
export class LlmConfigResolver extends BaseConfigResolver<
  LoadedPersonality,
  MappedLlmConfigWithName,
  ResolvedLlmConfig
> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient, options?: BaseConfigResolverOptions) {
    super('LlmConfigResolver', options);
    this.prisma = prisma;
  }

  /**
   * Look up user by Discord ID with their global default LlmConfig joined.
   * Single Prisma query keeps the cascade fast.
   */
  protected async findUserWithDefault(
    discordId: string
  ): Promise<UserWithDefault<MappedLlmConfigWithName> | null> {
    const user = await this.prisma.user.findFirst({
      where: { discordId },
      select: {
        id: true,
        defaultLlmConfigId: true,
        defaultLlmConfig: { select: LLM_CONFIG_SELECT_WITH_NAME },
      },
    });

    if (user === null) {
      return null;
    }

    if (user.defaultLlmConfig) {
      const mapped = mapLlmConfigFromDbWithName(user.defaultLlmConfig);
      return {
        internalId: user.id,
        defaultOverride: { override: mapped, name: mapped.name },
      };
    }

    return { internalId: user.id, defaultOverride: null };
  }

  /**
   * Look up the user's per-personality LlmConfig override row.
   */
  protected async findPerPersonalityOverride(
    userInternalId: string,
    personalityId: string
  ): Promise<ConfigOverrideEntry<MappedLlmConfigWithName> | null> {
    const personalityOverride = await this.prisma.userPersonalityConfig.findFirst({
      where: { userId: userInternalId, personalityId, llmConfigId: { not: null } },
      select: { llmConfig: { select: LLM_CONFIG_SELECT_WITH_NAME } },
    });

    if (!personalityOverride?.llmConfig) {
      return null;
    }

    const mapped = mapLlmConfigFromDbWithName(personalityOverride.llmConfig);
    return { override: mapped, name: mapped.name };
  }

  /**
   * Extract config values from a LoadedPersonality.
   * Used when no user override exists — returns all params from personality.
   *
   * Synchronous work wrapped in a Promise to satisfy the always-async base
   * contract (no DB I/O — defaults are pre-loaded into LoadedPersonality).
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- async to satisfy the always-async BaseConfigResolver contract; LLM defaults are pre-loaded in LoadedPersonality, no DB I/O needed
  protected async extractFromPersonality(
    personality: LoadedPersonality
  ): Promise<ResolvedLlmConfig> {
    // Start with required field
    const result = { model: personality.model } as ResolvedLlmConfig;

    // Copy all config keys from personality
    for (const key of LLM_CONFIG_OVERRIDE_KEYS) {
      const value = personality[key];
      if (value !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- Dynamic key assignment from LLM_CONFIG_OVERRIDE_KEYS requires runtime indexing
        (result as any)[key] = value;
      }
    }

    return result;
  }

  /**
   * Merge override config into personality defaults.
   * Override values take precedence; personality values are fallbacks.
   *
   * `_tier` is unused here — `ResolvedLlmConfig` has no inner `source` field
   * (the cascade tier is exposed via the outer `ConfigResolutionResult.source`
   * the base wraps around the merged config). Required by the abstract
   * signature so TtsConfigResolver and any future subclasses with inner
   * source can use it.
   */
  protected mergeWithPersonality(
    personality: LoadedPersonality,
    override: MappedLlmConfigWithName,
    _tier: 'user-personality' | 'user-default'
  ): ResolvedLlmConfig {
    // Start with required field (model is always from override)
    const result = { model: override.model } as ResolvedLlmConfig;

    // For each config key, use override if defined, else personality
    for (const key of LLM_CONFIG_OVERRIDE_KEYS) {
      const overrideValue = override[key];
      const personalityValue = personality[key];
      const value = overrideValue ?? personalityValue;
      if (value !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- Dynamic key assignment from LLM_CONFIG_OVERRIDE_KEYS requires runtime indexing
        (result as any)[key] = value;
      }
    }

    return result;
  }

  /**
   * Get the default free config for guest mode users (the admin-set
   * `freeDefaultLlmConfig` pointer). Returns null if none set — caller uses
   * the hardcoded fallback.
   */
  async getFreeDefaultConfig(): Promise<ResolvedLlmConfig | null> {
    return this.getAdminDefaultConfig('freeDefaultLlmConfig', FREE_DEFAULT_CACHE_KEY, 'free');
  }

  /**
   * Get the global (paid-tier) default config (the admin-set
   * `globalDefaultLlmConfig` pointer). Used by the tier-aware quota fallback:
   * BYOK users retarget here when their configured preset is quota-blocked.
   * Returns null if none set.
   */
  async getGlobalDefaultConfig(): Promise<ResolvedLlmConfig | null> {
    return this.getAdminDefaultConfig('globalDefaultLlmConfig', GLOBAL_DEFAULT_CACHE_KEY, 'global');
  }

  /**
   * Shared reader for the two AdminSettings default pointers. Cached under a
   * sentinel key (no user/personality axis); a null pointer is NOT cached, so
   * an admin setting the pointer takes effect without an invalidation event.
   */
  private async getAdminDefaultConfig(
    pointer: 'freeDefaultLlmConfig' | 'globalDefaultLlmConfig',
    cacheKey: string,
    label: string
  ): Promise<ResolvedLlmConfig | null> {
    const cached = this.cache.get(cacheKey);
    if (cached !== null) {
      this.logger.debug({ source: 'cache', label }, 'Admin default config resolved from cache');
      return cached.config;
    }

    try {
      const settings = await this.prisma.adminSettings.findUnique({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        select: {
          freeDefaultLlmConfig: { select: LLM_CONFIG_SELECT_WITH_NAME },
          globalDefaultLlmConfig: { select: LLM_CONFIG_SELECT_WITH_NAME },
        },
      });
      const dbConfig =
        (pointer === 'freeDefaultLlmConfig'
          ? settings?.freeDefaultLlmConfig
          : settings?.globalDefaultLlmConfig) ?? null;

      if (dbConfig === null) {
        this.logger.debug({ pointer }, 'No default config pointer set in admin_settings');
        return null;
      }

      // Use shared mapper to convert from DB format to application format
      const mapped = mapLlmConfigFromDbWithName(dbConfig);

      // Create ResolvedLlmConfig with all params from the mapper
      // The mapper already returns undefined for missing values, matching ConvertedLlmParams
      const config: ResolvedLlmConfig = {
        model: mapped.model,
        // Provider tier — carried so a quota-fallback retarget can rewrite
        // the personality's provider coherently with the target model.
        provider: mapped.provider,
        // Basic sampling - directly from mapper (undefined if not set)
        temperature: mapped.temperature,
        topP: mapped.topP,
        topK: mapped.topK,
        frequencyPenalty: mapped.frequencyPenalty,
        presencePenalty: mapped.presencePenalty,
        repetitionPenalty: mapped.repetitionPenalty,
        // Advanced sampling
        minP: mapped.minP,
        topA: mapped.topA,
        seed: mapped.seed,
        // Output
        maxTokens: mapped.maxTokens,
        logitBias: mapped.logitBias,
        responseFormat: mapped.responseFormat,
        showThinking: mapped.showThinking,
        // Reasoning
        reasoning: mapped.reasoning,
        // OpenRouter
        transforms: mapped.transforms,
        route: mapped.route,
        verbosity: mapped.verbosity,
        // Context window (model-coupled, stays in LlmConfig)
        contextWindowTokens: mapped.contextWindowTokens,
        // Note: memoryScoreThreshold, memoryLimit, maxMessages, maxAge, maxImages
        // now come from ConfigOverrides cascade, not LlmConfig presets.
      };

      // Cache the result
      this.cache.set(cacheKey, {
        config,
        source: 'personality',
        configName: mapped.name,
      });

      this.logger.info(
        { configName: mapped.name, model: config.model, label },
        'Admin default config loaded from database'
      );
      return config;
    } catch (error) {
      this.logger.error({ err: error, pointer }, 'Failed to get admin default config');
      return null;
    }
  }
}
