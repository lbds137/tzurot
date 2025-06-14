const { PersonalityApplicationService } = require('../services/PersonalityApplicationService');
const {
  FilePersonalityRepository,
} = require('../../adapters/persistence/FilePersonalityRepository');
const {
  FileAuthenticationRepository,
} = require('../../adapters/persistence/FileAuthenticationRepository');
const { HttpAIServiceAdapter } = require('../../adapters/ai/HttpAIServiceAdapter');
const { DomainEventBus } = require('../../domain/shared/DomainEventBus');
const logger = require('../../logger');

// Legacy system removed - using DDD only

/**
 * Router that directs personality operations to either legacy or new DDD system
 * based on feature flags. Supports comparison testing and dual-write patterns.
 */
class PersonalityRouter {
  constructor(options = {}) {
    this.logger = options.logger || logger;

    // PersonalityService will be injected by ApplicationBootstrap
    // Only initialize in tests if needed
    this.personalityService = null;

    // Track routing statistics
    this.routingStats = {
      legacyReads: 0,
      newReads: 0,
      legacyWrites: 0,
      newWrites: 0,
      dualWrites: 0,
      comparisonTests: 0,
    };
  }

  /**
   * Initialize DDD system components (for testing only)
   */
  _initializeDDDSystem() {
    if (!this.personalityService) {
      // Check if we're in test environment with mocked constructors
      const isMocked = typeof FilePersonalityRepository.mockImplementation === 'function';

      const repository = isMocked
        ? {}
        : new FilePersonalityRepository({
            dataPath: './data',
            filename: 'ddd-personalities.json',
          });

      const authRepository = isMocked
        ? {}
        : new FileAuthenticationRepository({
            dataPath: './data',
            filename: 'auth.json',
          });

      const aiService = isMocked
        ? {}
        : new HttpAIServiceAdapter({
            baseUrl: process.env.SERVICE_API_BASE_URL || 'http://localhost:8080',
            apiKey: process.env.SERVICE_API_KEY || 'test-key',
            logger: this.logger,
          });

      const eventBus = isMocked ? {} : new DomainEventBus();

      this.personalityService = new PersonalityApplicationService({
        personalityRepository: repository,
        aiService: aiService,
        authenticationRepository: authRepository,
        eventBus: eventBus,
      });
    }
  }

  /**
   * Ensure personalityService is initialized
   * @private
   */
  _ensurePersonalityService() {
    if (!this.personalityService) {
      // In production, personalityService should be injected by ApplicationBootstrap
      // This is only for tests that don't use ApplicationBootstrap
      this._initializeDDDSystem();

      // If still not initialized, throw an error
      if (!this.personalityService) {
        throw new Error(
          'PersonalityService not initialized. ApplicationBootstrap must be initialized first.'
        );
      }
    }
  }

  /**
   * Get personality by name or alias
   * @param {string} nameOrAlias - Personality name or alias
   * @returns {Object|null} Personality data
   */
  async getPersonality(nameOrAlias) {
    this.routingStats.newReads++;
    return this._newGetPersonality(nameOrAlias);
  }

  /**
   * Get all personalities
   * @returns {Array} All personalities
   */
  async getAllPersonalities() {
    this.routingStats.newReads++;
    return this._newGetAllPersonalities();
  }


  /**
   * Register a new personality
   * @param {string} name - Personality name
   * @param {string} ownerId - Owner user ID
   * @param {Object} options - Registration options
   * @returns {Object} Registration result
   */
  async registerPersonality(name, ownerId, options = {}) {
    const useNewSystem = this.featureFlags.isEnabled('ddd.personality.write');
    const useDualWrite = this.featureFlags.isEnabled('ddd.personality.dual-write');
    const runComparison = this.featureFlags.isEnabled('features.comparison-testing');

    if (useDualWrite) {
      // Write to both systems
      this.routingStats.dualWrites++;

      // Write to legacy first (it's the source of truth during migration)
      const legacyResult = await this._legacyRegisterPersonality(name, ownerId, options);

      // Then write to new system
      try {
        await this._newRegisterPersonality(name, ownerId, options);
      } catch (error) {
        this.logger.error('[PersonalityRouter] Dual-write to new system failed:', error);
        // Don't fail the operation if new system fails during migration
      }

      return legacyResult;
    }

    if (runComparison) {
      this.routingStats.comparisonTests++;

      const result = await this.comparisonTester.compare(
        'registerPersonality',
        () => this._legacyRegisterPersonality(name, ownerId, options),
        () => this._newRegisterPersonality(name, ownerId, options),
        {
          ignoreFields: ['_internalId', 'createdAt'],
          compareTimestamps: false,
        }
      );

      return useNewSystem ? result.newResult : result.legacyResult;
    }

    if (useNewSystem) {
      this.routingStats.newWrites++;
      return this._newRegisterPersonality(name, ownerId, options);
    } else {
      this.routingStats.legacyWrites++;
      return this._legacyRegisterPersonality(name, ownerId, options);
    }
  }

