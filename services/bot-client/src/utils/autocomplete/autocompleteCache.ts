/**
 * Autocomplete Data Cache
 *
 * Caches personality, persona, and shapes lists to avoid HTTP requests on
 * every keystroke. Discord autocomplete fires on each character typed, so
 * without caching we'd flood the gateway API and potentially saturate HTTP
 * connections.
 *
 * Two-tier design:
 *
 *   - `freshCache` (TTLCache, 60s TTL, LRU-bounded): the happy-path cache.
 *     Serves recently-fetched data to subsequent keystrokes within the TTL
 *     window.
 *
 *   - `staleCache` (Map, no TTL, manually LRU-bounded): last-known-good
 *     fallback. Populated on every successful fetch in parallel with
 *     `freshCache`. Used ONLY when a subsequent fetch fails with a
 *     transient error (5xx / network / timeout). Protects users from
 *     seeing empty autocompletes during backend instability — they'd
 *     reasonably conclude "I have no personalities/personas/shapes" from
 *     an empty list, which is a silent lie.
 *
 * Permanent errors (4xx) intentionally skip the stale fallback: a 403 or
 * 404 from the backend usually means the user's authorization state
 * changed (the item was deleted, their access was revoked), and serving
 * stale data would mask that real-world change. Permanent errors
 * surface as `{ kind: 'error' }` so autocomplete handlers render an
 * error placeholder.
 *
 * Handlers consume `ApiCheck<T[]>` results:
 *
 *   - `{ kind: 'ok' }` → render choices normally. The cache's internal
 *     stale-vs-fresh distinction is opaque to handlers — from their
 *     perspective, any data served is authoritative-enough for
 *     autocomplete hinting. Submission-time handlers still validate
 *     against current state.
 *
 *   - `{ kind: 'error' }` → render a single non-selectable placeholder
 *     choice ("Unable to load — try again"). Clearer than showing an
 *     empty list.
 */

import { createLogger, TTLCache, type PersonalitySummary } from '@tzurot/common-types';
import { callGatewayApi, type GatewayUser } from '../userGatewayClient.js';
import { isTransientHttpStatus, type ApiCheck } from '../apiCheck.js';

const logger = createLogger('autocomplete-cache');

/**
 * Persona summary type (matches gateway response)
 */
export interface PersonaSummary {
  id: string;
  name: string;
  preferredName: string | null;
  isDefault: boolean;
}

/**
 * Shapes summary type for autocomplete (matches gateway response)
 */
export interface ShapesSummary {
  name: string;
  username: string;
}

/**
 * Cached data structure for a user's autocomplete options
 *
 * Uses undefined to indicate "not yet fetched" vs empty array for "fetched but empty".
 * This distinction prevents re-fetching data for users who legitimately have no
 * personalities or personas.
 */
interface UserAutocompleteData {
  personalities: PersonalitySummary[] | undefined;
  personas: PersonaSummary[] | undefined;
  shapes: ShapesSummary[] | undefined;
}

const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_SIZE = 500;

/** Sentinel error used by the catch-path when the gateway client throws before producing an HTTP response. */
const UNKNOWN_FETCH_ERROR = 'Unknown error';

/**
 * Fresh cache: 60s TTL, LRU-bounded. Hit here → return immediately.
 */
const freshCache = new TTLCache<UserAutocompleteData>({
  ttl: CACHE_TTL_MS,
  maxSize: CACHE_MAX_SIZE,
});

/**
 * Stale cache: last-known-good per user, no TTL, FIFO-bounded via
 * insertion-order tracking. Consulted only when `freshCache` misses AND the
 * refetch fails with a transient error.
 *
 * FIFO not LRU: eviction removes the oldest-inserted entry, not the
 * least-recently-accessed one. A plain Map's iteration order is insertion
 * order and there's no access tracking here. For a fallback store this is
 * the right tradeoff — we want to prefer recently-populated entries and
 * accept that an entry accessed many times will still age out if a newer
 * entry displaces it.
 *
 * Using a plain Map because TTLCache would expire stale entries — we want
 * stale data to outlive `CACHE_TTL_MS` specifically so it can serve as a
 * fallback during backend outages that last longer than the TTL.
 */
