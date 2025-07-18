/**
 * Personality aggregate root
 * @module domain/personality/Personality
 */

const { AggregateRoot } = require('../shared/AggregateRoot');
const { PersonalityId } = require('./PersonalityId');
const { PersonalityProfile } = require('./PersonalityProfile');
const { UserId } = require('./UserId');
const {
  PersonalityCreated,
  PersonalityProfileUpdated,
  PersonalityRemoved,
  PersonalityAliasAdded,
  PersonalityAliasRemoved,
} = require('./PersonalityEvents');
const { Alias } = require('./Alias');
const { AIModel } = require('../ai/AIModel');
const { PersonalityConfiguration } = require('./PersonalityConfiguration');

/**
 * @class Personality
 * @extends AggregateRoot
 * @description Aggregate root for personality bounded context
 */
class Personality extends AggregateRoot {
  constructor(id) {
    if (!(id instanceof PersonalityId)) {
      throw new Error('Personality must be created with PersonalityId');
    }

    super(id.toString());

    this.personalityId = id;
    this.ownerId = null;
    this.profile = null;
    this.configuration = null;
    this.model = null;
    this.aliases = [];
    this.createdAt = null;
    this.updatedAt = null;
    this.removed = false;
  }

  /**
   * Create a new personality
   * @static
   * @param {PersonalityId} personalityId - Unique personality identifier
   * @param {UserId} ownerId - User who owns this personality
   * @param {PersonalityProfile} profile - Personality profile
   * @param {AIModel} model - AI model configuration
   * @returns {Personality} New personality instance
   */
  static create(personalityId, ownerId, profile, model) {
    if (!(personalityId instanceof PersonalityId)) {
      throw new Error('Invalid PersonalityId');
    }

    if (!(ownerId instanceof UserId)) {
      throw new Error('Invalid UserId');
    }

    if (!(profile instanceof PersonalityProfile)) {
      throw new Error('Invalid PersonalityProfile');
    }

    if (!(model instanceof AIModel)) {
      throw new Error('Invalid AIModel');
    }

    const personality = new Personality(personalityId);

    personality.applyEvent(
      new PersonalityCreated(personalityId.toString(), {
        personalityId: personalityId.toString(),
        ownerId: ownerId.toString(),
        profile: profile.toJSON(),
        model: model.toJSON(),
        createdAt: new Date().toISOString(),
      })
    );

    return personality;
  }

