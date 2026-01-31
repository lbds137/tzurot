/**
 * PersonalityCacheInvalidator - Clears caches when personality data changes
 * @module application/eventHandlers/PersonalityCacheInvalidator
 */

const logger = require('../../logger');

/**
 * PersonalityCacheInvalidator
 *
 * Event handler that invalidates caches when personality data changes.
 * This ensures that cached data stays in sync with the domain model.
 */
class PersonalityCacheInvalidator {
  /**
   * @param {Object} dependencies
   * @param {Object} dependencies.profileInfoCache - Profile info cache to invalidate
   * @param {Object} dependencies.messageTracker - Message tracker for clearing personality data
   */
  constructor({ profileInfoCache, messageTracker }) {
    this.profileInfoCache = profileInfoCache;
    this.messageTracker = messageTracker;
  }

  /**
   * Handle PersonalityProfileUpdated event
   * @param {PersonalityProfileUpdated} event - The domain event
   */
  async handlePersonalityProfileUpdated(event) {
    try {
      const personalityName = event.payload.profile?.name;
      if (personalityName && this.profileInfoCache) {
        logger.info(
          `[PersonalityCacheInvalidator] Clearing cache for updated personality: ${personalityName}`
        );
        this.profileInfoCache.deleteFromCache(personalityName);
      }
    } catch (error) {
      logger.error(`[PersonalityCacheInvalidator] Error handling profile update: ${error.message}`);
    }
  }

  /**
   * Handle PersonalityRemoved event
   * @param {PersonalityRemoved} event - The domain event
   */
  async handlePersonalityRemoved(event) {
    try {
      const personalityName = event.payload.personalityName;
      if (personalityName) {
        // Clear profile cache
        if (this.profileInfoCache) {
          logger.info(
            `[PersonalityCacheInvalidator] Clearing cache for removed personality: ${personalityName}`
          );
          this.profileInfoCache.deleteFromCache(personalityName);
        }

        // Clear any message tracking data
        if (this.messageTracker) {
          // Note: messageTracker might need additional methods to clear by personality
          logger.info(
            `[PersonalityCacheInvalidator] Would clear message tracking for: ${personalityName}`
          );
        }
      }
    } catch (error) {
      logger.error(
        `[PersonalityCacheInvalidator] Error handling personality removal: ${error.message}`
      );
    }
  }

  /**
   * Handle PersonalityAliasAdded event
   * @param {PersonalityAliasAdded} event - The domain event
   */
  async handlePersonalityAliasAdded(event) {
    try {
      // When an alias is added, we might need to clear caches that use aliases for lookup
      const personalityName = event.payload.personalityName;
      if (personalityName && this.profileInfoCache) {
        logger.info(
          `[PersonalityCacheInvalidator] Clearing cache after alias added to: ${personalityName}`
        );
        this.profileInfoCache.deleteFromCache(personalityName);
      }
    } catch (error) {
      logger.error(`[PersonalityCacheInvalidator] Error handling alias addition: ${error.message}`);
    }
  }

  /**
   * Handle PersonalityAliasRemoved event
   * @param {PersonalityAliasRemoved} event - The domain event
   */
  async handlePersonalityAliasRemoved(event) {
    try {
      // When an alias is removed, clear caches
      const personalityName = event.payload.personalityName;
      const alias = event.payload.alias;

      if (this.profileInfoCache) {
        if (personalityName) {
          logger.info(
            `[PersonalityCacheInvalidator] Clearing cache after alias removed from: ${personalityName}`
          );
          this.profileInfoCache.deleteFromCache(personalityName);
        }
        if (alias) {
          // Also clear the alias from cache in case it was cached
          this.profileInfoCache.deleteFromCache(alias);
        }
      }
    } catch (error) {
      logger.error(`[PersonalityCacheInvalidator] Error handling alias removal: ${error.message}`);
    }
  }
}

module.exports = { PersonalityCacheInvalidator };
