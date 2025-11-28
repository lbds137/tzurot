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
  type PrismaClient,
  type LoadedPersonality,
} from '@tzurot/common-types';

const logger = createLogger('LlmConfigResolver');

/**
 * Resolved LLM config values that can override personality defaults
 */
export interface ResolvedLlmConfig {
  model: string;
  visionModel?: string | null;
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  frequencyPenalty?: number | null;
  presencePenalty?: number | null;
  maxTokens?: number | null;
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
          defaultLlmConfig: {
            select: {
              name: true,
              model: true,
              visionModel: true,
              temperature: true,
              topP: true,
              topK: true,
              frequencyPenalty: true,
              presencePenalty: true,
              maxTokens: true,
              memoryScoreThreshold: true,
              memoryLimit: true,
              contextWindowTokens: true,
            },
          },
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
        where: {
          userId: user.id,
          personalityId,
          llmConfigId: { not: null },
        },
        select: {
          llmConfig: {
            select: {
              name: true,
              model: true,
              visionModel: true,
              temperature: true,
              topP: true,
              topK: true,
              frequencyPenalty: true,
              presencePenalty: true,
              maxTokens: true,
              memoryScoreThreshold: true,
              memoryLimit: true,
              contextWindowTokens: true,
            },
          },
        },
      });

      if (personalityOverride?.llmConfig) {
        const result: ConfigResolutionResult = {
          config: this.mergeConfig(personalityConfig, personalityOverride.llmConfig),
          source: 'user-personality',
          configName: personalityOverride.llmConfig.name,
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
        const result: ConfigResolutionResult = {
          config: this.mergeConfig(personalityConfig, user.defaultLlmConfig),
          source: 'user-default',
          configName: user.defaultLlmConfig.name,
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
      maxTokens: personality.maxTokens,
      memoryScoreThreshold: personality.memoryScoreThreshold,
      memoryLimit: personality.memoryLimit,
      contextWindowTokens: personality.contextWindowTokens,
    };
  }

  /**
   * Merge override config into personality defaults
   * Only non-null values from override replace personality values
   */
  private mergeConfig(
    personality: LoadedPersonality,
    override: {
      model: string;
      visionModel?: string | null;
      temperature?: unknown;
      topP?: unknown;
      topK?: number | null;
      frequencyPenalty?: unknown;
      presencePenalty?: unknown;
      maxTokens?: number | null;
      memoryScoreThreshold?: unknown;
      memoryLimit?: number | null;
      contextWindowTokens?: number;
    }
  ): ResolvedLlmConfig {
    return {
      // Model is always overridden (it's required)
      model: override.model,
      // Vision model: use override if provided, else personality default
      visionModel: override.visionModel ?? personality.visionModel,
      // Numeric values: use override if not null, else personality default
      temperature: this.toNumber(override.temperature) ?? personality.temperature,
      topP: this.toNumber(override.topP) ?? personality.topP,
      topK: override.topK ?? personality.topK,
      frequencyPenalty: this.toNumber(override.frequencyPenalty) ?? personality.frequencyPenalty,
      presencePenalty: this.toNumber(override.presencePenalty) ?? personality.presencePenalty,
      maxTokens: override.maxTokens ?? personality.maxTokens,
      memoryScoreThreshold:
        this.toNumber(override.memoryScoreThreshold) ?? personality.memoryScoreThreshold,
      memoryLimit: override.memoryLimit ?? personality.memoryLimit,
      contextWindowTokens: override.contextWindowTokens ?? personality.contextWindowTokens,
    };
  }

  /**
   * Convert Prisma Decimal to number with type safety
   *
   * Handles Prisma's Decimal type which has a toNumber() method.
   * Validates the result is actually a number to catch any future
   * changes in Prisma's internal implementation.
   */
  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'number') {
      return value;
    }
    // Handle Prisma Decimal (has toNumber method)
    if (
      typeof value === 'object' &&
      value !== null &&
      'toNumber' in value &&
      typeof (value as Record<string, unknown>).toNumber === 'function'
    ) {
      const result = (value as { toNumber: () => unknown }).toNumber();
      if (typeof result === 'number') {
        return result;
      }
      logger.warn({ valueType: typeof result }, 'Prisma Decimal.toNumber() returned non-number');
      return null;
    }
    logger.warn({ valueType: typeof value }, 'Unexpected value type in toNumber');
    return null;
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
}