  /**
   * Update personality profile
   * @param {Object} updates - Updates to apply
   * @param {string} [updates.prompt] - New prompt (local mode)
   * @param {string} [updates.modelPath] - New model path (local mode)
   * @param {AIModel} [updates.model] - New AI model (local mode)
   * @param {number} [updates.maxWordCount] - New max word count (local mode)
   * @param {PersonalityProfile} [updates.externalProfile] - Updated external profile from API
   */
  updateProfile(updates) {
    if (this.removed) {
      throw new Error('Cannot update removed personality');
    }

    // Handle external profile updates (from API refresh)
    if (updates.externalProfile && this.profile && this.profile.mode === 'external') {
      this.applyEvent(
        new PersonalityProfileUpdated(this.id, {
          profile: updates.externalProfile.toJSON(),
          updatedAt: new Date().toISOString(),
        })
      );
      return;
    }

    // Handle local mode updates
    if (!this.profile || this.profile.mode !== 'local') {
      throw new Error('Cannot update profile for external personalities');
    }

    // Create updated profile maintaining the mode
    const currentProfile = this.profile || {};
    const updatedData = {
      mode: 'local',
      name: currentProfile.name,
      user_prompt: updates.prompt !== undefined ? updates.prompt : currentProfile.prompt,
      engine_model: updates.modelPath !== undefined ? updates.modelPath : currentProfile.modelPath,
      maxWordCount:
        updates.maxWordCount !== undefined ? updates.maxWordCount : currentProfile.maxWordCount,
      // Preserve other local mode fields
      jailbreak: currentProfile.jailbreak,
      temperature: currentProfile.temperature,
      avatar: currentProfile.avatarUrl,
      voice_id: currentProfile.voiceConfig?.id,
      voice_model: currentProfile.voiceConfig?.model,
      voice_stability: currentProfile.voiceConfig?.stability,
    };

    const updatedProfile = new PersonalityProfile(updatedData);

    // Update model if provided
    const updatedModel = updates.model || this.model;

    // Apply event
    this.applyEvent(
      new PersonalityProfileUpdated(this.id, {
        profile: updatedProfile.toJSON(),
        model: updatedModel ? updatedModel.toJSON() : null,
        updatedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Update personality configuration
   * @param {Object} updates - Configuration updates to apply
   * @param {boolean} [updates.disableContextMetadata] - Whether to disable context metadata
   */
  updateConfiguration(updates) {
    if (this.removed) {
      throw new Error('Cannot update removed personality');
    }

    // If no configuration exists, create a default one from the profile
    if (!this.configuration) {
      const { PersonalityConfiguration } = require('./PersonalityConfiguration');

      // Create default configuration from existing profile data
      this.configuration = new PersonalityConfiguration(
        this.profile?.name || this.personalityId.toString(),
        this.profile?.prompt || 'You are a helpful assistant.',
        this.model?.path || '/models/default',
        this.profile?.maxWordCount || 1000,
        false // Default to context metadata enabled
      );
    }

    // Create updated configuration
    const updatedConfiguration = this.configuration.withUpdates(updates);

    // Apply event for configuration update
    this.applyEvent(
      new PersonalityProfileUpdated(this.id, {
        configuration: updatedConfiguration.toJSON(),
        updatedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Remove personality
   */
  remove() {
    if (this.removed) {
      throw new Error('Personality already removed');
    }

    this.applyEvent(
      new PersonalityRemoved(this.id, {
        removedBy: this.ownerId.toString(),
        removedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Add an alias to the personality
   * @param {Alias} alias - Alias to add
   */
  addAlias(alias) {
    if (this.removed) {
      throw new Error('Cannot add alias to removed personality');
    }

    if (!(alias instanceof Alias)) {
      throw new Error('Invalid Alias');
    }

    // Check if alias already exists
    if (this.aliases.some(a => a.equals(alias))) {
      throw new Error(`Alias "${alias.name}" already exists`);
    }

    this.applyEvent(
      new PersonalityAliasAdded(this.id, {
        alias: alias.toJSON(),
        addedBy: this.ownerId.toString(),
        addedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Remove an alias from the personality
   * @param {Alias} alias - Alias to remove
   */
  removeAlias(alias) {
    if (this.removed) {
      throw new Error('Cannot remove alias from removed personality');
    }

    if (!(alias instanceof Alias)) {
      throw new Error('Invalid Alias');
    }

    // Check if alias exists
    if (!this.aliases.some(a => a.equals(alias))) {
      throw new Error(`Alias "${alias.name}" not found`);
    }

    this.applyEvent(
      new PersonalityAliasRemoved(this.id, {
        alias: alias.toJSON(),
        removedBy: this.ownerId.toString(),
        removedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Check if user owns this personality
   * @param {UserId} userId - User to check
   * @returns {boolean} True if user owns personality
   */
  isOwnedBy(userId) {
    if (!(userId instanceof UserId)) {
      return false;
    }
    return this.ownerId && this.ownerId.equals(userId);
  }

  /**
   * Get display name (falls back to ID if not set)
   * @returns {string} Display name
   */
  getDisplayName() {
    return this.profile?.displayName || this.personalityId.toString();
  }

  /**
   * Check if personality is removed
   * @returns {boolean} True if removed
   */
  get isRemoved() {
    return this.removed;
  }

  /**
   * Get full name (backward compatibility)
   * @returns {string} Full personality name
   */
  get fullName() {
    return this.profile?.name || this.personalityId?.toString() || 'Unknown';
  }

  /**
   * Check if profile needs refreshing
   * @param {number} staleThresholdMs - Milliseconds before profile is stale
   * @returns {boolean} True if profile needs refresh
   */
  needsProfileRefresh(staleThresholdMs = 60 * 60 * 1000) {
    // Need refresh if no profile or profile is empty (no displayName)
    if (!this.profile || !this.profile.displayName || !this.updatedAt) {
      return true;
    }

    const lastUpdate = new Date(this.updatedAt).getTime();
    const now = Date.now();

    return now - lastUpdate > staleThresholdMs;
  }

  // Event handlers
  onPersonalityCreated(event) {
    this.personalityId = PersonalityId.fromString(event.payload.personalityId);
    this.ownerId = UserId.fromString(event.payload.ownerId);
    this.profile = event.payload.profile
      ? PersonalityProfile.fromJSON(event.payload.profile)
      : PersonalityProfile.createEmpty();
    this.model = event.payload.model ? AIModel.fromJSON(event.payload.model) : null;
    this.aliases = [];
    this.createdAt = event.payload.createdAt;
    this.updatedAt = event.payload.createdAt;
    this.removed = false;
  }

  onPersonalityProfileUpdated(event) {
    if (event.payload.profile) {
      this.profile = PersonalityProfile.fromJSON(event.payload.profile);
    }
    if (event.payload.model) {
      this.model = AIModel.fromJSON(event.payload.model);
    }
    if (event.payload.configuration) {
      this.configuration = PersonalityConfiguration.fromJSON(event.payload.configuration);
    }
    this.updatedAt = event.payload.updatedAt;
  }

  onPersonalityRemoved(event) {
    this.removed = true;
    this.updatedAt = event.payload.removedAt;
  }

  onPersonalityAliasAdded(event) {
    const alias = Alias.fromJSON(event.payload.alias);
    this.aliases.push(alias);
    this.updatedAt = event.payload.addedAt;
  }

  onPersonalityAliasRemoved(event) {
    const alias = Alias.fromJSON(event.payload.alias);
    this.aliases = this.aliases.filter(a => !a.equals(alias));
    this.updatedAt = event.payload.removedAt;
  }

  // Serialization
  toJSON() {
    return {
      id: this.id,
      personalityId: this.personalityId.toString(),
      ownerId: this.ownerId.toString(),
      profile: this.profile ? this.profile.toJSON() : null,
      configuration: this.configuration ? this.configuration.toJSON() : null,
      model: this.model ? this.model.toJSON() : null,
      aliases: this.aliases.map(a => a.toJSON()),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      removed: this.removed,
      version: this.version,
    };
  }
}

module.exports = { Personality };
