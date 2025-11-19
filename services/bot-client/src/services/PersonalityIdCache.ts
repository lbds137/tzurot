/**
 * PersonalityIdCache
 *
 * Wrapper around PersonalityService that caches name→ID mappings with TTL.
 * This optimizes performance when loading personalities by name multiple times,
 * since PersonalityService now caches by ID only.
 *
 * Flow:
 * 1. First load by name: DB query → cache name→ID mapping with timestamp
 * 2. Subsequent loads: Use cached ID if not expired → PersonalityService cache hit
 * 3. Expired entries: Re-fetch and update cache
 *
 * TTL prevents stale mappings if personalities are renamed (e.g., "lilith" → "Lilith v2").
 */

import { createLogger, PersonalityService, LoadedPersonality, TIMEOUTS } from '@tzurot/common-types';

const logger = createLogger('PersonalityIdCache');

interface CacheEntry {
  id: string;
  timestamp: number;
}

export class PersonalityIdCache {
  private readonly nameToIdMap = new Map<string, CacheEntry>();
  private readonly cacheTTL = TIMEOUTS.CACHE_TTL; // 5 minutes

  constructor(private personalityService: PersonalityService) {}

  /**
   * Load personality by name or ID
   * If loaded by name before and not expired, uses cached ID for faster lookup
   */
  async loadPersonality(nameOrId: string): Promise<LoadedPersonality | null> {
    // Check if it's a UUID - if so, load directly
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      nameOrId
    );

    if (isUUID) {
      return this.personalityService.loadPersonality(nameOrId);
    }

    // Check if we have a cached ID for this name
    const cached = this.nameToIdMap.get(nameOrId.toLowerCase());
    if (cached !== undefined) {
      // Check if cache entry is still valid
      const age = Date.now() - cached.timestamp;
      if (age < this.cacheTTL) {
        logger.debug({ name: nameOrId, cachedId: cached.id, age }, 'Using cached personality ID');
        return this.personalityService.loadPersonality(cached.id);
      } else {
        logger.debug({ name: nameOrId, age }, 'Cached personality ID expired, refetching');
        this.nameToIdMap.delete(nameOrId.toLowerCase());
      }
    }

    // First time loading by this name OR cache expired - load and cache the ID
    const personality = await this.personalityService.loadPersonality(nameOrId);
    if (personality) {
      const now = Date.now();
      // Cache all possible name variations
      this.nameToIdMap.set(personality.name.toLowerCase(), { id: personality.id, timestamp: now });
      this.nameToIdMap.set(personality.slug, { id: personality.id, timestamp: now });
      logger.debug(
        { name: personality.name, slug: personality.slug, id: personality.id },
        'Cached personality ID mapping'
      );
    }

    return personality;
  }

  /**
   * Clear the name→ID cache
   * Useful if personalities are renamed or deleted
   */
  clearCache(): void {
    this.nameToIdMap.clear();
    logger.info('Cleared personality ID cache');
  }
}
