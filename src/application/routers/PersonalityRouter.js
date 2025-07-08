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

// DDD-only PersonalityRouter - no legacy compatibility needed
class PersonalityRouter {
  constructor(options = {}) {
    this.logger = options.logger || logger;

    // PersonalityService will be injected by ApplicationBootstrap
    // Only initialize in tests if needed
    this.personalityService = null;

    // Track routing statistics
    this.routingStats = {
      reads: 0,
      writes: 0,
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
    this.routingStats.reads++;
    return this._getPersonality(nameOrAlias);
  }

  /**
   * Get all personalities
   * @returns {Array} All personalities
   */
  async getAllPersonalities() {
    this.routingStats.reads++;
    return this._getAllPersonalities();
  }

  /**
   * Register a new personality
   * @param {string} name - Personality name
   * @param {string} ownerId - Owner user ID
   * @param {Object} options - Registration options
   * @returns {Object} Registration result
   */
  async registerPersonality(name, ownerId, options = {}) {
    this.routingStats.writes++;
    return this._registerPersonality(name, ownerId, options);
  }

  /**
   * Remove a personality
   * @param {string} name - Personality name
   * @param {string} userId - User requesting removal
   * @returns {Object} Removal result
   */
  async removePersonality(name, userId) {
    this.routingStats.writes++;
    return this._removePersonality(name, userId);
  }

  /**
   * Add alias to personality
   * @param {string} personalityName - Personality name
   * @param {string} alias - Alias to add
   * @param {string} userId - User requesting the addition
   * @returns {Object} Result
   */
  async addAlias(personalityName, alias, userId) {
    this.routingStats.writes++;
    return this._addAlias(personalityName, alias, userId);
  }

  /**
   * List personalities for a specific user
   * @param {string} userId - User ID to list personalities for
   * @returns {Array} Array of personalities owned by the user
   */
  async listPersonalitiesForUser(userId) {
    this.routingStats.reads++;
    return this._listPersonalitiesForUser(userId);
  }

  /**
   * Get the maximum word count among all aliases
   * @returns {Promise<number>} The maximum word count
   */
  async getMaxAliasWordCount() {
    this.routingStats.reads++;
    return this._getMaxAliasWordCount();
  }

  /**
   * Get routing statistics
   * @returns {Object} Statistics
   */
  getRoutingStatistics() {
    return {
      ...this.routingStats,
      dddSystemActive: true,
    };
  }

  // DDD system methods

  async _getPersonality(nameOrAlias) {
    this._ensurePersonalityService();
    try {
      const personality = await this.personalityService.getPersonality(nameOrAlias);
      return personality;
    } catch (error) {
      this.logger.error('[PersonalityRouter] Error in new system getPersonality:', error);
      throw error;
    }
  }

  async _getAllPersonalities() {
    this._ensurePersonalityService();
    try {
      return await this.personalityService.listPersonalities();
    } catch (error) {
      this.logger.error('[PersonalityRouter] Error in new system getAllPersonalities:', error);
      throw error;
    }
  }

  async _registerPersonality(name, ownerId, options) {
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
      personality: result,
    };
  }

  async _removePersonality(name, userId) {
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

  async _addAlias(personalityName, alias, userId) {
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

  async _listPersonalitiesForUser(userId) {
    this._ensurePersonalityService();
    try {
      return await this.personalityService.listPersonalitiesByOwner(userId);
    } catch (error) {
      this.logger.error('[PersonalityRouter] Error in new system listPersonalitiesForUser:', error);
      throw error;
    }
  }

  async _getMaxAliasWordCount() {
    this._ensurePersonalityService();
    try {
      return await this.personalityService.getMaxAliasWordCount();
    } catch (error) {
      this.logger.error('[PersonalityRouter] Error in new system getMaxAliasWordCount:', error);
      return 1; // Default to 1 on error
    }
  }
}

module.exports = {
  PersonalityRouter,
};
