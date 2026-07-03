/**
 * BaseConfigResolver
 *
 * Abstract base for resolvers that select a typed config row through a
 * 3-tier cascade: user-personality override → user global default →
 * personality default. Used by `LlmConfigResolver` (LLM model selection)
 * and `TtsConfigResolver` (TTS provider/model selection).
 *
 * The base owns:
 *   - TTLCache lifecycle (delegates to `TTLCache` from common-types/utils)
 *   - The cascade waterfall structure
 *   - User-prefix invalidation
 *   - Error handling that falls back to personality default
 *
 * Subclasses provide:
 *   - `findUserWithDefault(discordId)` — user lookup + their global default
 *     in a single Prisma query (avoids extra round-trip)
 *   - `findPerPersonalityOverride(userId, personalityId)` — user's
 *     per-personality override row (returns null if none configured)
 *   - `extractFromPersonality(personality)` — produce resolved config from
 *     baked-in personality defaults
 *   - `mergeWithPersonality(personality, override)` — merge override row
 *     onto personality defaults (override takes precedence)
 *
 * Sister concern: this is for ROW-SELECTING cascades (one of N typed rows
 * wins). For JSONB FIELD-MERGING cascades (per-field tier merging),
 * see `ConfigCascadeResolver` — different shape, different responsibility.
 */

import { INTERVALS } from '@tzurot/common-types/constants/timing';
import {
  type ConfigResolutionSource,
  type BaseConfigResolutionResult,
} from '@tzurot/common-types/types/configResolution';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { TTLCache } from '@tzurot/common-types/utils/TTLCache';
import type { Logger } from 'pino';

/** Override row metadata returned by tier-specific Prisma queries. */
export interface ConfigOverrideEntry<TMappedOverride> {
  override: TMappedOverride;
  name: string;
}

/** User-lookup result with their global default joined in a single query. */
export interface UserWithDefault<TMappedOverride> {
  internalId: string;
  defaultOverride: ConfigOverrideEntry<TMappedOverride> | null;
}

/** Constructor options shared across all subclasses. */
export interface BaseConfigResolverOptions {
  /** TTL for cache entries in milliseconds. Defaults to API_KEY_CACHE_TTL. */
  cacheTtlMs?: number;
  /**
   * Preserved for backwards compatibility with the old hand-rolled cleanup
   * interval. TTLCache handles its own lifecycle, so this is now a no-op.
   */
  enableCleanup?: boolean;
  /**
   * Test-only: inject a clock function for fake-timer compatibility with
   * TTLCache. lru-cache's default `performance.now()` is NOT mocked by
   * `vi.useFakeTimers`; passing `() => Date.now()` makes TTL respect them.
   */
  now?: () => number;
}

/**
 * Abstract base for row-selecting config resolvers.
 *
 * Type parameters:
 *   - `TPersonality`: the loaded-personality shape that carries baked-in defaults
 *   - `TMappedOverride`: the post-mapper override row shape (DB → app format)
 *   - `TResolved`: the fully-resolved config returned to callers
 */
export abstract class BaseConfigResolver<TPersonality, TMappedOverride, TResolved> {
  protected readonly cache: TTLCache<BaseConfigResolutionResult<TResolved>>;
  protected readonly logger: Logger;

  constructor(serviceName: string, options?: BaseConfigResolverOptions) {
    this.logger = createLogger(serviceName);
    this.cache = new TTLCache<BaseConfigResolutionResult<TResolved>>({
      ttl: options?.cacheTtlMs ?? INTERVALS.API_KEY_CACHE_TTL,
      now: options?.now,
    });
    // `enableCleanup` is preserved on the options shape for backwards
    // compatibility. TTLCache bounds memory via LRU and expires on access,
    // so no periodic sweep is needed; the option is a no-op here.
    void options?.enableCleanup;
  }

