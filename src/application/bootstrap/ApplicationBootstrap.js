/**
 * ApplicationBootstrap - Initializes and wires up the DDD application layer
 * @module application/bootstrap/ApplicationBootstrap
 */

const logger = require('../../logger');
const { DomainEventBus } = require('../../domain/shared/DomainEventBus');
const { PersonalityApplicationService } = require('../services/PersonalityApplicationService');
const {
  AuthenticationApplicationService,
} = require('../services/AuthenticationApplicationService');
const { BlacklistService } = require('../services/BlacklistService');
const RequestTrackingService = require('../services/RequestTrackingService');
const {
  FilePersonalityRepository,
} = require('../../adapters/persistence/FilePersonalityRepository');
const {
  FileAuthenticationRepository,
} = require('../../adapters/persistence/FileAuthenticationRepository');
const { FileBlacklistRepository } = require('../../adapters/persistence/FileBlacklistRepository');
const { HttpAIServiceAdapter } = require('../../adapters/ai/HttpAIServiceAdapter');
const { OAuthTokenService } = require('../../infrastructure/authentication/OAuthTokenService');
const { EventHandlerRegistry } = require('../eventHandlers/EventHandlerRegistry');
const { createFeatureFlags } = require('../services/FeatureFlags');
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

      const blacklistRepository = new FileBlacklistRepository({
        dataPath: './data',
        filename: 'blacklist.json',
      });

      const aiService = new HttpAIServiceAdapter({
        baseUrl: process.env.SERVICE_API_BASE_URL || 'http://localhost:8080',
        apiKey: process.env.SERVICE_API_KEY || 'test-key',
        logger: logger,
      });

      // Step 3: Create authentication services
      const tokenService = new OAuthTokenService({
        appId: process.env.SERVICE_APP_ID,
        apiKey: process.env.SERVICE_API_KEY,
        authApiEndpoint: `${process.env.SERVICE_API_BASE_URL}/auth`,
        authWebsite: process.env.SERVICE_WEBSITE,
        serviceApiBaseUrl: process.env.SERVICE_API_BASE_URL,
      });

      const authenticationApplicationService = new AuthenticationApplicationService({
        authenticationRepository,
        tokenService,
        eventBus: this.eventBus,
        config: {
          ownerId: process.env.BOT_OWNER_ID,
        },
      });

      // Use the DDD authentication service directly
      const authService = authenticationApplicationService;

      // Create blacklist service
      const blacklistService = new BlacklistService({
        blacklistRepository,
        eventBus: this.eventBus,
      });

      // Step 4: Create application services with shared event bus
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
        authenticationApplicationService, // DDD auth service
        authenticationService: authService, // DDD authentication service
        blacklistService, // Global blacklist service
        requestTrackingService, // Duplicate protection service
        conversationManager, // Legacy for now
        profileInfoCache, // Legacy for now
        messageTracker, // Legacy for now
        featureFlags: this.featureFlags,
        botPrefix: require('../../../config').botPrefix,
        auth: authService, // DDD authentication service
        webhookUserTracker, // Legacy webhook tracker for authentication commands
        channelUtils, // Legacy channel utilities for verification commands
        authenticationRepository, // DDD repository
      };

      logger.info('[ApplicationBootstrap] Created application services');

      // Step 5: Initialize message handler configuration
      // This needs to happen before any handlers are created
      try {
        const maxAliasWordCount = await personalityApplicationService.getMaxAliasWordCount();
        messageHandlerConfig.setMaxAliasWordCount(maxAliasWordCount);
        logger.info(`[ApplicationBootstrap] Set max alias word count: ${maxAliasWordCount}`);
      } catch (configError) {
        logger.warn(
          '[ApplicationBootstrap] Failed to set max alias word count, using default:',
          configError.message
        );
      }

      // Step 6: Wire up event handlers
      this.eventHandlerRegistry = new EventHandlerRegistry({
        eventBus: this.eventBus,
        profileInfoCache,
        messageTracker,
        authenticationRepository,
        conversationManager,
      });
      this.eventHandlerRegistry.registerHandlers();
      logger.info('[ApplicationBootstrap] Registered domain event handlers');

      // Step 7: Set PersonalityApplicationService in aliasResolver to avoid circular dependency
      const aliasResolver = require('../../utils/aliasResolver');
      aliasResolver.setPersonalityService(personalityApplicationService);
      logger.info('[ApplicationBootstrap] Set PersonalityApplicationService in aliasResolver');

      // Step 8: Initialize CommandIntegrationAdapter (it will initialize CommandIntegration internally)
      const commandAdapter = getCommandIntegrationAdapter();
      await commandAdapter.initialize(this.applicationServices);
      logger.info('[ApplicationBootstrap] Initialized CommandIntegrationAdapter');

      // Step 9: Initialize repositories to trigger migration if needed
      logger.info('[ApplicationBootstrap] Initializing repositories...');
      await personalityRepository.initialize();
      await authenticationRepository.initialize();
      await blacklistRepository.initialize();

      // Step 9.5: Update max alias word count after personalities are loaded from disk
      try {
        const updatedMaxWordCount = await personalityApplicationService.getMaxAliasWordCount();
        messageHandlerConfig.setMaxAliasWordCount(updatedMaxWordCount);
        logger.info(`[ApplicationBootstrap] Updated max alias word count after loading personalities: ${updatedMaxWordCount}`);
      } catch (configError) {
        logger.error('[ApplicationBootstrap] Failed to update max alias word count:', configError);
        // Continue with existing config value
      }

      // Step 10: Schedule owner personality seeding in background (don't block initialization)
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
   * Get personality application service
   * @returns {PersonalityApplicationService}
   */
  getPersonalityApplicationService() {
    if (!this.initialized) {
      throw new Error('ApplicationBootstrap not initialized');
    }
    return this.applicationServices.personalityApplicationService;
  }

  /**
   * Get blacklist service
   */
  getBlacklistService() {
    if (!this.initialized) {
      throw new Error('ApplicationBootstrap not initialized');
    }
    return this.applicationServices.blacklistService;
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
