/**
 * EventHandlerRegistry - Registers domain event handlers
 * @module application/eventHandlers/EventHandlerRegistry
 */

const logger = require('../../logger');
const { PersonalityEventLogger } = require('./PersonalityEventLogger');
const { PersonalityCacheInvalidator } = require('./PersonalityCacheInvalidator');
const { registerBlacklistEventHandlers } = require('./BlacklistEventHandlers');

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
   * @param {AuthenticationRepository} dependencies.authenticationRepository - Auth repository
   * @param {Object} dependencies.conversationManager - Conversation manager
   */
  constructor({
    eventBus,
    profileInfoCache,
    messageTracker,
    authenticationRepository,
    conversationManager,
  }) {
    this.eventBus = eventBus;
    this.profileInfoCache = profileInfoCache;
    this.messageTracker = messageTracker;
    this.authenticationRepository = authenticationRepository;
    this.conversationManager = conversationManager;
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

    // Register blacklist event handlers
    registerBlacklistEventHandlers({
      eventBus: this.eventBus,
      authenticationRepository: this.authenticationRepository,
      conversationManager: this.conversationManager,
    });

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
