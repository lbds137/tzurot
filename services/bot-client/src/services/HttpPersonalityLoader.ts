/**
 * HTTP-backed personality loader.
 *
 * Implements IPersonalityLoader over the gateway's internal
 * `GET /api/internal/personality/load` route — bot-client's loader for the
 * routing paths (mention parsing, reply resolution, channel activation,
 * multi-tag recovery, /character chat), keeping Prisma off those paths.
 *
 * Caching is load-bearing here, not an optimization: PersonalityService
 * skips its own cache whenever a userId is present (access control is
 * re-checked per load), so every routing probe is a fresh lookup. Over HTTP
 * that would mean one gateway hop per mention-parse candidate per message.
 * Two cache tiers, keyed by (userId, nameOrId):
 *
 * - **Positive** (5 min): resolved personalities; a rename is tolerated for up
 *   to the TTL. Config changes invalidate eagerly via the personality pub/sub
 *   channel (see invalidate methods).
 * - **Negative** (60 s): definitive misses — the common case during mention
 *   parsing, where most `@word` candidates are not personalities. Shorter
 *   TTL so newly-created or renamed personalities appear quickly. Transport
 *   errors are NEVER negative-cached — a gateway blip must not blind
 *   routing for 60 s.
 */

import {
  createLogger,
  TIMEOUTS,
  TTLCache,
  type LoadedPersonality,
  type PersonalityCacheTarget,
} from '@tzurot/common-types';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import { getServiceClient } from '../utils/gatewayClients.js';

const logger = createLogger('HttpPersonalityLoader');

/**
 * Definitive misses expire fast so new/renamed personalities appear quickly.
 * Exported so tests advance the injected clock against the real value rather
 * than a duplicated literal.
 */
export const NEGATIVE_TTL_MS = 60 * 1000;
/** Distinct (user, personality) pairs actively routing at once. */
const POSITIVE_MAX_SIZE = 500;
/** Misses dominate (most mention candidates aren't personalities) — bigger cap. */
const NEGATIVE_MAX_SIZE = 2000;

export class HttpPersonalityLoader implements IPersonalityLoader, PersonalityCacheTarget {
  private readonly positiveCache: TTLCache<LoadedPersonality>;
  private readonly negativeCache: TTLCache<true>;

  /**
   * @param options.now - Test-only clock injection, threaded into TTLCache
   * (lru-cache snapshots performance.now at module load, so vitest fake
   * timers can't advance cache TTLs without it).
   */
  constructor(options: { now?: () => number } = {}) {
    this.positiveCache = new TTLCache<LoadedPersonality>({
      ttl: TIMEOUTS.CACHE_TTL,
      maxSize: POSITIVE_MAX_SIZE,
      now: options.now,
    });
    this.negativeCache = new TTLCache<true>({
      ttl: NEGATIVE_TTL_MS,
      maxSize: NEGATIVE_MAX_SIZE,
      now: options.now,
    });
  }

  /**
   * Access control happens server-side (the endpoint applies
   * loadPersonality's public-or-owned semantics), so the cache key must
   * carry the userId — the same nameOrId can legitimately resolve for one
   * user and miss for another. The delimiter is `\x00` (NUL): it cannot
   * appear in a Discord snowflake or a personality name/slug/alias, so two
   * distinct (userId, nameOrId) pairs can never collide into one key (which
   * a printable delimiter like `::` could, e.g. a name containing `::`).
   */
  private cacheKey(nameOrId: string, userId?: string): string {
    return `${userId ?? ''}\x00${nameOrId.toLowerCase()}`;
  }

  async loadPersonality(nameOrId: string, userId?: string): Promise<LoadedPersonality | null> {
    const key = this.cacheKey(nameOrId, userId);

    const cached = this.positiveCache.get(key);
    if (cached !== null) {
      return cached;
    }
    if (this.negativeCache.get(key) !== null) {
      return null;
    }

    const result = await getServiceClient().loadPersonalityInternal({ nameOrId, userId });
    if (!result.ok) {
      // Transport/server error — NOT a definitive miss. Return null for this
      // call (routing treats unknown as no-match, same as legacy DB errors)
      // but don't cache it.
      logger.warn({ status: result.status }, 'Personality load via gateway failed');
      return null;
    }

    const personality = result.data.personality;
    if (personality === null) {
      this.negativeCache.set(key, true);
      return null;
    }

    this.positiveCache.set(key, personality);
    return personality;
  }

  /**
   * Invalidation drops BOTH tiers entirely rather than hunting matching
   * entries: the caches are keyed by (userId, nameOrId) while invalidation
   * events carry a personality id, so a precise mapping isn't available.
   * The caches are small and rebuild in one round-trip per active probe.
   */
  invalidatePersonality(personalityId: string): void {
    this.positiveCache.clear();
    this.negativeCache.clear();
    logger.debug(
      { personalityId },
      'Personality invalidation event received; full routing-cache clear applied'
    );
  }

  invalidateAll(): void {
    this.positiveCache.clear();
    this.negativeCache.clear();
    logger.debug('Full personality invalidation; routing caches cleared');
  }
}
