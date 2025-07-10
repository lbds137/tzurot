/**
 * ApplicationBootstrap - Initializes and wires up the DDD application layer
 * @module application/bootstrap/ApplicationBootstrap
 */

const logger = require('../../logger');
const { DomainEventBus } = require('../../domain/shared/DomainEventBus');
const { PersonalityApplicationService } = require('../services/PersonalityApplicationService');
const RequestTrackingService = require('../services/RequestTrackingService');
const {
  FilePersonalityRepository,
} = require('../../adapters/persistence/FilePersonalityRepository');
const {
  FileAuthenticationRepository,
} = require('../../adapters/persistence/FileAuthenticationRepository');
const { HttpAIServiceAdapter } = require('../../adapters/ai/HttpAIServiceAdapter');
const { EventHandlerRegistry } = require('../eventHandlers/EventHandlerRegistry');
const { createFeatureFlags } = require('../services/FeatureFlags');
const { PersonalityRouter } = require('../routers/PersonalityRouter');
const { getCommandIntegrationAdapter } = require('../../adapters/CommandIntegrationAdapter');

// Import legacy dependencies for event handlers
const profileInfoFetcher = require('../../profileInfoFetcher');
const { messageTracker } = require('../../messageTracker');
const { getInstance: getConversationManager } = require('../../core/conversation');
const avatarStorage = require('../../utils/avatarStorage');
const messageHandlerConfig = require('../../config/MessageHandlerConfig');

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
  constructor(options = {}) {
    this.initialized = false;
    this.eventBus = null;
    this.eventHandlerRegistry = null;
    this.applicationServices = {};
    this.authManager = null;

    // Create feature flags instance - can be overridden for testing
    this.featureFlags = options.featureFlags || createFeatureFlags();

    // Injectable delay function for testability
    this.delay =
      options.delay ||
      (ms => {
        const timer = globalThis.setTimeout || setTimeout;
        return new Promise(resolve => timer(resolve, ms));
      });
  }

  /**
   * Set the auth manager instance
   * @param {Object} authManagerInstance - The auth manager instance
   */
  setAuthManager(authManagerInstance) {
    this.authManager = authManagerInstance;
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

      // Initialize avatar storage system (needed for webhook profile pictures)
      logger.info('[ApplicationBootstrap] Initializing avatar storage system...');
      await avatarStorage.initialize();
      logger.info('[ApplicationBootstrap] Avatar storage initialized successfully');

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

      // Create request tracking service for duplicate protection
      const requestTrackingService = new RequestTrackingService({
        pendingWindowMs: 10000, // 10 seconds
        completedWindowMs: 5000, // 5 seconds
        cleanupIntervalMs: 60000, // 1 minute
      });

      // Create a simple cache interface wrapper for the event handlers
      const profileInfoCache = {
        deleteFromCache: name => profileInfoFetcher.deleteFromCache(name),
      };
      const conversationManager = getConversationManager();

      const webhookUserTracker = require('../../utils/webhookUserTracker');
      const channelUtils = require('../../utils/channelUtils');

      this.applicationServices = {
        personalityApplicationService,
        requestTrackingService, // New duplicate protection service
        conversationManager, // Legacy for now
        profileInfoCache, // Legacy for now
        messageTracker, // Legacy for now
        featureFlags: this.featureFlags,
        botPrefix: require('../../../config').botPrefix,
        auth: this.authManager, // Use injected auth manager (renamed key for consistency)
        authManager: this.authManager, // Keep legacy key for backward compatibility
        webhookUserTracker, // Legacy webhook tracker for authentication commands
        channelUtils, // Legacy channel utilities for verification commands
        authenticationRepository, // DDD repository for future use
      };

      logger.info('[ApplicationBootstrap] Created application services');

      // Step 3.5: Initialize message handler configuration
      // This needs to happen before any handlers are created
      try {
        const maxAliasWordCount = await personalityApplicationService.getMaxAliasWordCount();
        messageHandlerConfig.setMaxAliasWordCount(maxAliasWordCount);
        logger.info(`[ApplicationBootstrap] Set max alias word count: ${maxAliasWordCount}`);
      } catch (configError) {
        logger.warn('[ApplicationBootstrap] Failed to set max alias word count, using default:', configError.message);
      }

      // Step 4: Wire up event handlers
      this.eventHandlerRegistry = new EventHandlerRegistry({
        eventBus: this.eventBus,
        profileInfoCache,
        messageTracker,
      });
      this.eventHandlerRegistry.registerHandlers();
      logger.info('[ApplicationBootstrap] Registered domain event handlers');

      // Step 5: Initialize PersonalityRouter with our application service
      const personalityRouter = new PersonalityRouter();
      personalityRouter.personalityService = personalityApplicationService;
      logger.info('[ApplicationBootstrap] Configured PersonalityRouter');

      // Store the router instance for other components to use
      this.personalityRouter = personalityRouter;

      // Set the router in aliasResolver to avoid circular dependency
      const aliasResolver = require('../../utils/aliasResolver');
      aliasResolver.setPersonalityRouter(personalityRouter);
      logger.info('[ApplicationBootstrap] Set PersonalityRouter in aliasResolver');

      // Step 6: Initialize CommandIntegrationAdapter (it will initialize CommandIntegration internally)
      const commandAdapter = getCommandIntegrationAdapter();
      await commandAdapter.initialize(this.applicationServices);
      logger.info('[ApplicationBootstrap] Initialized CommandIntegrationAdapter');

      // Step 7: Initialize repositories to trigger migration if needed
      logger.info('[ApplicationBootstrap] Initializing repositories...');
      await personalityRepository.initialize();
      await authenticationRepository.initialize();

      // Step 8: Schedule owner personality seeding in background (don't block initialization)
      this.initialized = true;
      logger.info('[ApplicationBootstrap] ✅ DDD application layer initialization complete');

      // Schedule personality seeding in background after a delay
      // The _seedOwnerPersonalities method will check feature flags internally
      const seedingDelay = 5000; // 5 seconds to let bot fully start

      // Create a promise-based delay and execute seeding after it
      this.delay(seedingDelay).then(async () => {
        try {
          logger.info('[ApplicationBootstrap] Starting background owner personality seeding...');
          await this._seedOwnerPersonalities();
          logger.info('[ApplicationBootstrap] Background owner personality seeding completed');
        } catch (error) {
          logger.error('[ApplicationBootstrap] Error in background personality seeding:', error);
        }
      });

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

    // Stop request tracking service cleanup timer
    if (this.applicationServices?.requestTrackingService) {
      this.applicationServices.requestTrackingService.stopCleanup();
    }

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
   * Get personality router
   */
  getPersonalityRouter() {
    if (!this.initialized) {
      throw new Error('ApplicationBootstrap not initialized');
    }
    return this.personalityRouter;
  }

  /**
   * Seed owner personalities using DDD system when enabled, legacy system otherwise
   * @private
   */
  async _seedOwnerPersonalities() {
    try {
      // Get owner configuration from environment
      const ownerId = process.env.BOT_OWNER_ID;
      const personalitiesStr = process.env.BOT_OWNER_PERSONALITIES;

      if (!ownerId) {
        logger.info(
          '[ApplicationBootstrap] No BOT_OWNER_ID configured, skipping personality seeding'
        );
        return;
      }

      if (!personalitiesStr) {
        logger.info(
          '[ApplicationBootstrap] No BOT_OWNER_PERSONALITIES configured, skipping personality seeding'
        );
        return;
      }

      const personalityNames = personalitiesStr.split(',').map(p => p.trim());
      logger.info(`[ApplicationBootstrap] Checking ${personalityNames.length} owner personalities`);

      // Use DDD PersonalityApplicationService for seeding (legacy system removed)
      logger.info('[ApplicationBootstrap] Using DDD PersonalityApplicationService for seeding');
      await this._seedOwnerPersonalitiesWithDDD(ownerId, personalityNames);
    } catch (error) {
      // Don't fail initialization if seeding fails
      logger.error('[ApplicationBootstrap] Error seeding owner personalities:', error);
    }
  }

  /**
   * Seed owner personalities using DDD PersonalityApplicationService
   * @private
   * @param {string} ownerId - Bot owner ID
   * @param {string[]} personalityNames - List of personality names to seed
   */
  async _seedOwnerPersonalitiesWithDDD(ownerId, personalityNames) {
    const personalityService = this.applicationServices.personalityApplicationService;

    // Get existing personalities for the owner
    const ownerPersonalities = await personalityService.listPersonalitiesByOwner(ownerId);
    const existingNames = ownerPersonalities.map(p => p.profile.name.toLowerCase());

    const personalitiesToAdd = personalityNames.filter(
      name => !existingNames.includes(name.toLowerCase())
    );

    if (personalitiesToAdd.length === 0) {
      logger.info(
        `[ApplicationBootstrap] Owner has all ${personalityNames.length} expected personalities`
      );
      return;
    }

    logger.info(
      `[ApplicationBootstrap] Owner has ${ownerPersonalities.length} personalities, missing ${personalitiesToAdd.length}`
    );
    logger.info('[ApplicationBootstrap] Starting DDD personality seeding for missing entries...');

    let successCount = 0;

    for (const personalityName of personalitiesToAdd) {
      try {
        // Register using DDD service with external mode (fetches from API)
        const personality = await personalityService.registerPersonality({
          name: personalityName,
          ownerId: ownerId,
          mode: 'external', // This triggers API profile fetching
        });

        if (personality) {
          logger.info(`[ApplicationBootstrap] Successfully seeded via DDD: ${personalityName}`);
          successCount++;
        }

        // Small delay to avoid rate limiting
        await this.delay(100);
      } catch (error) {
        logger.error(
          `[ApplicationBootstrap] Failed to seed ${personalityName} via DDD: ${error.message}`
        );
      }
    }

    if (successCount > 0) {
      logger.info(`[ApplicationBootstrap] Seeded ${successCount} owner personalities via DDD`);
    }
  }

  /**
   * Log active DDD features
   */
  _logActiveFeatures() {
    logger.info('[ApplicationBootstrap] DDD system fully active:');
    logger.info('  - Commands: ✅');
    logger.info('  - Personality Read: ✅');
    logger.info('  - Personality Write: ✅');
    logger.info('  - Events: ✅');
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
