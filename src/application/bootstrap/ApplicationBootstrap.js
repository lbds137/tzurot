/**
 * ApplicationBootstrap - Initializes and wires up the DDD application layer
 * @module application/bootstrap/ApplicationBootstrap
 */

const logger = require('../../logger');
const { DomainEventBus } = require('../../domain/shared/DomainEventBus');
const { PersonalityApplicationService } = require('../services/PersonalityApplicationService');
const {
  FilePersonalityRepository,
} = require('../../adapters/persistence/FilePersonalityRepository');
const {
  FileAuthenticationRepository,
} = require('../../adapters/persistence/FileAuthenticationRepository');
const { HttpAIServiceAdapter } = require('../../adapters/ai/HttpAIServiceAdapter');
const { EventHandlerRegistry } = require('../eventHandlers/EventHandlerRegistry');
const { getFeatureFlags } = require('../services/FeatureFlags');
const { getPersonalityRouter } = require('../routers/PersonalityRouter');
const { getCommandIntegration } = require('../commands/CommandIntegration');
const { getCommandIntegrationAdapter } = require('../../adapters/CommandIntegrationAdapter');

// Import legacy dependencies for event handlers
const profileInfoFetcher = require('../../profileInfoFetcher');
const { messageTracker } = require('../../messageTracker');
const { getInstance: getConversationManager } = require('../../core/conversation');

/**
 * ApplicationBootstrap
 *
 * Responsible for:
 * 1. Creating shared infrastructure (event bus)
 * 2. Initializing application services with shared dependencies
 * 3. Wiring up event handlers
 * 4. Configuring routers and adapters
 */
class ApplicationBootstrap {
  constructor() {
    this.initialized = false;
    this.eventBus = null;
    this.eventHandlerRegistry = null;
    this.applicationServices = {};
  }

  /**
   * Initialize the application layer
   */
  async initialize() {
    if (this.initialized) {
      logger.warn('[ApplicationBootstrap] Already initialized');
      return;
    }

    try {
      logger.info('[ApplicationBootstrap] Starting DDD application layer initialization...');

      // Step 1: Create shared infrastructure
      this.eventBus = new DomainEventBus();
      logger.info('[ApplicationBootstrap] Created shared event bus');

      // Step 2: Create repositories
      const personalityRepository = new FilePersonalityRepository({
        dataPath: './data',
        filename: 'personalities.json',
      });

      const authenticationRepository = new FileAuthenticationRepository({
        dataPath: './data',
        filename: 'auth.json',
      });

      const aiService = new HttpAIServiceAdapter({
        baseUrl: process.env.SERVICE_API_BASE_URL || 'http://localhost:8080',
        apiKey: process.env.SERVICE_API_KEY || 'test-key',
        logger: logger,
      });

      // Step 3: Create application services with shared event bus
      const personalityApplicationService = new PersonalityApplicationService({
        personalityRepository,
        aiService,
        authenticationRepository,
        eventBus: this.eventBus, // Share the same event bus!
      });

      // Create a simple cache interface wrapper for the event handlers
      const profileInfoCache = {
        deleteFromCache: name => profileInfoFetcher.deleteFromCache(name),
      };
      const conversationManager = getConversationManager();

      this.applicationServices = {
        personalityApplicationService,
        conversationManager, // Legacy for now
        profileInfoCache, // Legacy for now
        messageTracker, // Legacy for now
        featureFlags: getFeatureFlags(),
        botPrefix: require('../../../config').botPrefix,
      };

      logger.info('[ApplicationBootstrap] Created application services');

      // Step 4: Wire up event handlers
      if (getFeatureFlags().isEnabled('ddd.events.enabled')) {
        this.eventHandlerRegistry = new EventHandlerRegistry({
          eventBus: this.eventBus,
          profileInfoCache,
          messageTracker,
        });
        this.eventHandlerRegistry.registerHandlers();
        logger.info('[ApplicationBootstrap] Registered domain event handlers');
      } else {
        logger.info('[ApplicationBootstrap] Domain event handlers disabled by feature flag');
      }

      // Step 5: Initialize PersonalityRouter with our application service
      const personalityRouter = getPersonalityRouter();
      // Replace the auto-created service with our properly wired one
      personalityRouter.personalityService = personalityApplicationService;
      logger.info('[ApplicationBootstrap] Configured PersonalityRouter');

      // Step 6: Initialize CommandIntegration with application services
      const commandIntegration = getCommandIntegration();
      await commandIntegration.initialize(this.applicationServices);
      logger.info('[ApplicationBootstrap] Initialized CommandIntegration');

      // Step 7: Initialize CommandIntegrationAdapter
      const commandAdapter = getCommandIntegrationAdapter();
      await commandAdapter.initialize(this.applicationServices);
      logger.info('[ApplicationBootstrap] Initialized CommandIntegrationAdapter');

      this.initialized = true;
      logger.info('[ApplicationBootstrap] ✅ DDD application layer initialization complete');

      // Log active feature flags
      this._logActiveFeatures();
    } catch (error) {
      logger.error('[ApplicationBootstrap] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Shutdown the application layer
   */
  async shutdown() {
    logger.info('[ApplicationBootstrap] Shutting down DDD application layer...');

    // Unregister event handlers
    if (this.eventHandlerRegistry) {
      this.eventHandlerRegistry.unregisterHandlers();
    }

    // Clear event bus
    if (this.eventBus) {
      this.eventBus.clear();
    }

    this.initialized = false;
    logger.info('[ApplicationBootstrap] Shutdown complete');
  }

  /**
   * Get application services
   */
  getApplicationServices() {
    if (!this.initialized) {
      throw new Error('ApplicationBootstrap not initialized');
    }
    return this.applicationServices;
  }

  /**
   * Get event bus
   */
  getEventBus() {
    if (!this.initialized) {
      throw new Error('ApplicationBootstrap not initialized');
    }
    return this.eventBus;
  }

  /**
   * Log active DDD features
   */
  _logActiveFeatures() {
    const featureFlags = getFeatureFlags();
    const features = {
      Commands: featureFlags.isEnabled('ddd.commands.enabled'),
      'Personality Read': featureFlags.isEnabled('ddd.personality.read'),
      'Personality Write': featureFlags.isEnabled('ddd.personality.write'),
      'Dual Write': featureFlags.isEnabled('ddd.personality.dual-write'),
      Events: featureFlags.isEnabled('ddd.events.enabled'),
      'Comparison Testing': featureFlags.isEnabled('features.comparison-testing'),
    };

    logger.info('[ApplicationBootstrap] Active DDD features:');
    Object.entries(features).forEach(([name, enabled]) => {
      logger.info(`  - ${name}: ${enabled ? '✅' : '❌'}`);
    });
  }
}

// Singleton instance
let instance = null;

/**
 * Get the application bootstrap singleton
 */
function getApplicationBootstrap() {
  if (!instance) {
    instance = new ApplicationBootstrap();
  }
  return instance;
}

/**
 * Reset bootstrap (for testing)
 */
function resetApplicationBootstrap() {
  if (instance) {
    instance
      .shutdown()
      .catch(err => logger.error('[ApplicationBootstrap] Error during reset shutdown:', err));
  }
  instance = null;
}

module.exports = {
  ApplicationBootstrap,
  getApplicationBootstrap,
  resetApplicationBootstrap,
};
