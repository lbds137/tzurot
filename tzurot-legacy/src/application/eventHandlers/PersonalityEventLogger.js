/**
 * PersonalityEventLogger - Example event handler that logs personality events
 * @module application/eventHandlers/PersonalityEventLogger
 */

const logger = require('../../logger');

/**
 * PersonalityEventLogger
 *
 * Example event handler that demonstrates the event-driven pattern.
 * In a real application, this could trigger other actions like:
 * - Sending notifications
 * - Updating search indexes
 * - Clearing caches
 * - Generating analytics
 */
class PersonalityEventLogger {
  /**
   * Handle PersonalityCreated event
   * @param {PersonalityCreated} event - The domain event
   */
  async handlePersonalityCreated(event) {
    logger.info(
      `[PersonalityEventLogger] Personality created: ${event.payload.profile.name} by user ${event.payload.ownerId}`
    );

    // Example: This could trigger other actions
    // - Notify other users about new personality
    // - Update personality count metrics
    // - Clear personality list cache
  }

  /**
   * Handle PersonalityProfileUpdated event
   * @param {PersonalityProfileUpdated} event - The domain event
   */
  async handlePersonalityProfileUpdated(event) {
    logger.info(`[PersonalityEventLogger] Personality profile updated: ${event.aggregateId}`);

    // Example: This could trigger other actions
    // - Clear profile cache for this personality
    // - Notify active conversations about changes
    // - Update search index
  }

  /**
   * Handle PersonalityRemoved event
   * @param {PersonalityRemoved} event - The domain event
   */
  async handlePersonalityRemoved(event) {
    logger.info(`[PersonalityEventLogger] Personality removed: ${event.aggregateId}`);

    // Example: This could trigger other actions
    // - End all active conversations with this personality
    // - Remove from all user collections
    // - Clean up associated data
  }

  /**
   * Handle PersonalityAliasAdded event
   * @param {PersonalityAliasAdded} event - The domain event
   */
  async handlePersonalityAliasAdded(event) {
    logger.info(
      `[PersonalityEventLogger] Alias added: ${event.payload.alias} to personality ${event.aggregateId}`
    );

    // Example: This could trigger other actions
    // - Update alias search index
    // - Clear personality lookup cache
  }

  /**
   * Handle PersonalityAliasRemoved event
   * @param {PersonalityAliasRemoved} event - The domain event
   */
  async handlePersonalityAliasRemoved(event) {
    logger.info(
      `[PersonalityEventLogger] Alias removed: ${event.payload.alias} from personality ${event.aggregateId}`
    );

    // Example: This could trigger other actions
    // - Update alias search index
    // - Clear personality lookup cache
  }
}

module.exports = { PersonalityEventLogger };