  /**
   * Remove a personality
   * @param {string} name - Personality name
   * @param {string} userId - User requesting removal
   * @returns {Object} Removal result
   */
  async removePersonality(name, userId) {
    const useNewSystem = this.featureFlags.isEnabled('ddd.personality.write');
    const useDualWrite = this.featureFlags.isEnabled('ddd.personality.dual-write');

    if (useDualWrite) {
      this.routingStats.dualWrites++;

      // Remove from legacy first
      const legacyResult = await this._legacyRemovePersonality(name, userId);

      // Then remove from new system
      try {
        await this._newRemovePersonality(name, userId);
      } catch (error) {
        this.logger.error('[PersonalityRouter] Dual-write removal from new system failed:', error);
      }

      return legacyResult;
    }

    if (useNewSystem) {
      this.routingStats.newWrites++;
      return this._newRemovePersonality(name, userId);
    } else {
      this.routingStats.legacyWrites++;
      return this._legacyRemovePersonality(name, userId);
    }
  }

  /**
   * Add alias to personality
   * @param {string} personalityName - Personality name
   * @param {string} alias - Alias to add
   * @param {string} userId - User requesting the addition
   * @returns {Object} Result
   */
  async addAlias(personalityName, alias, userId) {
    const useNewSystem = this.featureFlags.isEnabled('ddd.personality.write');
    const useDualWrite = this.featureFlags.isEnabled('ddd.personality.dual-write');

    if (useDualWrite) {
      this.routingStats.dualWrites++;

      const legacyResult = await this._legacyAddAlias(personalityName, alias, userId);

      try {
        await this._newAddAlias(personalityName, alias, userId);
      } catch (error) {
        this.logger.error(
          '[PersonalityRouter] Dual-write alias addition to new system failed:',
          error
        );
      }

      return legacyResult;
    }

    if (useNewSystem) {
      this.routingStats.newWrites++;
      return this._newAddAlias(personalityName, alias, userId);
    } else {
      this.routingStats.legacyWrites++;
      return this._legacyAddAlias(personalityName, alias, userId);
    }
  }

  /**
   * Get routing statistics
   * @returns {Object} Statistics
   */
  getRoutingStatistics() {
    return {
      ...this.routingStats,
      dddSystemActive: true, // Always true now
      comparisonTestingActive: false,
      dualWriteActive: false,
    };
  }


  // New DDD system wrappers

  async _newGetPersonality(nameOrAlias) {
    this._ensurePersonalityService();
    try {
      const personality = await this.personalityService.getPersonality(nameOrAlias);
      if (personality) {
        return this._convertDDDToLegacyFormat(personality);
      }
      return null;
    } catch (error) {
      this.logger.error('[PersonalityRouter] Error in new system getPersonality:', error);
      throw error;
    }
  }

  async _newGetAllPersonalities() {
    this._ensurePersonalityService();
    try {
      const personalities = await this.personalityService.listPersonalities();
      return personalities.map(p => this._convertDDDToLegacyFormat(p));
    } catch (error) {
      this.logger.error('[PersonalityRouter] Error in new system getAllPersonalities:', error);
      throw error;
    }
  }

  async _newRegisterPersonality(name, ownerId, options) {
    this._ensurePersonalityService();
    // Map legacy options to DDD command format
    const command = {
      name,
      ownerId,
      prompt: options.prompt || `You are ${name}`,
      modelPath: options.modelPath || '/default',
      maxWordCount: options.maxWordCount || 1000,
      aliases: options.aliases || [],
    };

    const result = await this.personalityService.registerPersonality(command);

    return {
      success: true,
      personality: this._convertDDDToLegacyFormat(result),
    };
  }

  async _newRemovePersonality(name, userId) {
    this._ensurePersonalityService();
    try {
      await this.personalityService.removePersonality({
        personalityName: name,
        requesterId: userId,
      });
      return {
        success: true,
        message: `Personality ${name} removed successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async _newAddAlias(personalityName, alias, userId) {
    this._ensurePersonalityService();
    try {
      await this.personalityService.addAlias({
        personalityName,
        alias,
        requesterId: userId,
      });
      return {
        success: true,
        message: `Alias ${alias} added successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Convert DDD personality format to legacy format
   * @param {Object} dddPersonality - DDD format personality
   * @returns {Object} Legacy format personality
   */
  _convertDDDToLegacyFormat(dddPersonality) {
    return {
      fullName: dddPersonality.name,
      displayName: dddPersonality.profile.displayName || dddPersonality.name,
      owner: dddPersonality.ownerId,
      aliases: dddPersonality.aliases.map(a => a.alias),
      avatarUrl: dddPersonality.profile.avatarUrl,
      nsfwContent: dddPersonality.profile.isNSFW,
      temperature: dddPersonality.profile.temperature,
      maxWordCount: dddPersonality.profile.maxWordCount,
      createdAt: dddPersonality.createdAt?.toISOString(),
      updatedAt: dddPersonality.updatedAt?.toISOString(),
    };
  }
}

// Singleton instance
let instance = null;

/**
 * Get the personality router instance
 * @param {Object} options - Optional configuration
 * @returns {PersonalityRouter}
 */
function getPersonalityRouter(options) {
  if (!instance) {
    instance = new PersonalityRouter(options);
  }
  return instance;
}

/**
 * Reset the personality router instance (mainly for testing)
 */
function resetPersonalityRouter() {
  instance = null;
}

module.exports = {
  PersonalityRouter,
  getPersonalityRouter,
  resetPersonalityRouter,
};
