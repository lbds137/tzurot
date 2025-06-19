const logger = require('../../logger');
const {
  Personality,
  PersonalityId,
  PersonalityProfile,
  UserId,
  Alias,
} = require('../../domain/personality');
const { AIModel } = require('../../domain/ai');
const { DomainEventBus } = require('../../domain/shared');
const profileInfoFetcher = require('../../profileInfoFetcher');

/**
 * PersonalityApplicationService
 *
 * Orchestrates personality-related operations, coordinating between
 * domain models, repositories, and external services.
 *
 * This service implements the Application Service pattern from DDD,
 * handling use cases and transaction boundaries.
 */
class PersonalityApplicationService {
  /**
   * @param {Object} dependencies
   * @param {PersonalityRepository} dependencies.personalityRepository
   * @param {AIService} dependencies.aiService
   * @param {AuthenticationRepository} dependencies.authenticationRepository
   * @param {DomainEventBus} dependencies.eventBus
   * @param {Object} [dependencies.profileFetcher] - Profile info fetcher for external API
   */
  constructor({
    personalityRepository,
    aiService,
    authenticationRepository,
    eventBus = new DomainEventBus(),
    profileFetcher = profileInfoFetcher,
  }) {
    if (!personalityRepository) {
      throw new Error('PersonalityRepository is required');
    }
    if (!aiService) {
      throw new Error('AIService is required');
    }
    if (!authenticationRepository) {
      throw new Error('AuthenticationRepository is required');
    }

    this.personalityRepository = personalityRepository;
    this.aiService = aiService;
    this.authenticationRepository = authenticationRepository;
    this.eventBus = eventBus;
    this.profileFetcher = profileFetcher;
  }

