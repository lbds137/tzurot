/**
 * Extended personality profile value object for external service data
 * @module domain/personality/ExtendedPersonalityProfile
 */

const { PersonalityProfile } = require('./PersonalityProfile');

/**
 * @class ExtendedPersonalityProfile
 * @extends PersonalityProfile
 * @description Enhanced profile supporting full external service data model
 */
class ExtendedPersonalityProfile extends PersonalityProfile {
  constructor(config) {
    // Call parent constructor with base fields
    super(config);

    // Extended fields from external service backup data
    this.initializeExtendedFields(config);
    this.validateExtended();
  }

  initializeExtendedFields(config) {
    // User and credits
    this.userId = config.user_id || config.userId || null;
    this.creditsUsed = config.credits_used || config.creditsUsed || 0;
    this.creditsAvailable = config.credits_available || config.creditsAvailable || 0;

    // Categorization
    this.category = config.category || null;
    this.customCategory = config.custom_category || config.customCategory || null;
    this.tagline = config.tagline || null;

    // Character details
    this.typicalPhrases = config.typical_phrases || config.typicalPhrases || [];
    this.screenshots = config.screenshots || [];
    this.sourceMaterial = config.source_material || config.sourceMaterial || [];
    this.characterUniverse = config.character_universe || config.characterUniverse || '';
    this.characterBackground = config.character_background || config.characterBackground || '';
    this.examplePrompts = config.example_prompts || config.examplePrompts || [];

    // Extended prompts
    this.userPrompt = config.user_prompt || config.userPrompt || this.prompt;
    this.jailbreakPrompt = config.jailbreak || config.jailbreakPrompt || null;
    this.imageJailbreak = config.image_jailbreak || config.imageJailbreak || null;

    // Voice configuration (enhanced)
    this.voiceConfig = this.buildVoiceConfig(config);

    // Image generation settings
    this.imageConfig = {
      size: config.image_size || config.imageSize || 'square_hd',
      forceSize: config.force_image_size || config.forceImageSize || false,
      jailbreak: config.image_jailbreak || config.imageJailbreak || null,
    };

    // Engine configuration
    this.engineConfig = {
      model: config.engine_model || config.modelPath || null,
      temperature: config.engine_temperature || config.temperature || 1.0,
      instructions: config.voice_engine_instructions || config.engineInstructions || '',
      historyInstructions: config.voice_history_instructions || config.historyInstructions || '',
    };

    // Localization
    this.languagePreset = config.language_preset || config.languagePreset || null;
    this.timezone = config.timezone || 'America/New_York';

    // Moderation and safety
    this.moderationFlags = {
      isHighRisk: config.is_high_risk || config.isHighRisk || false,
      isSensitive: config.is_sensitive || config.isSensitive || false,
      isSensitiveImage: config.is_sensitive_image || config.isSensitiveImage || false,
      selfIdentifiedSensitive:
        config.self_identified_sensitive || config.selfIdentifiedSensitive || false,
    };
    this.autoModerationResults =
      config.auto_moderation_results || config.autoModerationResults || null;

    // External auth
    this.xAuthUrl = config.x_auth_url || config.xAuthUrl || null;

    // Metadata
    this.birthday = config.birthday ? new Date(config.birthday) : null;
    this.deleted = config.deleted || false;
    this.blockedUserIds = config.blocked_user_id || config.blockedUserIds || [];

    // Related data files (for migration tracking)
    this.dataFiles = {
      knowledge: config.knowledgeFile || null,
      memories: config.memoriesFile || null,
      userPersonalization: config.userPersonalizationFile || null,
    };
  }

  buildVoiceConfig(config) {
    if (!config.voice_id && !config.voiceId && !config.voiceConfig?.id) {
      return null;
    }

    return {
      model:
        config.voice_model ||
        config.voiceModel ||
        config.voiceConfig?.model ||
        'eleven_multilingual_v2',
      id: config.voice_id || config.voiceId || config.voiceConfig?.id,
      file: config.voice_file || config.voiceFile || config.voiceConfig?.file || null,
      frequency:
        config.voice_frequency || config.voiceFrequency || config.voiceConfig?.frequency || 1,
      stability:
        config.voice_stability || config.voiceStability || config.voiceConfig?.stability || 1,
      similarity:
        config.voice_similarity || config.voiceSimilarity || config.voiceConfig?.similarity || 0.75,
      style: config.voice_style || config.voiceStyle || config.voiceConfig?.style || 0,
      transcriptionEnabled:
        config.voice_transcription_enabled || config.voiceTranscriptionEnabled || true,
    };
  }