const staleCache = new Map<string, UserAutocompleteData>();

/**
 * Update the stale entry for a user. Re-inserts the key to move it to the
 * end of the Map's iteration order (newest-inserted tail), then trims the
 * single oldest entry if the Map has grown past the bound. Since each call
 * adds exactly one entry, at most one eviction is ever needed per call.
 */
function updateStale(userId: string, data: UserAutocompleteData): void {
  staleCache.delete(userId);
  staleCache.set(userId, data);
  if (staleCache.size > CACHE_MAX_SIZE) {
    const oldest = staleCache.keys().next().value;
    if (oldest !== undefined) {
      staleCache.delete(oldest);
    }
  }
}

/**
 * Merge a successfully-fetched field into both caches, preserving the other
 * two fields' existing values from whichever cache has them (fresh wins over
 * stale for reads).
 *
 * Tradeoff worth understanding: when the other fields are ONLY in the stale
 * tier (their fresh entry has expired), this carries them up into the new
 * fresh entry, effectively resetting their TTL for another 60s. That's
 * intentional — autocomplete data is low-stakes and keeping a user's full
 * personality/persona/shapes bundle cohesive in one cache tier avoids
 * cache misses on the next keystroke for an unrelated field. If autocomplete
 * data ever becomes higher-stakes (e.g., billing-sensitive), this merge
 * would need a per-field TTL or a last-modified timestamp instead.
 */
function commitFetchedField<K extends keyof UserAutocompleteData>(
  userId: string,
  field: K,
  value: NonNullable<UserAutocompleteData[K]>
): void {
  const existingFresh = freshCache.get(userId);
  const existingStale = staleCache.get(userId);
  const carryOver = {
    personalities: existingFresh?.personalities ?? existingStale?.personalities,
    personas: existingFresh?.personas ?? existingStale?.personas,
    shapes: existingFresh?.shapes ?? existingStale?.shapes,
  };
  const next: UserAutocompleteData = { ...carryOver, [field]: value };
  freshCache.set(userId, next);
  updateStale(userId, next);
}

/**
 * Handle the transient-error path: return stale data if present, else error.
 */
function fallbackToStale<K extends keyof UserAutocompleteData>(
  userId: string,
  field: K,
  error: string,
  httpStatus: number
): ApiCheck<NonNullable<UserAutocompleteData[K]>> {
  const stale = staleCache.get(userId)?.[field];
  if (stale !== undefined) {
    logger.warn(
      { userId, field, error, httpStatus },
      'Serving stale autocomplete data (transient fetch error)'
    );
    return { kind: 'ok', value: stale };
  }
  return { kind: 'error', error };
}

/**
 * Get cached personalities for a user. Cache miss triggers a gateway fetch.
 */
export async function getCachedPersonalities(
  user: GatewayUser
): Promise<ApiCheck<PersonalitySummary[]>> {
  const userId = user.discordId;
  const cached = freshCache.get(userId);
  if (cached?.personalities !== undefined) {
    logger.debug({ userId }, 'Personality cache hit');
    return { kind: 'ok', value: cached.personalities };
  }

  logger.debug({ userId }, 'Personality cache miss, fetching');

  try {
    const result = await callGatewayApi<{ personalities: PersonalitySummary[] }>(
      '/user/personality',
      { user }
    );

    if (result.ok) {
      commitFetchedField(userId, 'personalities', result.data.personalities);
      logger.debug({ userId, count: result.data.personalities.length }, 'Cached personalities');
      return { kind: 'ok', value: result.data.personalities };
    }

    logger.warn(
      { userId, error: result.error, httpStatus: result.status },
      'Failed to fetch personalities'
    );
    if (isTransientHttpStatus(result.status)) {
      return fallbackToStale(userId, 'personalities', result.error, result.status);
    }
    return { kind: 'error', error: result.error };
  } catch (error) {
    logger.error({ err: error, userId }, 'Error fetching personalities');
    // Thrown errors from the gateway client bypass the ok/status discriminator
    // entirely; treat as transient since we can't prove otherwise.
    return fallbackToStale(userId, 'personalities', UNKNOWN_FETCH_ERROR, 0);
  }
}

