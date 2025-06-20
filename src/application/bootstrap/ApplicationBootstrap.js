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
const { getCommandIntegrationAdapter } = require('../../adapters/CommandIntegrationAdapter');

// Import legacy dependencies for event handlers
const profileInfoFetcher = require('../../profileInfoFetcher');
const { messageTracker } = require('../../messageTracker');
const { getInstance: getConversationManager } = require('../../core/conversation');

// Import legacy PersonalityManager for seeding compatibility
const PersonalityManager = require('../../core/personality/PersonalityManager');

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

      // Import legacy auth service for commands
      const auth = require('../../auth');
      const webhookUserTracker = require('../../utils/webhookUserTracker');
      const channelUtils = require('../../utils/channelUtils');

      this.applicationServices = {
        personalityApplicationService,
        conversationManager, // Legacy for now
        profileInfoCache, // Legacy for now
        messageTracker, // Legacy for now
        featureFlags: getFeatureFlags(),
        botPrefix: require('../../../config').botPrefix,
        auth, // Legacy auth service for authentication commands
        webhookUserTracker, // Legacy webhook tracker for authentication commands
        channelUtils, // Legacy channel utilities for verification commands
        authenticationRepository, // DDD repository for future use
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

      // Check if DDD personality system is enabled
      const featureFlags = getFeatureFlags();
      const useDDD = featureFlags.isEnabled('ddd.personality.write');

      if (useDDD) {
        logger.info('[ApplicationBootstrap] Using DDD PersonalityApplicationService for seeding');
        await this._seedOwnerPersonalitiesWithDDD(ownerId, personalityNames);
      } else {
        logger.info('[ApplicationBootstrap] Using legacy PersonalityManager for seeding');
        await this._seedOwnerPersonalitiesWithLegacy(ownerId, personalityNames);
      }
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
   * Seed owner personalities using legacy PersonalityManager
   * @private
   * @param {string} ownerId - Bot owner ID
   * @param {string[]} personalityNames - List of personality names to seed
   */
  async _seedOwnerPersonalitiesWithLegacy(ownerId, personalityNames) {
    // Use the legacy PersonalityManager for seeding to ensure compatibility with commands
    const legacyManager = PersonalityManager.getInstance();

    // Initialize legacy manager if not already done
    if (!legacyManager.initialized) {
      logger.info('[ApplicationBootstrap] Initializing legacy PersonalityManager for seeding...');
      await legacyManager.initialize(true, { skipBackgroundSeeding: true });
    }

    // Check existing personalities for the owner
    const existingPersonalities = legacyManager.listPersonalitiesForUser(ownerId);
    const existingNames = existingPersonalities.map(p => p.fullName.toLowerCase());

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
      `[ApplicationBootstrap] Owner has ${existingPersonalities.length} personalities, missing ${personalitiesToAdd.length}`
    );
    logger.info(
      '[ApplicationBootstrap] Starting legacy personality seeding for missing entries...'
    );

    // Add missing personalities using legacy system
    let successCount = 0;

    for (const personalityName of personalitiesToAdd) {
      try {
        // Register using legacy system with fetchInfo enabled
        const result = await legacyManager.registerPersonality(personalityName, ownerId, {
          fetchInfo: true, // This fetches avatarUrl, displayName, and errorMessage from API
        });

        if (result.success) {
          logger.info(`[ApplicationBootstrap] Successfully seeded via legacy: ${personalityName}`);
          successCount++;
        } else {
          logger.error(`[ApplicationBootstrap] Failed to seed ${personalityName}: ${result.error}`);
        }

        // Small delay to avoid rate limiting
        await this.delay(100);
      } catch (error) {
        logger.error(`[ApplicationBootstrap] Failed to seed ${personalityName}: ${error.message}`);
      }
    }

    if (successCount > 0) {
      logger.info(`[ApplicationBootstrap] Seeded ${successCount} owner personalities via legacy`);
    }
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
