/**
 * PersonalityMapper - Maps shapes.inc personality config to v3 schema
 *
 * Handles the complex mapping from shapes.inc's 385-line JSON format
 * to Tzurot v3's normalized PostgreSQL schema (personalities, system_prompts, llm_configs)
 */

import { ShapesIncPersonalityConfig, V3PersonalityData } from './types.js';

export class PersonalityMapper {
  /**
   * Map shapes.inc personality config to v3 schema format
   */
  map(shapesConfig: ShapesIncPersonalityConfig): V3PersonalityData {
    return {
      personality: this.mapPersonality(shapesConfig),
      systemPrompt: this.mapSystemPrompt(shapesConfig),
      llmConfig: this.mapLlmConfig(shapesConfig),
    };
  }

  /**
   * Map personality core fields
   */
  private mapPersonality(config: ShapesIncPersonalityConfig) {
    return {
      name: config.name, // Display name (e.g., "COLD")
      displayName: config.name, // Same as name for now
      slug: config.username, // URL-friendly slug (e.g., "cold-kerach-batuach")
      // Note: avatarUrl removed - v3 handles avatars through Discord webhooks
      // Avatar URL preserved in customFields.shapesIncAvatarUrl for reference
      characterInfo: config.user_prompt || '',
      personalityTraits: config.personality_traits || '',
      personalityTone: config.personality_tone || null,
      personalityAge: config.personality_age || null,
      personalityAppearance: config.personality_appearance || null,
      personalityLikes: config.personality_likes || null,
      personalityDislikes: config.personality_dislikes || null,
      conversationalGoals: config.personality_conversational_goals || null,
      conversationalExamples: config.personality_conversational_examples || null,
      memoryEnabled: config.ltm_enabled ?? true,
      voiceEnabled: false, // v3 doesn't support voice yet
      imageEnabled: false, // v3 doesn't support images yet
      customFields: this.extractCustomFields(config),
    };
  }

  /**
   * Extract custom fields from shapes.inc config
   * Preserves fields that don't have dedicated columns in v3 schema
   */
  private extractCustomFields(config: ShapesIncPersonalityConfig): Record<string, any> | null {
    const customFields: Record<string, any> = {};

    // Preserve favorite reactions/emojis
    if (config.favorite_reacts && config.favorite_reacts.length > 0) {
      customFields.favoriteReacts = config.favorite_reacts;
    }

    // Preserve keywords for search/discovery
    if (config.keywords && config.keywords.length > 0) {
      customFields.keywords = config.keywords;
    }

    // Preserve search description
    if (config.search_description) {
      customFields.searchDescription = config.search_description;
    }

    // Preserve custom messages
    if (config.error_message) {
      customFields.errorMessage = config.error_message;
    }
    if (config.wack_message) {
      customFields.wackMessage = config.wack_message;
    }
    if (config.sleep_message) {
      customFields.sleepMessage = config.sleep_message;
    }

    // Preserve shapes.inc ID for reference
    if (config.id) {
      customFields.shapesIncId = config.id;
    }

    // Preserve avatar URL for reference (v3 uses webhooks instead)
    if (config.avatar) {
      customFields.shapesIncAvatarUrl = config.avatar;
    }

    // Return null if no custom fields to store
    return Object.keys(customFields).length > 0 ? customFields : null;
  }

  /**
   * Map system prompt (jailbreak in shapes.inc)
   */
  private mapSystemPrompt(config: ShapesIncPersonalityConfig) {
    return {
      name: `${config.name} System Prompt`,
      description: `System prompt for ${config.name} personality (imported from shapes.inc)`,
      content: config.jailbreak,
      isDefault: false, // Imported personalities are never default
    };
  }

  /**
   * Map LLM configuration
   */
  private mapLlmConfig(config: ShapesIncPersonalityConfig) {
    return {
      name: `${config.name} LLM Config`,
      description: `LLM configuration for ${config.name} personality (imported from shapes.inc)`,
      model: this.mapModelName(config.engine_model),
      visionModel: null, // v3 handles vision detection automatically
      temperature: config.engine_temperature,
      topP: config.engine_top_p ?? null,
      topK: config.engine_top_k ?? null,
      frequencyPenalty: config.engine_frequency_penalty ?? null,
      presencePenalty: config.engine_presence_penalty ?? null,
      repetitionPenalty: config.engine_repetition_penalty ?? null,
      maxTokens: null, // Let model defaults handle this
      memoryScoreThreshold: config.ltm_threshold ?? null,
      memoryLimit: config.ltm_max_retrieved_summaries ?? null,
      contextWindowSize: config.stm_window,
      isGlobal: false, // Imported configs are user-owned
      ownerId: null, // Will be set during import with actual user ID
    };
  }

  /**
   * Map shapes.inc model names to v3 format
   *
   * Shapes.inc used OpenRouter under the hood (same as v3), so models are already
   * in the correct format (provider/model). We pass them through as-is.
   */
  private mapModelName(shapesModel: string): string {
    // Shapes.inc used OpenRouter format, so just pass through as-is
    return shapesModel;
  }

  /**
   * Validate shapes.inc config has required fields
   */
  validate(config: ShapesIncPersonalityConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Required fields
    if (!config.id) errors.push('Missing required field: id');
    if (!config.name) errors.push('Missing required field: name');
    if (!config.username) errors.push('Missing required field: username');
    if (!config.jailbreak) errors.push('Missing required field: jailbreak (system prompt)');
    if (!config.engine_model) errors.push('Missing required field: engine_model');

    // Validate slug format (username)
    if (config.username && !/^[a-z0-9-]+$/.test(config.username)) {
      errors.push(`Invalid slug format: ${config.username} (must be lowercase alphanumeric with hyphens)`);
    }

    // Validate temperature range
    if (config.engine_temperature !== undefined) {
      if (config.engine_temperature < 0 || config.engine_temperature > 2) {
        errors.push(`Temperature out of range: ${config.engine_temperature} (must be 0-2)`);
      }
    }

    // Validate STM window
    if (config.stm_window !== undefined) {
      if (config.stm_window < 1 || config.stm_window > 100) {
        errors.push(`STM window out of range: ${config.stm_window} (must be 1-100)`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Extract summary stats from shapes.inc config
   */
  summarize(config: ShapesIncPersonalityConfig) {
    return {
      id: config.id,
      name: config.name,
      slug: config.username,
      model: this.mapModelName(config.engine_model),
      temperature: config.engine_temperature,
      stmWindow: config.stm_window,
      ltmEnabled: config.ltm_enabled,
      ltmThreshold: config.ltm_threshold,
      ltmMaxSummaries: config.ltm_max_retrieved_summaries,
      hasAvatar: !!config.avatar,
      avatarUrl: config.avatar || null,
      characterInfoLength: config.user_prompt?.length || 0,
      systemPromptLength: config.jailbreak?.length || 0,
    };
  }
}
