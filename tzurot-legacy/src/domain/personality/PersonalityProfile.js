/**
 * Personality profile value object
 * @module domain/personality/PersonalityProfile
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class PersonalityProfile
 * @extends ValueObject
 * @description Contains configuration and display information for a personality
 */
class PersonalityProfile extends ValueObject {
  constructor(nameOrConfig) {
    super();

    // Require object configuration
    if (typeof nameOrConfig === 'object' && nameOrConfig !== null) {
      // Mode detection based on properties
      if (nameOrConfig.mode === 'external') {
        // External API mode - data from external API
        this.mode = 'external';
        this.name = nameOrConfig.name || nameOrConfig.displayName;
        this.displayName = nameOrConfig.displayName || null;
        this.avatarUrl = nameOrConfig.avatarUrl || nameOrConfig.avatar || null;
        this.errorMessage = nameOrConfig.errorMessage || nameOrConfig.error_message || null;
        this.lastFetched = nameOrConfig.lastFetched ? new Date(nameOrConfig.lastFetched) : null;
        // No local prompt/model data in external mode
        this.prompt = null;
        this.modelPath = null;
        this.maxWordCount = null;
      } else if (nameOrConfig.mode === 'local' || nameOrConfig.user_prompt || nameOrConfig.prompt) {
        // Local mode - comprehensive personality data
        this.mode = 'local';
        this.name = nameOrConfig.username || nameOrConfig.name;
        this.displayName = nameOrConfig.displayName || nameOrConfig.name;
        this.avatarUrl = nameOrConfig.avatar || nameOrConfig.avatarUrl || null;
        this.errorMessage = nameOrConfig.error_message || nameOrConfig.errorMessage || null;
        // Local personality configuration
        this.prompt = nameOrConfig.user_prompt || nameOrConfig.prompt;
        this.jailbreak = nameOrConfig.jailbreak || null;
        this.modelPath = nameOrConfig.engine_model || nameOrConfig.modelPath;
        this.maxWordCount = nameOrConfig.maxWordCount || 2000;
        this.temperature = nameOrConfig.engine_temperature || nameOrConfig.temperature || 1.0;
        // Additional local config
        this.voiceConfig =
          nameOrConfig.voice_id || nameOrConfig.voiceConfig
            ? {
                model: nameOrConfig.voice_model || nameOrConfig.voiceConfig?.model,
                id: nameOrConfig.voice_id || nameOrConfig.voiceConfig?.id,
                stability: nameOrConfig.voice_stability || nameOrConfig.voiceConfig?.stability,
              }
            : null;
      } else if (nameOrConfig.displayName && !nameOrConfig.user_prompt && !nameOrConfig.prompt) {
        // Legacy object construction - assume external
        this.mode = 'external';
        this.displayName = nameOrConfig.displayName || null;
        this.avatarUrl = nameOrConfig.avatarUrl || null;
        this.errorMessage = nameOrConfig.errorMessage || null;
        this.name = this.displayName || null;
        this.prompt = null;
        this.modelPath = null;
        this.maxWordCount = null;
        this.lastFetched = nameOrConfig.lastFetched ? new Date(nameOrConfig.lastFetched) : null;
      } else {
        // Default to external mode for empty objects
        this.mode = 'external';
        this.displayName = nameOrConfig.displayName || null;
        this.avatarUrl = nameOrConfig.avatarUrl || null;
        this.errorMessage = nameOrConfig.errorMessage || null;
        this.name = nameOrConfig.name || this.displayName || null;
        this.prompt = null;
        this.modelPath = null;
        this.maxWordCount = null;
        this.lastFetched = nameOrConfig.lastFetched ? new Date(nameOrConfig.lastFetched) : null;
      }

      // Store public API data if provided
      if (nameOrConfig.publicApiData) {
        this.publicApiData = nameOrConfig.publicApiData;
      }
    } else {
      throw new Error('PersonalityProfile requires an object configuration');
    }

    this.validate();
  }

  validate() {
    if (this.displayName && typeof this.displayName !== 'string') {
      throw new Error('Display name must be a string');
    }

    if (this.avatarUrl && typeof this.avatarUrl !== 'string') {
      throw new Error('Avatar URL must be a string');
    }

    if (this.errorMessage && typeof this.errorMessage !== 'string') {
      throw new Error('Error message must be a string');
    }

    if (this.name && typeof this.name !== 'string') {
      throw new Error('Name must be a string');
    }

    if (this.prompt && typeof this.prompt !== 'string') {
      throw new Error('Prompt must be a string');
    }

    if (this.modelPath && typeof this.modelPath !== 'string') {
      throw new Error('Model path must be a string');
    }

    if (this.maxWordCount && typeof this.maxWordCount !== 'number') {
      throw new Error('Max word count must be a number');
    }
  }

