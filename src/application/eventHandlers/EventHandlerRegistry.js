/**
 * EventHandlerRegistry - Registers domain event handlers
 * @module application/eventHandlers/EventHandlerRegistry
 */

const logger = require('../../logger');
const { PersonalityEventLogger } = require('./PersonalityEventLogger');
const { PersonalityCacheInvalidator } = require('./PersonalityCacheInvalidator');

/**
 * EventHandlerRegistry
 *
 * Central registry for wiring up domain event handlers to the event bus.
 * This implements the "Policy" pattern where business rules react to domain events.
 */
class EventHandlerRegistry {
  /**
   * @param {Object} dependencies
   * @param {DomainEventBus} dependencies.eventBus - The domain event bus
   * @param {Object} dependencies.profileInfoCache - Profile info cache
   * @param {Object} dependencies.messageTracker - Message tracker
   */
  constructor({ eventBus, profileInfoCache, messageTracker }) {
    this.eventBus = eventBus;
    this.profileInfoCache = profileInfoCache;
    this.messageTracker = messageTracker;
    this.subscriptions = [];
  }

  /**
   * Register all event handlers
   */
  registerHandlers() {
    logger.info('[EventHandlerRegistry] Registering domain event handlers');

    // Create handler instances
    const eventLogger = new PersonalityEventLogger();
    const cacheInvalidator = new PersonalityCacheInvalidator({
      profileInfoCache: this.profileInfoCache,
      messageTracker: this.messageTracker,
    });

    // Register PersonalityCreated handlers
    this.subscriptions.push(
      this.eventBus.subscribe('PersonalityCreated', event =>
        eventLogger.handlePersonalityCreated(event)
      )
    );

    // Register PersonalityProfileUpdated handlers
    this.subscriptions.push(
      this.eventBus.subscribe('PersonalityProfileUpdated', event =>
        eventLogger.handlePersonalityProfileUpdated(event)
      )
    );
    this.subscriptions.push(
      this.eventBus.subscribe('PersonalityProfileUpdated', event =>
        cacheInvalidator.handlePersonalityProfileUpdated(event)
      )
    );

    // Register PersonalityRemoved handlers
    this.subscriptions.push(
      this.eventBus.subscribe('PersonalityRemoved', event =>
        eventLogger.handlePersonalityRemoved(event)
      )
    );
    this.subscriptions.push(
      this.eventBus.subscribe('PersonalityRemoved', event =>
        cacheInvalidator.handlePersonalityRemoved(event)
      )
    );

    // Register PersonalityAliasAdded handlers
    this.subscriptions.push(
      this.eventBus.subscribe('PersonalityAliasAdded', event =>
        eventLogger.handlePersonalityAliasAdded(event)
      )
    );
    this.subscriptions.push(
      this.eventBus.subscribe('PersonalityAliasAdded', event =>
        cacheInvalidator.handlePersonalityAliasAdded(event)
      )
    );

    // Register PersonalityAliasRemoved handlers
    this.subscriptions.push(
      this.eventBus.subscribe('PersonalityAliasRemoved', event =>
        eventLogger.handlePersonalityAliasRemoved(event)
      )
    );
    this.subscriptions.push(
      this.eventBus.subscribe('PersonalityAliasRemoved', event =>
        cacheInvalidator.handlePersonalityAliasRemoved(event)
      )
    );

    logger.info(`[EventHandlerRegistry] Registered ${this.subscriptions.length} event handlers`);
  }

  /**
   * Unregister all event handlers
   */
  unregisterHandlers() {
    logger.info('[EventHandlerRegistry] Unregistering domain event handlers');

    // Call all unsubscribe functions
    this.subscriptions.forEach(unsubscribe => unsubscribe());
    this.subscriptions = [];
  }
}

module.exports = { EventHandlerRegistry };
