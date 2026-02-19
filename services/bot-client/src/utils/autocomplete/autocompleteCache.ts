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
  // Check cache first - undefined means "not fetched yet"
  const cached = userCache.get(userId);
  if (cached?.personalities !== undefined) {
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
    // Preserve undefined for personas/shapes if not yet fetched
    const existingData = userCache.get(userId);
    const newData: UserAutocompleteData = {
      personalities: result.data.personalities,
      personas: existingData?.personas,
      shapes: existingData?.shapes,
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
  // Check cache first - undefined means "not fetched yet"
  const cached = userCache.get(userId);
  if (cached?.personas !== undefined) {
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
    // Preserve undefined for personalities/shapes if not yet fetched
    const existingData = userCache.get(userId);
    const newData: UserAutocompleteData = {
      personalities: existingData?.personalities,
      personas: result.data.personas,
      shapes: existingData?.shapes,
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
 * Get cached shapes for a user, fetching from gateway if cache miss
 *
 * @param userId - Discord user ID
 * @returns Array of shape summaries, or empty array on error
 */
export async function getCachedShapes(userId: string): Promise<ShapesSummary[]> {
  // Check cache first - undefined means "not fetched yet"
  const cached = userCache.get(userId);
  if (cached?.shapes !== undefined) {
    logger.debug({ userId }, '[AutocompleteCache] Shapes cache hit');
    return cached.shapes;
  }

  // Cache miss - fetch from gateway
  logger.debug({ userId }, '[AutocompleteCache] Shapes cache miss, fetching');

  try {
    const result = await callGatewayApi<{ shapes: ShapesSummary[] }>('/user/shapes/list', {
      userId,
      // Explicit: default is AUTOCOMPLETE (2500ms), fits Discord's 3s autocomplete window
    });

    if (!result.ok) {
      logger.warn({ userId, error: result.error }, '[AutocompleteCache] Failed to fetch shapes');
      return [];
    }

    // Get existing cached data or create new entry
    // Preserve undefined for personalities/personas if not yet fetched
    const existingData = userCache.get(userId);
    const newData: UserAutocompleteData = {
      personalities: existingData?.personalities,
      personas: existingData?.personas,
      shapes: result.data.shapes,
    };

    userCache.set(userId, newData);
    logger.debug({ userId, count: result.data.shapes.length }, '[AutocompleteCache] Cached shapes');

    return result.data.shapes;
  } catch (error) {
    logger.error({ err: error, userId }, '[AutocompleteCache] Error fetching shapes');
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