  /**
   * Register a new personality
   * @param {Object} command
   * @param {string} command.name - Personality name
   * @param {string} command.ownerId - Owner's Discord user ID
   * @param {string} [command.mode='external'] - 'external' for API-based or 'local' for self-managed
   * @param {string} [command.prompt] - Personality prompt (local mode only)
   * @param {string} [command.modelPath] - AI model path (local mode only)
   * @param {number} [command.maxWordCount] - Maximum word count
   * @param {string[]} [command.aliases] - Initial aliases
   * @returns {Promise<Personality>}
   */
  async registerPersonality(command) {
    try {
      const {
        name,
        ownerId,
        mode = 'external',
        prompt,
        modelPath,
        maxWordCount,
        aliases = [],
      } = command;

      logger.info(`[PersonalityApplicationService] Registering ${mode} personality: ${name}`);

      // Validate the personality doesn't already exist
      const existingPersonality = await this.personalityRepository.findByName(name);
      if (existingPersonality) {
        throw new Error(`Personality "${name}" already exists`);
      }

      // Validate aliases don't conflict
      for (const alias of aliases) {
        const aliasConflict = await this.personalityRepository.findByAlias(alias);
        if (aliasConflict) {
          throw new Error(`Alias "${alias}" is already in use by ${aliasConflict.profile.name}`);
        }
      }

      // Create personality based on mode
      const personalityId = PersonalityId.fromString(name); // Use name as ID for simpler lookups
      const userId = new UserId(ownerId);

      let personality;
      if (mode === 'external') {
        // External mode - fetch profile from API immediately
        let profile;

        // Try to fetch profile data from API
        if (this.profileFetcher) {
          try {
            const apiData = await this.profileFetcher.fetchProfileInfo(name);
            if (apiData) {
              profile = PersonalityProfile.fromApiResponse(apiData);
              logger.info(
                `[PersonalityApplicationService] Fetched profile data from API for: ${name}`
              );
            }
          } catch (error) {
            logger.warn(
              `[PersonalityApplicationService] Failed to fetch profile from API: ${error.message}`
            );
          }
        }

        // Fallback to basic external profile if fetch failed
        if (!profile) {
          profile = new PersonalityProfile({
            mode: 'external',
            name: name,
            displayName: name,
          });
        }

        // For external mode, we don't need AI model
        const model = AIModel.createDefault();
        personality = Personality.create(personalityId, userId, profile, model);
      } else {
        // Local mode - requires full configuration
        if (!prompt || !modelPath) {
          throw new Error('Local personalities require prompt and modelPath');
        }

        const profile = new PersonalityProfile({
          mode: 'local',
          name: name,
          user_prompt: prompt,
          engine_model: modelPath,
          maxWordCount: maxWordCount,
        });
        const model = await this._resolveAIModel(modelPath);
        personality = Personality.create(personalityId, userId, profile, model);
      }

      // Add aliases if provided
      for (const aliasName of aliases) {
        const alias = new Alias(aliasName);
        personality.addAlias(alias);
      }

      // Save to repository
      await this.personalityRepository.save(personality);

      // For external personalities, automatically add display name as an alias if it differs from the full name
      if (mode === 'external' && personality.profile && personality.profile.displayName) {
        const displayNameLower = personality.profile.displayName.toLowerCase();
        const fullNameLower = name.toLowerCase();

        if (displayNameLower !== fullNameLower && !aliases.includes(displayNameLower)) {
          try {
            // Add the display name as an alias
            const alias = new Alias(displayNameLower);
            personality.addAlias(alias);
            await this.personalityRepository.save(personality);
            logger.info(
              `[PersonalityApplicationService] Automatically added display name alias "${displayNameLower}" for ${name}`
            );
          } catch (aliasError) {
            logger.warn(
              `[PersonalityApplicationService] Failed to add display name alias: ${aliasError.message}`
            );
          }
        }
      }

      // Publish domain events
      await this._publishEvents(personality);

      logger.info(`[PersonalityApplicationService] Successfully registered personality: ${name}`);
      return personality;
    } catch (error) {
      logger.error(
        `[PersonalityApplicationService] Failed to register personality: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Get personality with profile data
   * @param {string} personalityName - Name of the personality
   * @param {string} [userId] - User ID for authentication
   * @returns {Promise<Personality|null>}
   */
  async getPersonalityWithProfile(personalityName, userId = null) {
    try {
      logger.info(
        `[PersonalityApplicationService] Getting personality with profile: ${personalityName}`
      );

      // Find the personality
      const personality = await this.personalityRepository.findByName(personalityName);
      if (!personality) {
        return null;
      }

      // Check if profile needs refresh (external mode)
      if (personality.profile && personality.profile.mode === 'external') {
        if (personality.profile.needsApiRefresh()) {
          logger.info(
            `[PersonalityApplicationService] Refreshing profile from API for: ${personalityName}`
          );

          // Fetch latest profile data from API
          const apiData = await this.profileFetcher.fetchProfileInfo(personalityName, userId);
          if (apiData) {
            // Update profile with API data
            personality.profile = PersonalityProfile.fromApiResponse(apiData);

            // Save updated profile
            await this.personalityRepository.save(personality);
          } else {
            logger.warn(
              `[PersonalityApplicationService] Failed to fetch profile for: ${personalityName}`
            );
          }
        }
      }

      return personality;
    } catch (error) {
      logger.error(`[PersonalityApplicationService] Error getting personality: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update a personality's profile
   * @param {Object} command
   * @param {string} command.personalityName - Personality to update
   * @param {string} command.requesterId - User making the request
   * @param {string} [command.prompt] - New prompt
   * @param {string} [command.modelPath] - New model path
   * @param {number} [command.maxWordCount] - New max word count
   * @returns {Promise<Personality>}
   */
  async updatePersonalityProfile(command) {
    try {
      const { personalityName, requesterId, prompt, modelPath, maxWordCount } = command;

      logger.info(`[PersonalityApplicationService] Updating personality: ${personalityName}`);

      // Find the personality
      const personality = await this.personalityRepository.findByName(personalityName);
      if (!personality) {
        throw new Error(`Personality "${personalityName}" not found`);
      }

      // Verify ownership
      if (personality.ownerId.toString() !== requesterId) {
        throw new Error('Only the owner can update a personality');
      }

      // Prepare updates
      const updates = {};
      if (prompt !== undefined) updates.prompt = prompt;
      if (modelPath !== undefined) {
        updates.modelPath = modelPath;
        // Update AI model if path changed
        updates.model = await this._resolveAIModel(modelPath);
      }
      if (maxWordCount !== undefined) updates.maxWordCount = maxWordCount;

      // Update the personality
      personality.updateProfile(updates);

      // Save changes
      await this.personalityRepository.save(personality);

      // Publish events
      await this._publishEvents(personality);

      logger.info(
        `[PersonalityApplicationService] Successfully updated personality: ${personalityName}`
      );
      return personality;
    } catch (error) {
      logger.error(
        `[PersonalityApplicationService] Failed to update personality: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Add an alias to a personality
   * @param {Object} command
   * @param {string} command.personalityName - Personality to update
   * @param {string} command.alias - Alias to add
   * @param {string} command.requesterId - User making the request
   * @returns {Promise<Personality>}
   */
  async addAlias(command) {
    try {
      const { personalityName, alias: aliasName, requesterId } = command;

      logger.info(
        `[PersonalityApplicationService] Adding alias "${aliasName}" to personality: ${personalityName}`
      );

      // Find the personality
      const personality = await this.personalityRepository.findByName(personalityName);
      if (!personality) {
        throw new Error(`Personality "${personalityName}" not found`);
      }

      // Verify ownership
      if (personality.ownerId.toString() !== requesterId) {
        throw new Error('Only the owner can add aliases');
      }

      // Check if alias is already in use
      const existingPersonality = await this.personalityRepository.findByAlias(aliasName);
      if (existingPersonality) {
        // If alias already points to the same personality, no-op (success)
        if (existingPersonality.personalityId.equals(personality.personalityId)) {
          logger.info(
            `[PersonalityApplicationService] Alias "${aliasName}" already points to ${personality.profile.name} - no changes needed`
          );
          return personality;
        }

        // Otherwise, reassign the alias from the old personality to the new one
        logger.info(
          `[PersonalityApplicationService] Reassigning alias "${aliasName}" from ${existingPersonality.profile.name} to ${personality.profile.name}`
        );

        // Remove alias from the existing personality
        const aliasToRemove = existingPersonality.aliases.find(
          a => a.value.toLowerCase() === aliasName.toLowerCase()
        );
        if (aliasToRemove) {
          existingPersonality.removeAlias(aliasToRemove);
          await this.personalityRepository.save(existingPersonality);
          // Publish events for the old personality
          await this._publishEvents(existingPersonality);
        }
      }

      // Add the alias
      const alias = new Alias(aliasName);
      personality.addAlias(alias);

      // Save changes
      await this.personalityRepository.save(personality);

      // Publish events
      await this._publishEvents(personality);

      logger.info(`[PersonalityApplicationService] Successfully added alias "${aliasName}"`);
      return personality;
    } catch (error) {
      logger.error(`[PersonalityApplicationService] Failed to add alias: ${error.message}`);
      throw error;
    }
  }

  /**
   * Remove an alias from a personality
   * @param {Object} command
   * @param {string} command.personalityName - Personality to update
   * @param {string} command.alias - Alias to remove
   * @param {string} command.requesterId - User making the request
   * @returns {Promise<Personality>}
   */
  async removeAlias(command) {
    try {
      const { personalityName, alias: aliasName, requesterId } = command;

      logger.info(
        `[PersonalityApplicationService] Removing alias "${aliasName}" from personality: ${personalityName}`
      );

      // Find the personality
      const personality = await this.personalityRepository.findByName(personalityName);
      if (!personality) {
        throw new Error(`Personality "${personalityName}" not found`);
      }

      // Verify ownership
      if (personality.ownerId.toString() !== requesterId) {
        throw new Error('Only the owner can remove aliases');
      }

      // Remove the alias
      const alias = new Alias(aliasName);
      personality.removeAlias(alias);

      // Save changes
      await this.personalityRepository.save(personality);

      // Publish events
      await this._publishEvents(personality);

      logger.info(`[PersonalityApplicationService] Successfully removed alias "${aliasName}"`);
      return personality;
    } catch (error) {
      logger.error(`[PersonalityApplicationService] Failed to remove alias: ${error.message}`);
      throw error;
    }
  }

  /**
   * Remove a personality
   * @param {Object} command
   * @param {string} command.personalityName - Personality to remove
   * @param {string} command.requesterId - User making the request
   * @returns {Promise<void>}
   */
  async removePersonality(command) {
    try {
      const { personalityName, requesterId } = command;

      logger.info(`[PersonalityApplicationService] Removing personality: ${personalityName}`);

      // Find the personality
      const personality = await this.personalityRepository.findByName(personalityName);
      if (!personality) {
        throw new Error(`Personality "${personalityName}" not found`);
      }

      // Verify ownership
      if (personality.ownerId.toString() !== requesterId) {
        throw new Error('Only the owner can remove a personality');
      }

      // Mark as removed
      personality.remove();

      // Save the removal event
      await this.personalityRepository.save(personality);

      // Publish events
      await this._publishEvents(personality);

      // Delete from repository
      await this.personalityRepository.delete(personality.id.toString());

      logger.info(
        `[PersonalityApplicationService] Successfully removed personality: ${personalityName}`
      );
    } catch (error) {
      logger.error(
        `[PersonalityApplicationService] Failed to remove personality: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Get a personality by name or alias
   * @param {string} nameOrAlias - Personality name or alias
   * @returns {Promise<Personality|null>}
   */
  async getPersonality(nameOrAlias) {
    try {
      // Try to find by name first
      let personality = await this.personalityRepository.findByName(nameOrAlias);

      // If not found, try by alias
      if (!personality) {
        personality = await this.personalityRepository.findByAlias(nameOrAlias);
      }

      return personality;
    } catch (error) {
      logger.error(`[PersonalityApplicationService] Failed to get personality: ${error.message}`);
      throw error;
    }
  }

  /**
   * List all personalities
   * @returns {Promise<Personality[]>}
   */
  async listPersonalities() {
    try {
      return await this.personalityRepository.findAll();
    } catch (error) {
      logger.error(
        `[PersonalityApplicationService] Failed to list personalities: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * List personalities owned by a specific user
   * @param {string} ownerId - Owner's Discord user ID
   * @returns {Promise<Personality[]>}
   */
  async listPersonalitiesByOwner(ownerId) {
    try {
      const userId = new UserId(ownerId);
      return await this.personalityRepository.findByOwner(userId);
    } catch (error) {
      logger.error(
        `[PersonalityApplicationService] Failed to list personalities by owner: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Check if a user has permission to use a personality
   * @param {Object} params
   * @param {string} params.userId - User ID
   * @param {string} params.personalityName - Personality name
   * @returns {Promise<boolean>}
   */
  async checkPermission({ userId, personalityName }) {
    try {
      const personality = await this.getPersonality(personalityName);
      if (!personality) {
        return false;
      }

      // Check if user is the owner
      if (personality.ownerId.toString() === userId) {
        return true;
      }

      // Check if user has authentication for this personality
      const userAuth = await this.authenticationRepository.findByUserId(userId);
      if (!userAuth) {
        return false;
      }

      // For now, having any valid token grants access
      // In the future, we might check personality-specific permissions
      return userAuth.isAuthenticated();
    } catch (error) {
      logger.error(`[PersonalityApplicationService] Failed to check permission: ${error.message}`);
      return false;
    }
  }

  /**
   * Resolve AI model from path
   * @private
   */
  async _resolveAIModel(modelPath) {
    try {
      // Get model info from AI service
      const modelInfo = await this.aiService.getModelInfo(modelPath);

      return new AIModel(
        modelInfo.name || modelPath,
        modelPath,
        modelInfo.capabilities || {
          maxTokens: 4096,
          supportsImages: true,
          supportsAudio: false,
        }
      );
    } catch (_error) {
      // If we can't get model info, create a basic model
      logger.warn(
        `[PersonalityApplicationService] Could not resolve model info for ${modelPath}, using defaults`
      );

      return new AIModel(modelPath, modelPath, {
        maxTokens: 4096,
        supportsImages: true,
        supportsAudio: false,
      });
    }
  }

  /**
   * Publish domain events
   * @private
   */
  async _publishEvents(personality) {
    const events = personality.getUncommittedEvents();

    for (const event of events) {
      await this.eventBus.publish(event);
    }

    personality.markEventsAsCommitted();
  }
}

module.exports = { PersonalityApplicationService };
