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
            filename: 'personalities.json',
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
    this.routingStats.newWrites++;
    return this._newRegisterPersonality(name, ownerId, options);
  }

  /**
   * Remove a personality
   * @param {string} name - Personality name
   * @param {string} userId - User requesting removal
   * @returns {Object} Removal result
   */
  async removePersonality(name, userId) {
    this.routingStats.newWrites++;
    return this._newRemovePersonality(name, userId);
  }

  /**
   * Add alias to personality
   * @param {string} personalityName - Personality name
   * @param {string} alias - Alias to add
   * @param {string} userId - User requesting the addition
   * @returns {Object} Result
   */
  async addAlias(personalityName, alias, userId) {
    this.routingStats.newWrites++;
    return this._newAddAlias(personalityName, alias, userId);
  }

  /**
   * List personalities for a specific user
   * @param {string} userId - User ID to list personalities for
   * @returns {Array} Array of personalities owned by the user
   */
  async listPersonalitiesForUser(userId) {
    this.routingStats.newReads++;
    return this._newListPersonalitiesForUser(userId);
  }

  /**
   * Get the maximum word count among all aliases
   * @returns {Promise<number>} The maximum word count
   */
  async getMaxAliasWordCount() {
    this.routingStats.newReads++;
    return this._newGetMaxAliasWordCount();
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

  async _newListPersonalitiesForUser(userId) {
    this._ensurePersonalityService();
    try {
      const personalities = await this.personalityService.listPersonalitiesByOwner(userId);
      return personalities.map(p => this._convertDDDToLegacyFormat(p));
    } catch (error) {
      this.logger.error('[PersonalityRouter] Error in new system listPersonalitiesForUser:', error);
      throw error;
    }
  }

  async _newGetMaxAliasWordCount() {
    this._ensurePersonalityService();
    try {
      return await this.personalityService.getMaxAliasWordCount();
    } catch (error) {
      this.logger.error('[PersonalityRouter] Error in new system getMaxAliasWordCount:', error);
      return 1; // Default to 1 on error
    }
  }

  /**
   * Convert DDD personality format to legacy format
   * @param {Object} dddPersonality - DDD format personality
   * @returns {Object} Legacy format personality
   */
  _convertDDDToLegacyFormat(dddPersonality) {
    // Handle both the direct personality object and the result from repository
    const personality = dddPersonality.profile ? dddPersonality : dddPersonality;

    return {
      fullName: personality.profile?.name || personality.name,
      displayName:
        personality.profile?.displayName || personality.profile?.name || personality.name,
      addedBy: personality.ownerId?.toString ? personality.ownerId.toString() : personality.ownerId,
      owner: personality.ownerId?.toString ? personality.ownerId.toString() : personality.ownerId,
      aliases: personality.aliases?.map(a => a.value || a.alias || a) || [],
      avatarUrl: personality.profile?.avatarUrl,
      errorMessage: personality.profile?.errorMessage,
      nsfwContent: personality.profile?.isNSFW,
      temperature: personality.profile?.temperature,
      maxWordCount: personality.profile?.maxWordCount,
      // createdAt and updatedAt are already ISO strings in DDD
      createdAt: personality.createdAt,
      updatedAt: personality.updatedAt,
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
