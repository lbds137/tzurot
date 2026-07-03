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

import { INTERVALS } from '@tzurot/common-types/constants/timing';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { TTLCache } from '@tzurot/common-types/utils/TTLCache';

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

/** Constructor options shared across all resolver subclasses. */
export interface BaseConfigResolverOptions {
  /**
   * TTL for cache entries in milliseconds. Defaults to API_KEY_CACHE_TTL.
   * NOTE: passing 0 does NOT disable the cache — lru-cache treats `ttl: 0` as
   * "no TTL" (never expire). Use 1ms to effectively disable caching in tests.
   */
  cacheTtlMs?: number;
  /**
   * Test-only: inject a clock function for fake-timer compatibility with
   * TTLCache. lru-cache's default `performance.now()` is NOT mocked by
   * `vi.useFakeTimers`; passing `() => Date.now()` makes TTL respect them.
   * @internal
   */
  now?: () => number;
}

/**
 * Abstract base class for configuration resolvers
 */
export abstract class BaseConfigResolver<T> {
  protected prisma: PrismaClient;
  protected readonly cache: TTLCache<ResolutionResult<T>>;

  /**
   * Name of this resolver for logging purposes
   */
  protected abstract readonly resolverName: string;

  constructor(prisma: PrismaClient, options?: BaseConfigResolverOptions) {
    this.prisma = prisma;
    this.cache = new TTLCache<ResolutionResult<T>>({
      ttl: options?.cacheTtlMs ?? INTERVALS.API_KEY_CACHE_TTL,
      // Persona/config resolution is on the memory-retrieval hot path and fans
      // out per-(user, context); 1000 small entries bounds memory firmly while
      // tolerating busy multi-user channels. Replaces an unbounded Map whose
      // periodic setInterval sweep was a documented horizontal-scaling blocker.
      maxSize: 1000,
      now: options?.now,
    });
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

    // Check cache (TTLCache returns null on miss; expiry is enforced internally).
    const cacheKey = this.getCacheKey(userId, contextId);
    const cached = this.cache.get(cacheKey);
    if (cached !== null) {
      logger.debug(
        { resolver: this.resolverName, userId, contextId, source: 'cache' },
        'Config resolved from cache'
      );
      return cached;
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
    this.cache.set(key, result);
  }

  /**
   * Invalidate cache for a user
   * Call when user updates their configuration
   */
  invalidateUserCache(userId: string): void {
    // Cache keys are `${userId}:${contextId}` — the trailing colon prevents a
    // prefix collision (user "12" doesn't match "123:").
    this.cache.invalidateByPrefix(`${userId}:`);
    logger.debug({ resolver: this.resolverName, userId }, 'Invalidated cache for user');
  }

  /**
   * Clear all cache entries
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug({ resolver: this.resolverName }, 'Cleared all cache');
  }
}