/**
 * Get cached personas for a user. Cache miss triggers a gateway fetch.
 */
export async function getCachedPersonas(user: GatewayUser): Promise<ApiCheck<PersonaSummary[]>> {
  const userId = user.discordId;
  const cached = freshCache.get(userId);
  if (cached?.personas !== undefined) {
    logger.debug({ userId }, 'Persona cache hit');
    return { kind: 'ok', value: cached.personas };
  }

  logger.debug({ userId }, 'Persona cache miss, fetching');

  try {
    const result = await callGatewayApi<{ personas: PersonaSummary[] }>('/user/persona', {
      user,
    });

    if (result.ok) {
      commitFetchedField(userId, 'personas', result.data.personas);
      logger.debug({ userId, count: result.data.personas.length }, 'Cached personas');
      return { kind: 'ok', value: result.data.personas };
    }

    logger.warn(
      { userId, error: result.error, httpStatus: result.status },
      'Failed to fetch personas'
    );
    if (isTransientHttpStatus(result.status)) {
      return fallbackToStale(userId, 'personas', result.error, result.status);
    }
    return { kind: 'error', error: result.error };
  } catch (error) {
    logger.error({ err: error, userId }, 'Error fetching personas');
    return fallbackToStale(userId, 'personas', UNKNOWN_FETCH_ERROR, 0);
  }
}

/**
 * Get cached shapes for a user. Cache miss triggers a gateway fetch.
 */
export async function getCachedShapes(user: GatewayUser): Promise<ApiCheck<ShapesSummary[]>> {
  const userId = user.discordId;
  const cached = freshCache.get(userId);
  if (cached?.shapes !== undefined) {
    logger.debug({ userId }, 'Shapes cache hit');
    return { kind: 'ok', value: cached.shapes };
  }

  logger.debug({ userId }, 'Shapes cache miss, fetching');

  try {
    const result = await callGatewayApi<{ shapes: ShapesSummary[] }>('/user/shapes/list', {
      user,
    });

    if (result.ok) {
      commitFetchedField(userId, 'shapes', result.data.shapes);
      logger.debug({ userId, count: result.data.shapes.length }, 'Cached shapes');
      return { kind: 'ok', value: result.data.shapes };
    }

    logger.warn(
      { userId, error: result.error, httpStatus: result.status },
      'Failed to fetch shapes'
    );
    if (isTransientHttpStatus(result.status)) {
      return fallbackToStale(userId, 'shapes', result.error, result.status);
    }
    return { kind: 'error', error: result.error };
  } catch (error) {
    logger.error({ err: error, userId }, 'Error fetching shapes');
    return fallbackToStale(userId, 'shapes', UNKNOWN_FETCH_ERROR, 0);
  }
}

/**
 * Invalidate cache for a specific user. Clears both fresh and stale tiers —
 * a create/update/delete means the stale entry is also wrong.
 */
export function invalidateUserCache(userId: string): void {
  freshCache.delete(userId);
  staleCache.delete(userId);
  logger.debug({ userId }, 'Invalidated user cache (fresh + stale)');
}

/**
 * Clear all cache entries.
 * @internal For testing only
 */
export function _clearCacheForTesting(): void {
  freshCache.clear();
  staleCache.clear();
}

/**
 * Get cache size (fresh tier only).
 * @internal For testing only
 */
export function _getCacheSizeForTesting(): number {
  return freshCache.size();
}

/**
 * Clear ONLY the fresh tier, leaving stale intact. Lets tests exercise the
 * stale-fallback path without depending on fake-timer TTL expiry (TTLCache
 * doesn't react to vi.useFakeTimers without extra wiring).
 * @internal For testing only
 */
export function _clearFreshCacheForTesting(): void {
  freshCache.clear();
}

/**
 * Get stale cache size.
 * @internal For testing only
 */
export function _getStaleCacheSizeForTesting(): number {
  return staleCache.size;
}
