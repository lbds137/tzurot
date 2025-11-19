/**
 * PersonalityIdCache
 *
 * Wrapper around PersonalityService that caches name→ID mappings.
 * This optimizes performance when loading personalities by name multiple times,
 * since PersonalityService now caches by ID only.
 *
 * Flow:
 * 1. First load by name: DB query → cache name→ID mapping
 * 2. Subsequent loads: Use cached ID → PersonalityService cache hit
 */

import { createLogger, PersonalityService, LoadedPersonality } from '@tzurot/common-types';

const logger = createLogger('PersonalityIdCache');

export class PersonalityIdCache {
  private readonly nameToIdMap = new Map<string, string>();

  constructor(private personalityService: PersonalityService) {}

  /**
   * Load personality by name or ID
   * If loaded by name before, uses cached ID for faster lookup
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
    const cachedId = this.nameToIdMap.get(nameOrId.toLowerCase());
    if (cachedId !== undefined) {
      logger.debug({ name: nameOrId, cachedId }, 'Using cached personality ID');
      return this.personalityService.loadPersonality(cachedId);
    }

    // First time loading by this name - load and cache the ID
    const personality = await this.personalityService.loadPersonality(nameOrId);
    if (personality) {
      // Cache all possible name variations
      this.nameToIdMap.set(personality.name.toLowerCase(), personality.id);
      this.nameToIdMap.set(personality.slug, personality.id);
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
