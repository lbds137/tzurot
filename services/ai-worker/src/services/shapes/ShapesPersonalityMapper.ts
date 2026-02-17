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
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
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

/** String custom fields: config key → customFields key */
const STRING_CUSTOM_FIELDS = [
  { configKey: 'personality_history', customKey: 'personalityHistory' },
  { configKey: 'search_description', customKey: 'searchDescription' },
  { configKey: 'wack_message', customKey: 'wackMessage' },
  { configKey: 'sleep_message', customKey: 'sleepMessage' },
  { configKey: 'birthday', customKey: 'birthday' },
] as const;

/** Array custom fields: config key → customFields key */
const ARRAY_CUSTOM_FIELDS = [
  { configKey: 'keywords', customKey: 'keywords' },
  { configKey: 'favorite_reacts', customKey: 'favoriteReacts' },
] as const;

function buildCustomFields(config: ShapesIncPersonalityConfig): Record<string, unknown> {
  const customFields: Record<string, unknown> = {};

  // Data-driven: string fields (non-empty → include)
  for (const { configKey, customKey } of STRING_CUSTOM_FIELDS) {
    const value = config[configKey];
    if (typeof value === 'string' && value !== '') {
      customFields[customKey] = value;
    }
  }

  // Data-driven: array fields (non-empty → include)
  for (const { configKey, customKey } of ARRAY_CUSTOM_FIELDS) {
    const value = config[configKey];
    if (Array.isArray(value) && value.length > 0) {
      customFields[customKey] = value;
    }
  }

  // Capture initial message from shape_settings (comes through [key: string]: unknown catch-all)
  const shapeSettings = config.shape_settings as { shape_initial_message?: string } | undefined;
  if (
    shapeSettings?.shape_initial_message !== undefined &&
    shapeSettings.shape_initial_message !== ''
  ) {
    customFields.initialMessage = shapeSettings.shape_initial_message;
  }

  // Track import source
  customFields.importSource = 'shapes_inc';
  customFields.shapesUsername = config.username;
  customFields.shapesId = config.id;

  return customFields;
}

function mapPersonality(config: ShapesIncPersonalityConfig, slug: string): MappedPersonality {
  const customFields = buildCustomFields(config);

  // Parse birthday into typed columns (raw string kept in customFields as fallback)
  const birthday =
    config.birthday !== undefined && config.birthday !== ''
      ? parseBirthday(config.birthday)
      : { month: null, day: null, year: null };

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
    birthMonth: birthday.month,
    birthDay: birthday.day,
    birthYear: birthday.year,
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

interface ParsedBirthday {
  month: number | null;
  day: number | null;
  year: number | null;
}

/**
 * Parse a birthday string into typed month/day/year components.
 * Handles common formats:
 * - "MM-DD" → month + day, no year
 * - "YYYY-MM-DD" → month + day + year
 * Returns all nulls on parse failure (raw string kept in customFields as fallback).
 *
 * Note: Feb 29 is accepted even without a year, since we can't validate leap years
 * when only MM-DD is provided. The raw string is always preserved in customFields
 * for downstream consumers that need stricter validation.
 */
/** Max days per month (index 0 = January). Uses 29 for Feb to allow leap years. */
const MAX_DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isValidMonthDay(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= MAX_DAYS_IN_MONTH[month - 1];
}

export function parseBirthday(value: string): ParsedBirthday {
  const nullResult: ParsedBirthday = { month: null, day: null, year: null };

  // Try YYYY-MM-DD first
  const fullMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (fullMatch !== null) {
    const year = parseInt(fullMatch[1], 10);
    const month = parseInt(fullMatch[2], 10);
    const day = parseInt(fullMatch[3], 10);
    if (isValidMonthDay(month, day)) {
      return { month, day, year };
    }
    return nullResult;
  }

  // Try MM-DD
  const shortMatch = /^(\d{1,2})-(\d{1,2})$/.exec(value);
  if (shortMatch !== null) {
    const month = parseInt(shortMatch[1], 10);
    const day = parseInt(shortMatch[2], 10);
    if (isValidMonthDay(month, day)) {
      return { month, day, year: null };
    }
    return nullResult;
  }

  return nullResult;
}

function emptyToNull(value: string | undefined): string | null {
  if (value === undefined || value === '') {
    return null;
  }
  return value;
}
