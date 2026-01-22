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
 * This service only handles levels 1 and 2 - levels 3 and 4 are already in the personality.
 */

import {
  createLogger,
  INTERVALS,
  LLM_CONFIG_SELECT_WITH_NAME,
  mapLlmConfigFromDbWithName,
  type PrismaClient,
  type LoadedPersonality,
  type MappedLlmConfigWithName,
  type ConvertedLlmParams,
} from '@tzurot/common-types';

const logger = createLogger('LlmConfigResolver');

/**
 * Resolved LLM config values that can override personality defaults.
 *
 * Extends ConvertedLlmParams to include ALL parameters from advancedParameters JSONB,
 * plus database-specific fields (memory, context window).
 */
export interface ResolvedLlmConfig extends ConvertedLlmParams {
  model: string;
  visionModel?: string | null;
  memoryScoreThreshold?: number | null;
  memoryLimit?: number | null;
  contextWindowTokens?: number;
}

/**
 * Result of config resolution
 */
export interface ConfigResolutionResult {
  /** The resolved config (merged with personality defaults) */
  config: ResolvedLlmConfig;
  /** Source of the override (or 'personality' if no override) */
  source: 'user-personality' | 'user-default' | 'personality';
  /** Name of the config used (if override) */
  configName?: string;
}

/**
 * Cache entry for config resolution
 */
interface CacheEntry {
  result: ConfigResolutionResult;
  expiresAt: number;
}

/**
 * LLM Config Resolver - resolves user-specific config overrides
 */
export class LlmConfigResolver {
  private prisma: PrismaClient;
  private cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(prisma: PrismaClient, options?: { cacheTtlMs?: number; enableCleanup?: boolean }) {
    this.prisma = prisma;
    this.cacheTtlMs = options?.cacheTtlMs ?? INTERVALS.API_KEY_CACHE_TTL;

    // Start periodic cleanup of expired cache entries (prevents memory leak)
    // Default enabled in production, can be disabled for testing
    if (options?.enableCleanup !== false) {
      this.startCleanupInterval();
    }
  }

  /**
   * Start periodic cleanup of expired cache entries
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredEntries();
    }, INTERVALS.CACHE_CLEANUP);

    // Ensure interval doesn't prevent process exit
    this.cleanupInterval.unref();
  }

  /**
   * Remove expired entries from the cache
   */
  private cleanupExpiredEntries(): void {
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
  }

