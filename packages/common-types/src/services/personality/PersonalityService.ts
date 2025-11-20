/**
 * PersonalityService
 * Main orchestrator for loading personalities from PostgreSQL with caching
 *
 * Delegates to specialized modules:
 * - PersonalityLoader: Database queries
 * - PersonalityValidator: Zod schemas and validation
 * - PersonalityDefaults: Config merging and placeholder replacement
 * - PersonalityCache: In-memory caching with TTL
 */

import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../../utils/logger.js';
import { TIMEOUTS } from '../../constants/index.js';
import type { LoadedPersonality } from '../../types/schemas.js';
import { PersonalityCache } from '../../utils/PersonalityCache.js';
import { PersonalityLoader } from './PersonalityLoader.js';
import { mapToPersonality } from './PersonalityDefaults.js';

const logger = createLogger('PersonalityService');

export class PersonalityService {
  private cache: PersonalityCache<LoadedPersonality>;
  private loader: PersonalityLoader;

  constructor(prisma: PrismaClient) {
    this.cache = new PersonalityCache({
      ttl: TIMEOUTS.CACHE_TTL,
      maxSize: 100, // Maximum personalities to cache
    });
    this.loader = new PersonalityLoader(prisma);
  }

  /**
   * Load a personality by name or ID
   * Cache is always keyed by ID for consistency
   */
  async loadPersonality(nameOrId: string): Promise<LoadedPersonality | null> {
    // Check if nameOrId is a valid UUID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);

    // If it's a UUID, check cache by ID first
    if (isUUID) {
      const cached = this.cache.get(nameOrId);
      if (cached) {
        return cached;
      }
    }

    // Load from database
    const dbPersonality = await this.loader.loadFromDatabase(nameOrId);
    if (!dbPersonality) {
      return null;
    }

    // If personality has no default config, load global default as fallback
    let globalDefaultConfig = null;
    if (!dbPersonality.defaultConfigLink) {
      globalDefaultConfig = await this.loader.loadGlobalDefaultConfig();
    }

    // Map database personality to LoadedPersonality with config merging
    const personality = mapToPersonality(dbPersonality, globalDefaultConfig, logger);

    // Cache by ID only for clean, normalized cache keys
    this.cache.set(personality.id, personality);

    logger.info(
      {
        id: personality.id,
        name: personality.name,
        model: personality.model,
        visionModel: personality.visionModel,
        hasVisionModel:
          personality.visionModel !== undefined &&
          personality.visionModel !== null &&
          personality.visionModel.length > 0,
        usedGlobalDefault:
          dbPersonality.defaultConfigLink === undefined && globalDefaultConfig !== null,
      },
      'Loaded personality with config'
    );
    return personality;
  }

  /**
   * Load all personalities
   */
  async loadAllPersonalities(): Promise<LoadedPersonality[]> {
    const dbPersonalities = await this.loader.loadAllFromDatabase();

    // Load global default config once for all personalities that need it
    const needsGlobalDefault = dbPersonalities.some(db => !db.defaultConfigLink);
    const globalDefaultConfig = needsGlobalDefault
      ? await this.loader.loadGlobalDefaultConfig()
      : null;

    // Map all personalities with config merging
    const personalities = dbPersonalities.map(db =>
      mapToPersonality(db, db.defaultConfigLink ? null : globalDefaultConfig, logger)
    );

    // Cache all personalities by ID only
    for (const personality of personalities) {
      this.cache.set(personality.id, personality);
    }

    logger.info(`Loaded ${personalities.length} personalities from database`);
    return personalities;
  }

  /**
   * Invalidate cache for a specific personality
   * Useful when personality or its config has been updated
   *
   * Note: Cache invalidation events always provide personality ID,
   * so nameOrId is expected to be a UUID in normal operation
   */
  invalidatePersonality(nameOrId: string): void {
    this.cache.delete(nameOrId);
    logger.debug({ key: nameOrId }, 'Invalidated cache for personality');
  }

  /**
   * Invalidate all cached personalities
   * Useful when global default config changes (affects all personalities using global default)
   */
  invalidateAll(): void {
    this.cache.clear();
    logger.info('Invalidated all personality cache entries');
  }

  /**
   * Get cache statistics (for debugging/monitoring)
   */
  getCacheStats(): { size: number; maxSize: number; ttl: number } {
    return {
      size: this.cache.size(),
      maxSize: 100,
      ttl: TIMEOUTS.CACHE_TTL,
    };
  }
}