  validateExtended() {
    // Additional validation for extended fields
    if (this.userId && !Array.isArray(this.userId)) {
      throw new Error('User ID must be an array');
    }

    if (typeof this.creditsUsed !== 'number' || typeof this.creditsAvailable !== 'number') {
      throw new Error('Credits must be numbers');
    }

    if (!Array.isArray(this.typicalPhrases) || !Array.isArray(this.examplePrompts)) {
      throw new Error('Phrases and prompts must be arrays');
    }

    if (this.voiceConfig && typeof this.voiceConfig.stability !== 'number') {
      throw new Error('Voice stability must be a number');
    }
  }

  /**
   * Check if personality has local backup data
   * @returns {boolean}
   */
  hasLocalBackupData() {
    return !!(
      this.dataFiles.knowledge ||
      this.dataFiles.memories ||
      this.dataFiles.userPersonalization
    );
  }

  /**
   * Check if personality has voice capabilities
   * @returns {boolean}
   */
  hasVoiceCapabilities() {
    return !!(this.voiceConfig && this.voiceConfig.id);
  }

  /**
   * Check if personality has image generation capabilities
   * @returns {boolean}
   */
  hasImageCapabilities() {
    return !!(this.imageConfig && this.imageConfig.jailbreak);
  }

  /**
   * Get moderation risk level
   * @returns {string} 'high', 'medium', or 'low'
   */
  getModerationRiskLevel() {
    if (this.moderationFlags.isHighRisk) return 'high';
    if (this.moderationFlags.isSensitive || this.moderationFlags.selfIdentifiedSensitive)
      return 'medium';
    return 'low';
  }

  /**
   * Convert to storage format
   * @returns {Object}
   */
  toJSON() {
    const baseJson = super.toJSON();

    return {
      ...baseJson,
      // User and credits
      userId: this.userId,
      creditsUsed: this.creditsUsed,
      creditsAvailable: this.creditsAvailable,

      // Categorization
      category: this.category,
      customCategory: this.customCategory,
      tagline: this.tagline,

      // Character details
      typicalPhrases: this.typicalPhrases,
      screenshots: this.screenshots,
      sourceMaterial: this.sourceMaterial,
      characterUniverse: this.characterUniverse,
      characterBackground: this.characterBackground,
      examplePrompts: this.examplePrompts,

      // Extended prompts
      userPrompt: this.userPrompt,
      jailbreakPrompt: this.jailbreakPrompt,
      imageJailbreak: this.imageJailbreak,

      // Configurations
      voiceConfig: this.voiceConfig,
      imageConfig: this.imageConfig,
      engineConfig: this.engineConfig,

      // Localization
      languagePreset: this.languagePreset,
      timezone: this.timezone,

      // Moderation
      moderationFlags: this.moderationFlags,
      autoModerationResults: this.autoModerationResults,

      // Other
      xAuthUrl: this.xAuthUrl,
      birthday: this.birthday,
      deleted: this.deleted,
      blockedUserIds: this.blockedUserIds,
      dataFiles: this.dataFiles,
    };
  }

  /**
   * Create from external API response with extended data
   * @param {Object} apiData - Full response from external API
   * @returns {ExtendedPersonalityProfile}
   */
  static fromApiResponse(apiData) {
    return new ExtendedPersonalityProfile({
      mode: 'external',
      name: apiData.username || apiData.name,
      displayName: apiData.name || apiData.displayName,
      avatarUrl: apiData.avatar || apiData.avatar_url,
      errorMessage: apiData.error_message,
      lastFetched: new Date(),
      // Map all additional fields from API
      ...apiData,
    });
  }

  /**
   * Create from local backup files
   * @param {Object} backupData - Combined data from backup JSON files
   * @returns {ExtendedPersonalityProfile}
   */
  static fromBackupData(backupData) {
    const { main, knowledge, memories, userPersonalization } = backupData;

    return new ExtendedPersonalityProfile({
      mode: 'local',
      ...main,
      dataFiles: {
        knowledge: knowledge ? 'loaded' : null,
        memories: memories ? 'loaded' : null,
        userPersonalization: userPersonalization ? 'loaded' : null,
      },
    });
  }

  /**
   * Create from JSON data
   * @param {Object} data - JSON data
   * @returns {ExtendedPersonalityProfile}
   */
  static fromJSON(data) {
    if (!data) return null;

    return new ExtendedPersonalityProfile(data);
  }

  /**
   * Create migration-ready profile from existing data
   * @param {Object} existingProfile - Current PersonalityProfile data
   * @param {Object} backupData - External service backup data
   * @returns {ExtendedPersonalityProfile}
   */
  static createForMigration(existingProfile, backupData) {
    return new ExtendedPersonalityProfile({
      // Preserve existing fields
      ...existingProfile,
      // Override with backup data
      ...backupData,
      // Mark as migrated
      mode: 'migrated',
      lastMigrated: new Date(),
    });
  }
}

module.exports = { ExtendedPersonalityProfile };
