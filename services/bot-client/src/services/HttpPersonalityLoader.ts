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

import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { TTLCache } from '@tzurot/common-types/utils/TTLCache';
import { type PersonalityCacheTarget } from '@tzurot/cache-invalidation';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import { getServiceClient } from '../utils/gatewayClients.js';
import { InfraError, GatewayClientError, nullOn404 } from '@tzurot/clients';

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

  /**
   * Strict load: returns `null` ONLY for a genuine miss (the endpoint responds
   * 200 with `personality: null` — not found / access denied), and THROWS on a
   * gateway FAILURE (`nullOn404` → `InfraError` for infra, `GatewayClientError`
   * for a non-404 4xx). An infra failure is NOT negative-cached — a blip must
   * not blind future loads for the negative TTL. User-facing callers use this so
   * a transient failure surfaces as "try again" rather than a false "not found".
   */
  async loadPersonalityStrict(
    nameOrId: string,
    userId?: string
  ): Promise<LoadedPersonality | null> {
    const key = this.cacheKey(nameOrId, userId);

    const cached = this.positiveCache.get(key);
    if (cached !== null) {
      return cached;
    }
    if (this.negativeCache.get(key) !== null) {
      return null;
    }

    // This endpoint signals "not found" as a 200 with personality:null, never a
    // 404 — so every non-404 `!ok` is a real gateway error: nullOn404 throws it
    // (infra → InfraError, non-404 4xx → GatewayClientError) WITHOUT caching. A
    // stray 404 (contract violation) is the one error code nullOn404 collapses to
    // null instead of throwing — it then falls through to the defensive
    // genuine-miss path below (negative-cached), converging with the 200-null case.
    const data = nullOn404(await getServiceClient().loadPersonalityInternal({ nameOrId, userId }));
    const personality = data?.personality ?? null;
    if (personality === null) {
      this.negativeCache.set(key, true);
      return null;
    }

    this.positiveCache.set(key, personality);
    return personality;
  }

  /**
   * Lenient load for ROUTING / mention-parsing: collapses every gateway failure
   * to `null` ("treat unknown as no-match"). A transient blip must not blind
   * routing, so the failure is swallowed and — crucially — NOT negative-cached
   * (`loadPersonalityStrict` throws before the negative-cache write). Wraps
   * {@link loadPersonalityStrict}; only re-classifies its thrown failures.
   */
  async loadPersonality(nameOrId: string, userId?: string): Promise<LoadedPersonality | null> {
    try {
      return await this.loadPersonalityStrict(nameOrId, userId);
    } catch (error) {
      if (error instanceof InfraError || error instanceof GatewayClientError) {
        logger.warn(
          { status: error.status },
          'Personality load via gateway failed; treating as no-match for routing'
        );
        return null;
      }
      throw error;
    }
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
