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
const { preloadPersonalityAvatar } = require('../../utils/avatarManager');
const avatarStorage = require('../../utils/avatarStorage');

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

      // Process aliases with collision handling
      const processedAliases = [];
      const alternateAliases = [];

      for (const requestedAlias of aliases) {
        const aliasResult = await this._processAliasWithCollisionHandling(requestedAlias, name);
        if (aliasResult.alias) {
          processedAliases.push(aliasResult.alias);
          if (aliasResult.wasAlternate) {
            alternateAliases.push(aliasResult.alias);
          }
        }
      }

      // Create personality based on mode
      const personalityId = PersonalityId.fromString(name); // Use name as ID for simpler lookups
      const userId = new UserId(ownerId);

      let personality;
      if (mode === 'external') {
        // External mode - must validate personality exists in API
        let profile;
        let apiData;

        // Try to fetch profile data from API
        if (this.profileFetcher) {
          try {
            apiData = await this.profileFetcher.fetchProfileInfo(name);
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

        // For external mode, personality MUST exist in API
        if (!apiData) {
          throw new Error(
            `Personality "${name}" does not exist. Please check the spelling and try again.`
          );
        }

        if (!profile) {
          profile = PersonalityProfile.fromApiResponse(apiData);
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

      // Add processed aliases
      for (const aliasName of processedAliases) {
        const alias = new Alias(aliasName);
        personality.addAlias(alias);
      }

      // Save to repository
      await this.personalityRepository.save(personality);

      // Automatically add display name as an alias if it differs from the full name
      let displayNameAlias = null;
      if (personality.profile && personality.profile.displayName) {
        const displayNameLower = personality.profile.displayName.toLowerCase();
        const fullNameLower = name.toLowerCase();

        if (displayNameLower !== fullNameLower && !aliases.includes(displayNameLower)) {
          displayNameAlias = await this._setDisplayNameAlias(
            displayNameLower,
            fullNameLower,
            personality
          );
        }
      }

      // Publish domain events
      await this._publishEvents(personality);

      // Preload the avatar in the background (non-blocking)
      this.preloadAvatar(name, ownerId).catch(err => {
        logger.error(`[PersonalityApplicationService] Error preloading avatar: ${err.message}`);
      });

      logger.info(`[PersonalityApplicationService] Successfully registered personality: ${name}`);

      // Include alternate aliases in the result for the command to use
      if (alternateAliases.length > 0) {
        personality.alternateAliases = alternateAliases;
      }

      // Include display name alias if one was automatically created
      if (displayNameAlias) {
        personality.displayNameAlias = displayNameAlias;
      }

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
            const updatedProfile = PersonalityProfile.fromApiResponse(apiData);
            personality.updateProfile({ externalProfile: updatedProfile });

            // Save updated profile
            await this.personalityRepository.save(personality);
            await this._publishEvents(personality);

            // Pre-download avatar if URL changed
            if (personality.profile.avatarUrl) {
              try {
                logger.info(
                  `[PersonalityApplicationService] Pre-downloading refreshed avatar for ${personalityName}`
                );
                const localUrl = await avatarStorage.getLocalAvatarUrl(
                  personalityName,
                  personality.profile.avatarUrl
                );
                if (localUrl) {
                  logger.info(
                    `[PersonalityApplicationService] Avatar downloaded successfully for ${personalityName}: ${localUrl}`
                  );
                }
              } catch (downloadError) {
                logger.warn(
                  `[PersonalityApplicationService] Failed to pre-download avatar for ${personalityName}: ${downloadError.message}`
                );
              }
            }
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

      // Verify ownership - allow bot owner to update any personality
      const isBotOwner = requesterId === require('../../constants').USER_CONFIG.OWNER_ID;
      if (personality.ownerId.toString() !== requesterId && !isBotOwner) {
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
   * Update personality configuration settings
   * @param {string} personalityId - Personality ID to update
   * @param {Object} updates - Configuration updates to apply
   * @param {boolean} [updates.disableContextMetadata] - Whether to disable context metadata
   * @returns {Promise<Personality>}
   */
  async updatePersonality(personalityId, updates) {
    try {
      logger.info(
        `[PersonalityApplicationService] Updating personality configuration: ${personalityId}`
      );

      // Find the personality
      const personality = await this.personalityRepository.findById(personalityId);
      if (!personality) {
        throw new Error(`Personality "${personalityId}" not found`);
      }

      // Update the configuration
      personality.updateConfiguration(updates);

      // Save changes
      await this.personalityRepository.save(personality);

      // Publish events
      await this._publishEvents(personality);

      logger.info(
        `[PersonalityApplicationService] Successfully updated personality configuration: ${personalityId}`
      );
      return personality;
    } catch (error) {
      logger.error(
        `[PersonalityApplicationService] Failed to update personality configuration: ${error.message}`
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

      // Verify ownership - allow bot owner to add aliases to any personality
      const isBotOwner = requesterId === require('../../constants').USER_CONFIG.OWNER_ID;
      if (personality.ownerId.toString() !== requesterId && !isBotOwner) {
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

      // Verify ownership - allow bot owner to remove aliases from any personality
      const isBotOwner = requesterId === require('../../constants').USER_CONFIG.OWNER_ID;
      if (personality.ownerId.toString() !== requesterId && !isBotOwner) {
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

      // Verify ownership - allow bot owner to remove any personality
      const isBotOwner = requesterId === require('../../constants').USER_CONFIG.OWNER_ID;
      if (personality.ownerId.toString() !== requesterId && !isBotOwner) {
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
      // Use the new resolution method that checks in the correct order:
      // 1. Exact name match
      // 2. Explicit aliases
      // 3. Display name (as fallback)
      const personality = await this.personalityRepository.findByNameOrAlias(nameOrAlias);
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
   * Get the maximum word count among all aliases
   * @returns {Promise<number>} The maximum word count (minimum 2)
   */
  async getMaxAliasWordCount() {
    try {
      const personalities = await this.personalityRepository.findAll();
      let maxWordCount = 2; // Default to 2 to always support multi-word aliases like "@cash money"

      for (const personality of personalities) {
        for (const alias of personality.aliases) {
          const wordCount = alias.value.trim().split(/\s+/).length;
          if (wordCount > maxWordCount) {
            maxWordCount = wordCount;
          }
        }
      }

      logger.debug(`[PersonalityApplicationService] Max alias word count: ${maxWordCount}`);
      return maxWordCount;
    } catch (error) {
      logger.error(
        `[PersonalityApplicationService] Failed to get max alias word count: ${error.message}`
      );
      return 1; // Default to 1 on error
    }
  }

  /**
   * Process alias with collision handling
   * @private
   * @param {string} requestedAlias - The requested alias
   * @param {string} personalityName - The personality name
   * @returns {Promise<{alias: string|null, wasAlternate: boolean}>}
   */
  async _processAliasWithCollisionHandling(requestedAlias, personalityName) {
    try {
      const aliasLower = requestedAlias.toLowerCase();

      // Check if alias already exists
      const existingPersonality = await this.personalityRepository.findByAlias(aliasLower);

      if (!existingPersonality) {
        // Alias is available
        return { alias: aliasLower, wasAlternate: false };
      }

      // Alias is taken, create a smart alternate
      const nameLower = personalityName.toLowerCase();
      const nameParts = nameLower.split('-');
      const aliasParts = aliasLower.split('-');

      let alternateAlias = aliasLower;

      // Try to create a smart alias using parts of the personality name
      if (nameParts.length > 1 && !aliasLower.includes(nameParts[nameParts.length - 1])) {
        // Add the last part of the personality name
        alternateAlias = `${aliasLower}-${nameParts[nameParts.length - 1]}`;
      } else if (nameParts.length > aliasParts.length) {
        // Find which part of the name to add
        let matchIndex = -1;
        for (let i = 0; i < nameParts.length; i++) {
          if (nameParts[i] === aliasParts[0]) {
            matchIndex = i;
            break;
          }
        }

        if (matchIndex >= 0 && matchIndex + 1 < nameParts.length) {
          alternateAlias = `${aliasLower}-${nameParts[matchIndex + 1]}`;
        }
      } else if (!aliasLower.includes(nameLower) && nameLower !== aliasLower) {
        // If alias doesn't include the personality name, append it
        alternateAlias = `${aliasLower}-${nameLower}`;
      }

      // Check if the smart alias is available
      const smartAliasTaken =
        alternateAlias === aliasLower
          ? true
          : await this.personalityRepository.findByAlias(alternateAlias);

      if (alternateAlias === aliasLower || smartAliasTaken) {
        // Fall back to random suffix
        const chars = 'abcdefghijklmnopqrstuvwxyz';
        let randomSuffix = '';
        for (let i = 0; i < 6; i++) {
          randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        alternateAlias = `${aliasLower}-${randomSuffix}`;
      }

      logger.info(
        `[PersonalityApplicationService] Alias "${aliasLower}" is taken, using alternate: "${alternateAlias}"`
      );

      return { alias: alternateAlias, wasAlternate: true };
    } catch (error) {
      logger.error(`[PersonalityApplicationService] Error processing alias: ${error.message}`);
      return { alias: null, wasAlternate: false };
    }
  }

  /**
   * Set display name alias with smart collision handling (matches legacy behavior)
   * @private
   * @param {string} displayNameLower - The display name in lowercase
   * @param {string} fullNameLower - The full personality name in lowercase
   * @param {Personality} personality - The personality to add alias to
   * @returns {Promise<string|null>} The alias that was set (original or alternate)
   */
  async _setDisplayNameAlias(displayNameLower, fullNameLower, personality) {
    try {
      // Check if alias already exists
      const existingPersonality = await this.personalityRepository.findByAlias(displayNameLower);

      if (
        existingPersonality &&
        existingPersonality.personalityId.value !== personality.personalityId.value
      ) {
        // Alias is taken by another personality, create a smarter alias using parts of the full name
        const nameParts = fullNameLower.split('-');

        let alternateAlias = displayNameLower;

        // For display name aliases, we want to add parts from the full name to disambiguate
        // This matches the legacy behavior from DISPLAY_NAME_ALIASES.md
        if (nameParts.length > 1) {
          // Try to create a meaningful alias by appending the second part of the full name
          // Example: "lilith" + "sheda" from "lilith-sheda-khazra"
          alternateAlias = `${displayNameLower}-${nameParts[1]}`;
        }

        // If the smart alias is still taken or we couldn't create one, fall back to random
        const stillTaken =
          alternateAlias === displayNameLower
            ? false
            : await this.personalityRepository.findByAlias(alternateAlias);

        if (alternateAlias === displayNameLower || stillTaken) {
          // Generate a random suffix with only lowercase letters
          const chars = 'abcdefghijklmnopqrstuvwxyz';
          let randomSuffix = '';
          for (let i = 0; i < 6; i++) {
            randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
          }
          alternateAlias = `${displayNameLower}-${randomSuffix}`;
        }

        // Add the alternate alias
        const alias = new Alias(alternateAlias);
        personality.addAlias(alias);
        await this.personalityRepository.save(personality);
        logger.info(
          `[PersonalityApplicationService] Created alternate alias "${alternateAlias}" for ${fullNameLower} ("${displayNameLower}" was taken)`
        );
        return alternateAlias;
      } else {
        // Alias is available, use it directly
        const alias = new Alias(displayNameLower);
        personality.addAlias(alias);
        await this.personalityRepository.save(personality);
        logger.info(
          `[PersonalityApplicationService] Automatically added display name alias "${displayNameLower}" for ${fullNameLower}`
        );
        return displayNameLower;
      }
    } catch (error) {
      logger.warn(
        `[PersonalityApplicationService] Failed to set display name alias: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Preload avatar for a personality
   * @param {string} personalityName - Name of the personality
   * @param {string} [userId] - User ID for authentication
   * @returns {Promise<void>}
   */
  async preloadAvatar(personalityName, userId = null) {
    try {
      logger.info(`[PersonalityApplicationService] Preloading avatar for: ${personalityName}`);

      // Find the personality
      const personality = await this.personalityRepository.findByName(personalityName);
      if (!personality) {
        logger.warn(
          `[PersonalityApplicationService] Personality not found for avatar preload: ${personalityName}`
        );
        return;
      }

      // Convert to the format expected by preloadPersonalityAvatar
      const personalityData = {
        fullName: personality.profile.name,
        avatarUrl: personality.profile.avatarUrl || null,
      };

      // Preload the avatar using avatarManager (validates URL)
      await preloadPersonalityAvatar(personalityData, userId);

      // If the avatar was set/updated during preload, save the personality
      if (
        personalityData.avatarUrl &&
        personalityData.avatarUrl !== personality.profile.avatarUrl
      ) {
        personality.profile.avatarUrl = personalityData.avatarUrl;
        await this.personalityRepository.save(personality);
        logger.info(`[PersonalityApplicationService] Updated avatar URL for: ${personalityName}`);
      }

      // Pre-download the avatar to local storage (like legacy system did)
      if (personality.profile.avatarUrl) {
        try {
          logger.info(
            `[PersonalityApplicationService] Pre-downloading avatar for ${personalityName}`
          );
          const localUrl = await avatarStorage.getLocalAvatarUrl(
            personalityName,
            personality.profile.avatarUrl
          );
          if (localUrl) {
            logger.info(
              `[PersonalityApplicationService] Avatar downloaded successfully for ${personalityName}: ${localUrl}`
            );
          }
        } catch (downloadError) {
          logger.warn(
            `[PersonalityApplicationService] Failed to pre-download avatar for ${personalityName}: ${downloadError.message}`
          );
          // Continue anyway - avatar will be downloaded on first use
        }
      }
    } catch (error) {
      logger.error(`[PersonalityApplicationService] Failed to preload avatar: ${error.message}`);
      // Don't throw - avatar preloading is non-critical
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
