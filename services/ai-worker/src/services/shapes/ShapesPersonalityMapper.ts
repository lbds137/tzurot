/**
 * Shapes.inc Personality Mapper
 *
 * Maps shapes.inc personality config fields to Tzurot Prisma create data.
 * Produces the data objects needed to create Personality, SystemPrompt,
 * and LlmConfig records from a ShapesIncPersonalityConfig.
 */

import {
  createLogger,
  generatePersonalityUuid,
  generateSystemPromptUuid,
  generateLlmConfigUuid,
  type ShapesIncPersonalityConfig,
} from '@tzurot/common-types';

const logger = createLogger('ShapesPersonalityMapper');

// ============================================================================
// Types
// ============================================================================

/** Data needed to create a SystemPrompt record */
export interface MappedSystemPrompt {
  id: string;
  name: string;
  content: string;
}

/** Data needed to create a Personality record */
export interface MappedPersonality {
  id: string;
  name: string;
  slug: string;
  displayName: string;
  characterInfo: string;
  personalityTraits: string;
  personalityTone: string | null;
  personalityAge: string | null;
  personalityAppearance: string | null;
  personalityLikes: string | null;
  personalityDislikes: string | null;
  conversationalGoals: string | null;
  conversationalExamples: string | null;
  errorMessage: string | null;
  isPublic: boolean;
  voiceEnabled: boolean;
  imageEnabled: boolean;
  customFields: Record<string, unknown> | null;
}

/** Data needed to create an LlmConfig record */
export interface MappedLlmConfig {
  id: string;
  name: string;
  description: string;
  model: string;
  provider: string;
  advancedParameters: Record<string, unknown>;
  memoryScoreThreshold: number;
  memoryLimit: number;
  contextWindowTokens: number;
  maxMessages: number;
}

/** Complete mapped data for personality creation */
export interface MappedPersonalityData {
  systemPrompt: MappedSystemPrompt;
  personality: MappedPersonality;
  llmConfig: MappedLlmConfig;
}

// ============================================================================
// Mapper
// ============================================================================

/**
 * Map a shapes.inc personality config to Tzurot database structures.
 *
 * @param config - Raw shapes.inc API config (173 fields)
 * @param slug - Normalized slug for this personality (already processed by normalizeSlugForUser)
 * @returns Mapped data for SystemPrompt, Personality, and LlmConfig creation
 */
export function mapShapesConfigToPersonality(
  config: ShapesIncPersonalityConfig,
  slug: string
): MappedPersonalityData {
  const systemPrompt = mapSystemPrompt(config, slug);
  const personality = mapPersonality(config, slug);
  const llmConfig = mapLlmConfig(config, slug);

  logger.info(
    {
      slug,
      shapesUsername: config.username,
      model: llmConfig.model,
      hasJailbreak: config.jailbreak.length > 0,
    },
    '[ShapesPersonalityMapper] Mapped shapes.inc config'
  );

  return { systemPrompt, personality, llmConfig };
}

// ============================================================================
// Private mapping functions
// ============================================================================

function mapSystemPrompt(config: ShapesIncPersonalityConfig, slug: string): MappedSystemPrompt {
  const promptName = `shapes-import-${slug}`;
  return {
    id: generateSystemPromptUuid(promptName),
    name: promptName,
    content: config.jailbreak || `You are ${config.name}.`,
  };
}

function mapPersonality(config: ShapesIncPersonalityConfig, slug: string): MappedPersonality {
  // Build custom fields for overflow/unmapped data
  const customFields: Record<string, unknown> = {};

  if (config.personality_history !== undefined && config.personality_history !== '') {
    customFields.personalityHistory = config.personality_history;
  }
  if (config.keywords !== undefined && config.keywords.length > 0) {
    customFields.keywords = config.keywords;
  }
  if (config.favorite_reacts !== undefined && config.favorite_reacts.length > 0) {
    customFields.favoriteReacts = config.favorite_reacts;
  }
  if (config.search_description !== undefined && config.search_description !== '') {
    customFields.searchDescription = config.search_description;
  }
  if (config.wack_message !== undefined && config.wack_message !== '') {
    customFields.wackMessage = config.wack_message;
  }
  if (config.sleep_message !== undefined && config.sleep_message !== '') {
    customFields.sleepMessage = config.sleep_message;
  }
  if (config.birthday !== undefined && config.birthday !== '') {
    customFields.birthday = config.birthday;
  }

  // Track import source
  customFields.importSource = 'shapes_inc';
  customFields.shapesUsername = config.username;
  customFields.shapesId = config.id;

  return {
    id: generatePersonalityUuid(slug),
    name: config.name || config.username,
    slug,
    displayName: config.name || config.username,
    characterInfo: config.user_prompt || '',
    personalityTraits: config.personality_traits || '',
    personalityTone: emptyToNull(config.personality_tone),
    personalityAge: emptyToNull(config.personality_age),
    personalityAppearance: emptyToNull(config.personality_appearance),
    personalityLikes: emptyToNull(config.personality_likes),
    personalityDislikes: emptyToNull(config.personality_dislikes),
    conversationalGoals: emptyToNull(config.personality_conversational_goals),
    conversationalExamples: emptyToNull(config.personality_conversational_examples),
    errorMessage: emptyToNull(config.error_message),
    isPublic: false,
    voiceEnabled: false,
    imageEnabled: false,
    customFields: Object.keys(customFields).length > 0 ? customFields : null,
  };
}

function mapLlmConfig(config: ShapesIncPersonalityConfig, slug: string): MappedLlmConfig {
  const configName = `shapes-import-${slug}`;

  // Map engine parameters to advancedParameters JSONB
  const advancedParameters: Record<string, unknown> = {};
  if (config.engine_temperature !== undefined) {
    advancedParameters.temperature = config.engine_temperature;
  }
  if (config.engine_top_p !== undefined) {
    advancedParameters.top_p = config.engine_top_p;
  }
  if (config.engine_top_k !== undefined) {
    advancedParameters.top_k = config.engine_top_k;
  }
  if (config.engine_frequency_penalty !== undefined) {
    advancedParameters.frequency_penalty = config.engine_frequency_penalty;
  }
  if (config.engine_presence_penalty !== undefined) {
    advancedParameters.presence_penalty = config.engine_presence_penalty;
  }
  if (config.engine_repetition_penalty !== undefined) {
    advancedParameters.repetition_penalty = config.engine_repetition_penalty;
  }
  if (config.engine_min_p !== undefined) {
    advancedParameters.min_p = config.engine_min_p;
  }
  if (config.engine_top_a !== undefined) {
    advancedParameters.top_a = config.engine_top_a;
  }

  // Map model name — shapes.inc uses OpenRouter-compatible model IDs
  const model = config.engine_model || 'openai/gpt-4o';

  // Map memory settings
  const memoryLimit = config.ltm_max_retrieved_summaries || 5;
  const memoryScoreThreshold = config.ltm_threshold || 0.3;

  return {
    id: generateLlmConfigUuid(configName),
    name: configName,
    description: `Imported from shapes.inc: ${config.username}`,
    model,
    provider: 'openrouter',
    advancedParameters,
    memoryScoreThreshold,
    memoryLimit,
    contextWindowTokens: 128_000,
    maxMessages: config.stm_window || 20,
  };
}

function emptyToNull(value: string | undefined): string | null {
  if (value === undefined || value === '') {
    return null;
  }
  return value;
}