  /**
   * Stop the cleanup interval (call on shutdown)
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Resolve the effective LLM config for a user and personality.
   *
   * @param userId - Discord user ID (or undefined for anonymous)
   * @param personalityId - The personality being used
   * @param personalityConfig - The personality's default config (already loaded)
   * @returns Resolved config with source information
   */
  async resolveConfig(
    userId: string | undefined,
    personalityId: string,
    personalityConfig: LoadedPersonality
  ): Promise<ConfigResolutionResult> {
    // If no userId, just return the personality default
    if (userId === undefined || userId.length === 0) {
      return {
        config: this.extractConfig(personalityConfig),
        source: 'personality',
      };
    }

    // Check cache
    const cacheKey = `${userId}-${personalityId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug({ userId, personalityId, source: 'cache' }, 'Config resolved from cache');
      return cached.result;
    }

    try {
      // Get the user's internal ID first
      const user = await this.prisma.user.findFirst({
        where: { discordId: userId },
        select: {
          id: true,
          defaultLlmConfigId: true,
          defaultLlmConfig: { select: LLM_CONFIG_SELECT_WITH_NAME },
        },
      });

      if (user === null) {
        // User doesn't exist in DB - use personality default
        const result: ConfigResolutionResult = {
          config: this.extractConfig(personalityConfig),
          source: 'personality',
        };
        this.cacheResult(cacheKey, result);
        return result;
      }

      // Priority 1: Check for per-personality override
      const personalityOverride = await this.prisma.userPersonalityConfig.findFirst({
        where: { userId: user.id, personalityId, llmConfigId: { not: null } },
        select: { llmConfig: { select: LLM_CONFIG_SELECT_WITH_NAME } },
      });

      if (personalityOverride?.llmConfig) {
        const mapped = mapLlmConfigFromDbWithName(personalityOverride.llmConfig);
        const result: ConfigResolutionResult = {
          config: this.mergeConfig(personalityConfig, mapped),
          source: 'user-personality',
          configName: mapped.name,
        };
        this.cacheResult(cacheKey, result);
        logger.debug(
          { userId, personalityId, configName: result.configName },
          'Config resolved from per-personality override'
        );
        return result;
      }

      // Priority 2: Check for user global default
      if (user.defaultLlmConfig) {
        const mapped = mapLlmConfigFromDbWithName(user.defaultLlmConfig);
        const result: ConfigResolutionResult = {
          config: this.mergeConfig(personalityConfig, mapped),
          source: 'user-default',
          configName: mapped.name,
        };
        this.cacheResult(cacheKey, result);
        logger.debug(
          { userId, personalityId, configName: result.configName },
          'Config resolved from user global default'
        );
        return result;
      }

      // No user override - use personality default
      const result: ConfigResolutionResult = {
        config: this.extractConfig(personalityConfig),
        source: 'personality',
      };
      this.cacheResult(cacheKey, result);
      logger.debug({ userId, personalityId }, 'Config resolved from personality default');
      return result;
    } catch (error) {
      logger.error(
        { err: error, userId, personalityId },
        'Failed to resolve config, using default'
      );
      return {
        config: this.extractConfig(personalityConfig),
        source: 'personality',
      };
    }
  }

  /**
   * Extract config values from a LoadedPersonality
   */
  private extractConfig(personality: LoadedPersonality): ResolvedLlmConfig {
    return {
      model: personality.model,
      visionModel: personality.visionModel,
      temperature: personality.temperature,
      topP: personality.topP,
      topK: personality.topK,
      frequencyPenalty: personality.frequencyPenalty,
      presencePenalty: personality.presencePenalty,
      repetitionPenalty: personality.repetitionPenalty,
      maxTokens: personality.maxTokens,
      memoryScoreThreshold: personality.memoryScoreThreshold,
      memoryLimit: personality.memoryLimit,
      contextWindowTokens: personality.contextWindowTokens,
    };
  }

  /**
   * Merge override config into personality defaults.
   * Uses pre-mapped config from LlmConfigMapper (already converted to camelCase).
   * Only non-null values from override replace personality values.
   */
  private mergeConfig(
    personality: LoadedPersonality,
    override: MappedLlmConfigWithName
  ): ResolvedLlmConfig {
    return {
      // Model is always overridden (it's required)
      model: override.model,
      // Vision model: use override if provided, else personality default
      visionModel: override.visionModel ?? personality.visionModel,

      // Basic sampling params
      temperature: override.temperature ?? personality.temperature,
      topP: override.topP ?? personality.topP,
      topK: override.topK ?? personality.topK,
      frequencyPenalty: override.frequencyPenalty ?? personality.frequencyPenalty,
      presencePenalty: override.presencePenalty ?? personality.presencePenalty,
      repetitionPenalty: override.repetitionPenalty ?? personality.repetitionPenalty,

      // Advanced sampling params (new)
      minP: override.minP,
      topA: override.topA,
      seed: override.seed,

      // Output params
      maxTokens: override.maxTokens ?? personality.maxTokens,
      stop: override.stop,
      logitBias: override.logitBias,
      responseFormat: override.responseFormat,
      showThinking: override.showThinking,

      // Reasoning params (new - for thinking models)
      reasoning: override.reasoning,

      // OpenRouter-specific params (new)
      transforms: override.transforms,
      route: override.route,
      verbosity: override.verbosity,

      // Non-JSONB fields (memory and context)
      memoryScoreThreshold: override.memoryScoreThreshold ?? personality.memoryScoreThreshold,
      memoryLimit: override.memoryLimit ?? personality.memoryLimit,
      contextWindowTokens: override.contextWindowTokens ?? personality.contextWindowTokens,
    };
  }

  /**
   * Cache a resolution result
   */
  private cacheResult(key: string, result: ConfigResolutionResult): void {
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  /**
   * Invalidate cache for a user (call when they update their config overrides)
   */
  invalidateUserCache(userId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${userId}-`)) {
        this.cache.delete(key);
      }
    }
    logger.debug({ userId }, 'Invalidated config cache for user');
  }

  /**
   * Clear all cache entries
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Cleared config cache');
  }

  /**
   * Get the default free config for guest mode users.
   *
   * Resolution order:
   * 1. Database config with isFreeDefault=true
   * 2. Returns null if none found (caller should use hardcoded fallback)
   *
   * @returns The free default config or null if none set
   */
  async getFreeDefaultConfig(): Promise<ResolvedLlmConfig | null> {
    // Check cache first
    const cacheKey = '__free_default__';
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug({ source: 'cache' }, 'Free default config resolved from cache');
      return cached.result.config;
    }

    try {
      const freeConfig = await this.prisma.llmConfig.findFirst({
        where: { isFreeDefault: true },
        select: LLM_CONFIG_SELECT_WITH_NAME,
      });

      if (freeConfig === null) {
        logger.debug('No free default config found in database');
        return null;
      }

      // Use shared mapper to convert from DB format to application format
      const mapped = mapLlmConfigFromDbWithName(freeConfig);

      // Create ResolvedLlmConfig with all params from the mapper
      // The mapper already returns undefined for missing values, matching ConvertedLlmParams
      const config: ResolvedLlmConfig = {
        model: mapped.model,
        visionModel: mapped.visionModel,
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
        stop: mapped.stop,
        logitBias: mapped.logitBias,
        responseFormat: mapped.responseFormat,
        showThinking: mapped.showThinking,
        // Reasoning
        reasoning: mapped.reasoning,
        // OpenRouter
        transforms: mapped.transforms,
        route: mapped.route,
        verbosity: mapped.verbosity,
        // Memory/context
        memoryScoreThreshold: mapped.memoryScoreThreshold,
        memoryLimit: mapped.memoryLimit,
        contextWindowTokens: mapped.contextWindowTokens,
      };

      // Cache the result
      this.cache.set(cacheKey, {
        result: { config, source: 'personality', configName: mapped.name },
        expiresAt: Date.now() + this.cacheTtlMs,
      });

      logger.info(
        { configName: mapped.name, model: config.model },
        'Free default config loaded from database'
      );
      return config;
    } catch (error) {
      logger.error({ err: error }, 'Failed to get free default config');
      return null;
    }
  }
}
