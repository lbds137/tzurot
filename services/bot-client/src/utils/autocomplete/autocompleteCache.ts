/**
 * Autocomplete Data Cache
 *
 * Caches personality and persona lists to avoid HTTP requests on every keystroke.
 * Discord autocomplete fires on each character typed, so without caching we'd
 * flood the gateway API and potentially saturate HTTP connections.
 *
 * TTL: 60 seconds - balances freshness with performance
 * Max entries: 500 users - prevents unbounded memory growth
 */

import { createLogger, TTLCache, type PersonalitySummary } from '@tzurot/common-types';
import { callGatewayApi } from '../userGatewayClient.js';

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
 * Cached data structure for a user's autocomplete options
 */
interface UserAutocompleteData {
  personalities: PersonalitySummary[];
  personas: PersonaSummary[];
}

/**
 * Cache configuration
 */
const CACHE_TTL_MS = 60 * 1000; // 60 seconds
const CACHE_MAX_SIZE = 500; // Max users to cache

/**
 * User-scoped cache for autocomplete data
 * Key: Discord user ID
 * Value: Cached personality and persona lists
 */
const userCache = new TTLCache<UserAutocompleteData>({
  ttl: CACHE_TTL_MS,
  maxSize: CACHE_MAX_SIZE,
});

/**
 * Get cached personalities for a user, fetching from gateway if cache miss
 *
 * @param userId - Discord user ID
 * @returns Array of personality summaries, or empty array on error
 */
export async function getCachedPersonalities(userId: string): Promise<PersonalitySummary[]> {
  // Check cache first
  const cached = userCache.get(userId);
  if (cached !== null) {
    logger.debug({ userId }, '[AutocompleteCache] Personality cache hit');
    return cached.personalities;
  }

  // Cache miss - fetch from gateway
  logger.debug({ userId }, '[AutocompleteCache] Personality cache miss, fetching');

  try {
    const result = await callGatewayApi<{ personalities: PersonalitySummary[] }>(
      '/user/personality',
      { userId }
    );

    if (!result.ok) {
      logger.warn(
        { userId, error: result.error },
        '[AutocompleteCache] Failed to fetch personalities'
      );
      return [];
    }

    // Get existing cached data or create new entry
    const existingData = userCache.get(userId);
    const newData: UserAutocompleteData = {
      personalities: result.data.personalities,
      personas: existingData?.personas ?? [],
    };

    userCache.set(userId, newData);
    logger.debug(
      { userId, count: result.data.personalities.length },
      '[AutocompleteCache] Cached personalities'
    );

    return result.data.personalities;
  } catch (error) {
    logger.error({ err: error, userId }, '[AutocompleteCache] Error fetching personalities');
    return [];
  }
}

/**
 * Get cached personas for a user, fetching from gateway if cache miss
 *
 * @param userId - Discord user ID
 * @returns Array of persona summaries, or empty array on error
 */
export async function getCachedPersonas(userId: string): Promise<PersonaSummary[]> {
  // Check cache first
  const cached = userCache.get(userId);
  if (cached !== null && cached.personas.length > 0) {
    logger.debug({ userId }, '[AutocompleteCache] Persona cache hit');
    return cached.personas;
  }

  // Cache miss - fetch from gateway
  logger.debug({ userId }, '[AutocompleteCache] Persona cache miss, fetching');

  try {
    const result = await callGatewayApi<{ personas: PersonaSummary[] }>('/user/persona', {
      userId,
    });

    if (!result.ok) {
      logger.warn({ userId, error: result.error }, '[AutocompleteCache] Failed to fetch personas');
      return [];
    }

    // Get existing cached data or create new entry
    const existingData = userCache.get(userId);
    const newData: UserAutocompleteData = {
      personalities: existingData?.personalities ?? [],
      personas: result.data.personas,
    };

    userCache.set(userId, newData);
    logger.debug(
      { userId, count: result.data.personas.length },
      '[AutocompleteCache] Cached personas'
    );

    return result.data.personas;
  } catch (error) {
    logger.error({ err: error, userId }, '[AutocompleteCache] Error fetching personas');
    return [];
  }
}

/**
 * Invalidate cache for a specific user.
 * Call this when personalities or personas are created/updated/deleted.
 *
 * @param userId - Discord user ID
 */
export function invalidateUserCache(userId: string): void {
  userCache.delete(userId);
  logger.debug({ userId }, '[AutocompleteCache] Invalidated user cache');
}

/**
 * Clear all cache entries.
 * @internal For testing only
 */
export function _clearCacheForTesting(): void {
  userCache.clear();
}

/**
 * Get cache size.
 * @internal For testing only
 */
export function _getCacheSizeForTesting(): number {
  return userCache.size();
}
