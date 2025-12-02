/**
 * BaseConfigResolver - Abstract base class for cascading configuration resolution
 *
 * ## Cascading Configuration Pattern
 *
 * This pattern provides a standardized way to resolve user-specific configuration
 * overrides with a priority hierarchy:
 *
 * 1. **Context Override** (highest priority)
 *    - Per-personality settings stored in UserPersonalityConfig
 *    - Most specific to the current interaction context
 *
 * 2. **User Default**
 *    - User's global default stored directly on User model
 *    - Applies across all contexts unless overridden
 *
 * 3. **System Default** (lowest priority)
 *    - Global fallback configuration
 *    - Used when user has no specific settings
 *
 * ## Resolution Strategies
 *
 * Two semantic modes are supported:
 *
 * - **Merge Strategy** (LLM Config): Override values are merged with defaults.
 *   Individual fields from the override replace corresponding default values.
 *
 * - **Switch Strategy** (Persona): The entire configuration object is replaced.
 *   No field-level merging occurs.
 *
 * ## Caching
 *
 * All resolvers implement in-memory caching with TTL to reduce database queries.
 * Cache keys are formatted as `userId:contextId` for context-specific resolution.
 *
 * ## Usage
 *
 * ```typescript
 * class MyConfigResolver extends BaseConfigResolver<MyConfig> {
 *   protected async resolveFresh(userId: string, contextId?: string): Promise<ResolutionResult<MyConfig>> {
 *     // Implement resolution logic
 *   }
 *
 *   protected getSystemDefault(): MyConfig {
 *     // Return fallback configuration
 *   }
 * }
 * ```
 *
 * @see LlmConfigResolver - Merge strategy implementation
 * @see PersonaResolver - Switch strategy implementation
 */

import { createLogger, INTERVALS, type PrismaClient } from '@tzurot/common-types';

const logger = createLogger('BaseConfigResolver');

/**
 * Resolution result with source tracking for debugging
 */
export interface ResolutionResult<T> {
  /** The resolved configuration */
  config: T;
  /** Source of the resolution */
  source: 'context-override' | 'user-default' | 'system-default';
  /** Name/ID of the source configuration (for logging) */
  sourceName?: string;
}

/**
 * Cache entry with TTL
 */
interface CacheEntry<T> {
  result: ResolutionResult<T>;
  expiresAt: number;
}

/**
 * Abstract base class for configuration resolvers
 */
export abstract class BaseConfigResolver<T> {
  protected prisma: PrismaClient;
  protected cache = new Map<string, CacheEntry<T>>();
  protected readonly cacheTtlMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Name of this resolver for logging purposes
   */
  protected abstract readonly resolverName: string;

  constructor(prisma: PrismaClient, options?: { cacheTtlMs?: number; enableCleanup?: boolean }) {
    this.prisma = prisma;
    this.cacheTtlMs = options?.cacheTtlMs ?? INTERVALS.API_KEY_CACHE_TTL;

    // Start periodic cleanup of expired cache entries
    if (options?.enableCleanup !== false) {
      this.startCleanupInterval();
    }
  }

  /**
   * Resolve configuration for a user and optional context
   *
   * @param userId - Discord user ID (or undefined for anonymous)
   * @param contextId - Optional context identifier (e.g., personalityId)
   * @returns Resolution result with config and source info
   */
  async resolve(userId: string | undefined, contextId?: string): Promise<ResolutionResult<T>> {
    // Anonymous users get system default
    if (userId === undefined || userId.length === 0) {
      return {
        config: this.getSystemDefault(),
        source: 'system-default',
      };
    }

    // Check cache
    const cacheKey = this.getCacheKey(userId, contextId);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug(
        { resolver: this.resolverName, userId, contextId, source: 'cache' },
        'Config resolved from cache'
      );
      return cached.result;
    }

    try {
      // Perform fresh resolution
      const result = await this.resolveFresh(userId, contextId);

      // Cache the result
      this.cacheResult(cacheKey, result);

      logger.debug(
        {
          resolver: this.resolverName,
          userId,
          contextId,
          source: result.source,
          sourceName: result.sourceName,
        },
        'Config resolved'
      );

      return result;
    } catch (error) {
      logger.error(
        { err: error, resolver: this.resolverName, userId, contextId },
        'Failed to resolve config, using system default'
      );
      return {
        config: this.getSystemDefault(),
        source: 'system-default',
      };
    }
  }

  /**
   * Implement resolution logic in subclasses
   *
   * Resolution order:
   * 1. Check context-specific override (if contextId provided)
   * 2. Check user default
   * 3. Return system default
   */
  protected abstract resolveFresh(userId: string, contextId?: string): Promise<ResolutionResult<T>>;

  /**
   * Get the system default configuration
   * Used as fallback when no user-specific config exists
   */
  protected abstract getSystemDefault(): T;

  /**
   * Generate cache key for a resolution request
   */
  protected getCacheKey(userId: string, contextId?: string): string {
    return contextId !== undefined && contextId !== ''
      ? `${userId}:${contextId}`
      : `${userId}:__default__`;
  }

  /**
   * Cache a resolution result
   */
  protected cacheResult(key: string, result: ResolutionResult<T>): void {
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  /**
   * Invalidate cache for a user
   * Call when user updates their configuration
   */
  invalidateUserCache(userId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.cache.delete(key);
      }
    }
    logger.debug({ resolver: this.resolverName, userId }, 'Invalidated cache for user');
  }

  /**
   * Clear all cache entries
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug({ resolver: this.resolverName }, 'Cleared all cache');
  }

  /**
   * Stop cleanup interval (call on shutdown)
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
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
   * Remove expired entries from cache
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
        { resolver: this.resolverName, removedCount, remaining: this.cache.size },
        'Cleaned up expired cache entries'
      );
    }
  }
}
