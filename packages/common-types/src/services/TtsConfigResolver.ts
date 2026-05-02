/**
 * TTS Config Resolver Service
 *
 * Resolves the effective TTS configuration for a user+personality combination.
 *
 * Resolution hierarchy (first match wins):
 *   1. User per-personality override (UserPersonalityConfig.ttsConfigId)
 *   2. User global default (User.defaultTtsConfigId)
 *   3. Personality default (PersonalityDefaultTtsConfig — separate join table)
 *   4. System free default (TtsConfig WHERE isFreeDefault = true)
 *   5. Hardcoded fallback (self-hosted/Kyutai)
 *
 * The cascade waterfall (tiers 1-2) and cache lifecycle live in
 * `BaseConfigResolver`. This subclass owns the TTS-specific Prisma queries
 * and the tier 3-5 fallback logic inside `extractFromPersonality`.
 *
 * Sister concern: `LlmConfigResolver` for LLM model selection.
 */

import {
  BaseConfigResolver,
  type BaseConfigResolverOptions,
  type ConfigOverrideEntry,
  type UserWithDefault,
} from './BaseConfigResolver.js';
import {
  TTS_CONFIG_SELECT_WITH_NAME,
  mapTtsConfigFromDbWithName,
  type MappedTtsConfigWithName,
} from './TtsConfigMapper.js';
import type { PrismaClient } from './prisma.js';
import type { ResolvedTtsConfig } from './tts/TtsProvider.js';

/** Sentinel cache key for the free-default lookup (no userId/personalityId axis). */
const FREE_DEFAULT_CACHE_KEY = '__free_default__';

/**
 * Hardcoded fallback when no DB config is available at any tier.
 * Self-hosted Kyutai is the universal floor — always works (assuming the
 * voice-engine service is reachable).
 */
const HARDCODED_FALLBACK: ResolvedTtsConfig = {
  provider: 'self-hosted',
  modelId: null,
  advancedParameters: {},
  source: 'hardcoded',
};

/**
 * Lightweight wrapper passed as the `personalityConfig` argument to
 * `resolveConfig`. Carries just the personalityId — the resolver queries
 * PersonalityDefaultTtsConfig + the system free default itself when extract
 * is invoked. Mirrors the LLM pattern's `LoadedPersonality` in shape, sized
 * to TTS's narrower data needs.
 */
export interface LoadedTtsPersonality {
  id: string;
}

/**
 * TTS Config Resolver — resolves user-specific config overrides.
 */
export class TtsConfigResolver extends BaseConfigResolver<
  LoadedTtsPersonality,
  MappedTtsConfigWithName,
  ResolvedTtsConfig
> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient, options?: BaseConfigResolverOptions) {
    super('TtsConfigResolver', options);
    this.prisma = prisma;
  }

  /**
   * Look up user by Discord ID with their global default TtsConfig joined.
   */
  protected async findUserWithDefault(
    discordId: string
  ): Promise<UserWithDefault<MappedTtsConfigWithName> | null> {
    const user = await this.prisma.user.findFirst({
      where: { discordId },
      select: {
        id: true,
        defaultTtsConfigId: true,
        defaultTtsConfig: { select: TTS_CONFIG_SELECT_WITH_NAME },
      },
    });

    if (user === null) {
      return null;
    }

    if (user.defaultTtsConfig) {
      const mapped = mapTtsConfigFromDbWithName(user.defaultTtsConfig);
      return {
        internalId: user.id,
        defaultOverride: { override: mapped, name: mapped.name },
      };
    }

    return { internalId: user.id, defaultOverride: null };
  }

  /**
   * Look up the user's per-personality TtsConfig override row.
   */
  protected async findPerPersonalityOverride(
    userInternalId: string,
    personalityId: string
  ): Promise<ConfigOverrideEntry<MappedTtsConfigWithName> | null> {
    const personalityOverride = await this.prisma.userPersonalityConfig.findFirst({
      where: { userId: userInternalId, personalityId, ttsConfigId: { not: null } },
      select: { ttsConfig: { select: TTS_CONFIG_SELECT_WITH_NAME } },
    });

    if (!personalityOverride?.ttsConfig) {
      return null;
    }

    const mapped = mapTtsConfigFromDbWithName(personalityOverride.ttsConfig);
    return { override: mapped, name: mapped.name };
  }

  /**
   * Tier 3 (PersonalityDefaultTtsConfig) and tier 4 (free default) fallback.
   *
   * Async because both tiers require Prisma queries — the LLM pattern of
   * pre-loading defaults into LoadedPersonality doesn't apply here since
   * Personality rows don't carry TTS defaults inline. The base class allows
   * `extractFromPersonality` to return `Promise<TResolved>` precisely for
   * this case.
   *
   * Returns the hardcoded fallback only when ALL tiers fail (no personality
   * default, no free default in DB). The `source` field tracks which tier
   * produced the result.
   */
  protected async extractFromPersonality(
    personality: LoadedTtsPersonality
  ): Promise<ResolvedTtsConfig> {
    // Tier 3: PersonalityDefaultTtsConfig
    try {
      const personalityDefault = await this.prisma.personalityDefaultTtsConfig.findUnique({
        where: { personalityId: personality.id },
        select: { ttsConfig: { select: TTS_CONFIG_SELECT_WITH_NAME } },
      });
      if (personalityDefault?.ttsConfig) {
        const mapped = mapTtsConfigFromDbWithName(personalityDefault.ttsConfig);
        return {
          provider: mapped.provider,
          modelId: mapped.modelId,
          advancedParameters: mapped.advancedParameters,
          source: 'personality',
          configName: mapped.name,
        };
      }
    } catch (error) {
      this.logger.warn(
        { err: error, personalityId: personality.id },
        'Failed to load PersonalityDefaultTtsConfig — falling through to free default'
      );
    }

    // Tier 4: system free default
    const freeDefault = await this.getFreeDefaultConfig();
    if (freeDefault !== null) {
      return freeDefault;
    }

    // Tier 5: hardcoded fallback
    this.logger.warn(
      { personalityId: personality.id },
      'No PersonalityDefaultTtsConfig, no free default in DB — using hardcoded self-hosted fallback'
    );
    return HARDCODED_FALLBACK;
  }

  /**
   * Merge override config into personality defaults.
   *
   * For TTS, the override REPLACES the personality default — there's no
   * field-level merge like LLM has (LLM merges sampling params from override
   * onto personality fallbacks). TTS's per-config dimensions are
   * provider+modelId which are atomic; advancedParameters is the only
   * dimension where merge could conceptually apply, but we treat it as
   * atomic too for predictability (an override config carries its OWN
   * complete advancedParameters or none).
   *
   * `tier` is the cascade tier the base waterfall is currently resolving
   * (either 'user-personality' or 'user-default'). It's baked into the inner
   * `ResolvedTtsConfig.source` so callers reading the inner field get the
   * same answer as the outer `ConfigResolutionResult.source` — closes the
   * mismatch claude-review flagged on PR #958.
   */
  protected mergeWithPersonality(
    _personality: LoadedTtsPersonality,
    override: MappedTtsConfigWithName,
    tier: 'user-personality' | 'user-default'
  ): ResolvedTtsConfig {
    return {
      provider: override.provider,
      modelId: override.modelId,
      advancedParameters: override.advancedParameters,
      source: tier,
      configName: override.name,
    };
  }

  /**
   * Get the system free default TtsConfig (the row with isFreeDefault=true).
   *
   * Cached separately from per-user resolution under FREE_DEFAULT_CACHE_KEY.
   * Returns null if no DB row has the flag set; callers fall through to the
   * hardcoded fallback in that case.
   */
  async getFreeDefaultConfig(): Promise<ResolvedTtsConfig | null> {
    const cached = this.cache.get(FREE_DEFAULT_CACHE_KEY);
    if (cached !== null) {
      this.logger.debug({ source: 'cache' }, 'Free default TTS config resolved from cache');
      return cached.config;
    }

    try {
      const freeConfig = await this.prisma.ttsConfig.findFirst({
        where: { isFreeDefault: true },
        select: TTS_CONFIG_SELECT_WITH_NAME,
      });

      if (freeConfig === null) {
        this.logger.debug('No free default TTS config found in database');
        return null;
      }

      const mapped = mapTtsConfigFromDbWithName(freeConfig);
      const config: ResolvedTtsConfig = {
        provider: mapped.provider,
        modelId: mapped.modelId,
        advancedParameters: mapped.advancedParameters,
        source: 'free-default',
        configName: mapped.name,
      };

      // Outer wrapper source: 'personality' is the closest valid value in the
      // base's `ConfigResolutionSource` union (which is 3-tier: 'user-personality'
      // | 'user-default' | 'personality'). The inner `config.source` carries the
      // precise tier ('free-default' here). Anyone inspecting the cache entry
      // directly should read `config.source`, not the wrapper.
      this.cache.set(FREE_DEFAULT_CACHE_KEY, {
        config,
        source: 'personality',
        configName: mapped.name,
      });

      this.logger.info(
        { configName: mapped.name, provider: config.provider, modelId: config.modelId },
        'Free default TTS config loaded from database'
      );
      return config;
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to get free default TTS config');
      return null;
    }
  }
}