  /**
   * Resolve the effective config for a user+personality combination.
   *
   * Cascade (first match wins):
   *   1. User per-personality override (UserPersonalityConfig.{type}ConfigId)
   *   2. User global default (User.default{Type}ConfigId)
   *   3. Personality default (already baked into TPersonality)
   */
  async resolveConfig(
    userId: string | undefined,
    personalityId: string,
    personalityConfig: TPersonality
  ): Promise<BaseConfigResolutionResult<TResolved>> {
    // No userId → personality default (anonymous / system path).
    if (userId === undefined || userId.length === 0) {
      const config = await this.extractFromPersonality(personalityConfig);
      return { config, source: this.getExtractSource(config) };
    }

    // Cache check (TTLCache returns null on miss; expiry is enforced internally).
    const cacheKey = `${userId}-${personalityId}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== null) {
      this.logger.debug({ userId, personalityId, source: 'cache' }, 'Config resolved from cache');
      return cached;
    }

    try {
      const user = await this.findUserWithDefault(userId);

      if (user === null) {
        // User doesn't exist in DB → personality default.
        const config = await this.extractFromPersonality(personalityConfig);
        const result: BaseConfigResolutionResult<TResolved> = {
          config,
          source: this.getExtractSource(config),
        };
        this.cache.set(cacheKey, result);
        return result;
      }

      // Priority 1: user per-personality override.
      const userPersonality = await this.findPerPersonalityOverride(user.internalId, personalityId);
      if (userPersonality !== null) {
        const result: BaseConfigResolutionResult<TResolved> = {
          config: this.mergeWithPersonality(
            personalityConfig,
            userPersonality.override,
            'user-personality'
          ),
          source: 'user-personality',
          configName: userPersonality.name,
        };
        this.cache.set(cacheKey, result);
        this.logger.debug(
          { userId, personalityId, configName: result.configName },
          'Config resolved from per-personality override'
        );
        return result;
      }

      // Priority 2: user global default (joined into findUserWithDefault to save a query).
      if (user.defaultOverride !== null) {
        const result: BaseConfigResolutionResult<TResolved> = {
          config: this.mergeWithPersonality(
            personalityConfig,
            user.defaultOverride.override,
            'user-default'
          ),
          source: 'user-default',
          configName: user.defaultOverride.name,
        };
        this.cache.set(cacheKey, result);
        this.logger.debug(
          { userId, personalityId, configName: result.configName },
          'Config resolved from user global default'
        );
        return result;
      }

      // Fallback: personality default.
      const config = await this.extractFromPersonality(personalityConfig);
      const result: BaseConfigResolutionResult<TResolved> = {
        config,
        source: this.getExtractSource(config),
      };
      this.cache.set(cacheKey, result);
      this.logger.debug(
        { userId, personalityId, source: result.source },
        'Config resolved from extractFromPersonality fallback'
      );
      return result;
    } catch (error) {
      this.logger.error(
        { err: error, userId, personalityId },
        'Failed to resolve config, using default'
      );
      // On any failure, return personality default rather than throwing —
      // a stale-but-functional config is better than blocking the LLM call.
      // Not cached so a subsequent call retries the DB.
      return {
        config: await Promise.resolve(this.extractFromPersonality(personalityConfig)),
        source: 'personality',
      };
    }
  }

  /** Invalidate every cache entry for a specific user. */
  invalidateUserCache(userId: string): void {
    this.cache.invalidateByPrefix(`${userId}-`);
    this.logger.debug({ userId }, 'Invalidated config cache for user');
  }

  /** Clear the entire cache. */
  clearCache(): void {
    this.cache.clear();
    this.logger.debug('Cleared config cache');
  }

  /**
   * No-op preserved for backwards compatibility with callers that managed the
   * old manual cleanup interval. TTLCache handles its own lifecycle.
   */
  stopCleanup(): void {
    // intentionally empty
  }

  // ===== Subclass hooks =====================================================

  /**
   * Look up the user by Discord ID, returning their internal UUID and global
   * default override (if set) in a single Prisma query.
   *
   * Returning both fields together preserves the single-query optimization
   * the cascade depends on. Splitting into two methods would cost an extra
   * round-trip per resolution.
   */
  protected abstract findUserWithDefault(
    discordId: string
  ): Promise<UserWithDefault<TMappedOverride> | null>;

  /**
   * Look up the user's per-personality override row. Returns null if no
   * override is configured (cascade falls through to user-default).
   */
  protected abstract findPerPersonalityOverride(
    userInternalId: string,
    personalityId: string
  ): Promise<ConfigOverrideEntry<TMappedOverride> | null>;

  /**
   * Extract the resolved config from a loaded personality (baked-in defaults).
   * Called when no user override exists.
   *
   * Always async — synchronous subclasses (LlmConfigResolver) just return a
   * resolved Promise. The microtask hop is negligible compared to the DB I/O
   * the cascade typically performs, and forcing async at the contract level
   * avoids the `T | Promise<T>` union and the `await Promise.resolve(syncValue)`
   * dance at every call site.
   */
  protected abstract extractFromPersonality(personality: TPersonality): Promise<TResolved>;

  /**
   * Optional override: tell the base which tier `extractFromPersonality`
   * actually produced. Defaults to `'personality'` — the case for
   * subclasses (LlmConfigResolver) that source defaults from the loaded
   * personality row. Subclasses that fall through to additional tiers
   * inside `extractFromPersonality` (TtsConfigResolver — falls through
   * personality default → free default → hardcoded) override this to
   * surface the actual tier in the outer `source` field.
   *
   * The implementation receives the resolved config so it can inspect any
   * inner `source` field (TtsConfigResolver's pattern) without the base
   * needing to know about those subclass-specific shapes.
   */
  // `_extracted` is intentionally prefixed: the base default returns a
  // constant and doesn't read it, but the parameter is part of the abstract-
  // hook contract so subclass overrides (TtsConfigResolver) can inspect the
  // resolved config to derive the tier. Removing the parameter would break
  // the override contract, so the `_` prefix is the standards-compliant
  // escape hatch (per `02-code-standards.md` "cases where you don't control
  // the signature").
  protected getExtractSource(_extracted: TResolved): ConfigResolutionSource {
    return 'personality';
  }

  /**
   * Merge an override row with personality defaults. Override values take
   * precedence; personality values fill in any fields the override doesn't
   * specify.
   *
   * `tier` indicates which cascade tier produced this merge — subclasses
   * with an inner `source` field (TtsConfigResolver) use it to bake the
   * correct tier into the resolved config; subclasses without an inner
   * source field (LlmConfigResolver) ignore it.
   */
  protected abstract mergeWithPersonality(
    personality: TPersonality,
    override: TMappedOverride,
    tier: 'user-personality' | 'user-default'
  ): TResolved;
}