  withDisplayName(displayName) {
    return new PersonalityProfile({
      displayName,
      avatarUrl: this.avatarUrl,
      errorMessage: this.errorMessage,
    });
  }

  withAvatarUrl(avatarUrl) {
    return new PersonalityProfile({
      displayName: this.displayName,
      avatarUrl,
      errorMessage: this.errorMessage,
    });
  }

  withErrorMessage(errorMessage) {
    return new PersonalityProfile({
      displayName: this.displayName,
      avatarUrl: this.avatarUrl,
      errorMessage,
    });
  }

  isComplete() {
    return !!(this.displayName && this.avatarUrl && this.errorMessage);
  }

  toJSON() {
    const json = {
      mode: this.mode,
      name: this.name,
      displayName: this.displayName,
      avatarUrl: this.avatarUrl,
      errorMessage: this.errorMessage,
    };

    if (this.mode === 'local') {
      json.prompt = this.prompt;
      json.jailbreak = this.jailbreak;
      json.modelPath = this.modelPath;
      json.maxWordCount = this.maxWordCount;
      json.temperature = this.temperature;
      json.voiceConfig = this.voiceConfig;
    } else {
      json.lastFetched = this.lastFetched;
    }

    return json;
  }

  static createEmpty() {
    // Create a truly empty profile without lastFetched for equality
    const profile = new PersonalityProfile({});
    profile.lastFetched = null; // Override to ensure equality
    return profile;
  }

  static fromJSON(data) {
    if (!data) return PersonalityProfile.createEmpty();

    // Ensure mode is preserved when reconstructing from JSON
    const profileData = { ...data };
    if (data.mode) {
      profileData.mode = data.mode;
    }

    return new PersonalityProfile(profileData);
  }

  /**
   * Check if profile needs API refresh (external mode only)
   * @param {number} staleThresholdMs - Milliseconds before profile is stale (default 1 hour)
   * @returns {boolean}
   */
  needsApiRefresh(staleThresholdMs = 3600000) {
    if (this.mode !== 'external') return false;
    if (!this.lastFetched) return true;
    return Date.now() - this.lastFetched.getTime() > staleThresholdMs;
  }

  /**
   * Check if this is a locally managed personality
   * @returns {boolean}
   */
  isLocallyManaged() {
    return this.mode === 'local';
  }

  /**
   * Create profile from external API response
   * @param {Object} apiData - Response from fetchProfileInfo
   * @returns {PersonalityProfile}
   */
  static fromApiResponse(apiData) {
    // Extract more data from public API
    const profile = {
      mode: 'external',
      name: apiData.username || apiData.name,
      displayName: apiData.name || apiData.displayName,
      avatarUrl: apiData.avatar || apiData.avatar_url,
      errorMessage: apiData.error_message,
      lastFetched: new Date(),
    };

    // Store additional public API data for future use
    profile.publicApiData = {
      id: apiData.id,
      searchDescription: apiData.search_description,
      searchTags: apiData.search_tags_v2 || [],
      shapeSettings: apiData.shape_settings || {},
      wackMessage: apiData.wack_message,
      userCount: apiData.user_count || 0,
      messageCount: apiData.message_count || 0,
      bannerUrl: apiData.banner,
      enabled: apiData.enabled !== false,
      // Optional fields that may be populated
      tagline: apiData.tagline || null,
      typicalPhrases: apiData.typical_phrases || [],
      examplePrompts: apiData.example_prompts || [],
      screenshots: apiData.screenshots || [],
      category: apiData.category || null,
      customCategory: apiData.custom_category || null,
      characterUniverse: apiData.character_universe || null,
      characterBackground: apiData.character_background || null,
      discordInvite: apiData.discord_invite || null,
      // Personality-specific flags
      allowMultipleMessages: apiData.allow_multiple_messages || false,
      allowUserEngineOverride: apiData.allow_user_engine_override !== false,
    };

    return new PersonalityProfile(profile);
  }

  /**
   * Create profile from local backup data
   * @param {Object} backupData - Data from personality backup files
   * @returns {PersonalityProfile}
   */
  static fromBackupData(backupData) {
    return new PersonalityProfile({
      mode: 'local',
      ...backupData,
    });
  }
}

module.exports = { PersonalityProfile };
