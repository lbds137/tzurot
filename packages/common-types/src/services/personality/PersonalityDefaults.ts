/**
 * PersonalityDefaults
 * Default value merging and placeholder replacement logic for personalities
 */

import type { LoadedPersonality } from '../../types/schemas.js';
import { MODEL_DEFAULTS, AI_DEFAULTS, PLACEHOLDERS } from '../../constants/index.js';
import type { DatabasePersonality } from './PersonalityValidator.js';
import type { LlmConfig } from './PersonalityValidator.js';
import { parseLlmConfig } from './PersonalityValidator.js';

/**
 * Get a config value with cascade: personality > global > fallback
 */
function getConfigValue<T>(
  personalityVal: T | undefined | null,
  globalVal: T | undefined | null,
  fallback?: T
): T | undefined {
  return personalityVal ?? globalVal ?? fallback;
}

/**
 * Get required LLM config fields (these always have values via defaults)
 */
function getRequiredLlmConfig(
  pc: ReturnType<typeof parseLlmConfig>,
  gc: LlmConfig
): Pick<LoadedPersonality, 'model' | 'temperature' | 'maxTokens' | 'contextWindowTokens'> {
  return {
    model:
      getConfigValue(pc?.model, gc?.model, MODEL_DEFAULTS.DEFAULT_MODEL) ??
      MODEL_DEFAULTS.DEFAULT_MODEL,
    temperature:
      getConfigValue(pc?.temperature, gc?.temperature, AI_DEFAULTS.TEMPERATURE) ??
      AI_DEFAULTS.TEMPERATURE,
    maxTokens:
      getConfigValue(pc?.maxTokens, gc?.maxTokens, AI_DEFAULTS.MAX_TOKENS) ??
      AI_DEFAULTS.MAX_TOKENS,
    contextWindowTokens:
      getConfigValue(
        pc?.contextWindowTokens,
        gc?.contextWindowTokens,
        AI_DEFAULTS.CONTEXT_WINDOW_TOKENS
      ) ?? AI_DEFAULTS.CONTEXT_WINDOW_TOKENS,
  };
}

/**
 * Get optional sampling parameters (topP, topK, penalties)
 */
function getSamplingConfig(
  pc: ReturnType<typeof parseLlmConfig>,
  gc: LlmConfig
): Pick<
  LoadedPersonality,
  'topP' | 'topK' | 'frequencyPenalty' | 'presencePenalty' | 'repetitionPenalty'
> {
  return {
    topP: getConfigValue(pc?.topP, gc?.topP),
    topK: getConfigValue(pc?.topK, gc?.topK),
    frequencyPenalty: getConfigValue(pc?.frequencyPenalty, gc?.frequencyPenalty),
    presencePenalty: getConfigValue(pc?.presencePenalty, gc?.presencePenalty),
    repetitionPenalty: getConfigValue(pc?.repetitionPenalty, gc?.repetitionPenalty),
  };
}

/**
 * Get optional memory and vision config
 */
function getMemoryAndVisionConfig(
  pc: ReturnType<typeof parseLlmConfig>,
  gc: LlmConfig
): Pick<LoadedPersonality, 'visionModel' | 'memoryScoreThreshold' | 'memoryLimit'> {
  return {
    visionModel: getConfigValue(pc?.visionModel, gc?.visionModel),
    memoryScoreThreshold: getConfigValue(pc?.memoryScoreThreshold, gc?.memoryScoreThreshold),
    memoryLimit: getConfigValue(pc?.memoryLimit, gc?.memoryLimit),
  };
}

/**
 * Process character definition fields with placeholder replacement
 */
function processCharacterFields(
  db: DatabasePersonality
): Pick<
  LoadedPersonality,
  | 'systemPrompt'
  | 'characterInfo'
  | 'personalityTraits'
  | 'personalityTone'
  | 'personalityAge'
  | 'personalityAppearance'
  | 'personalityLikes'
  | 'personalityDislikes'
  | 'conversationalGoals'
  | 'conversationalExamples'
> {
  const rp = (text: string | null | undefined): string | undefined =>
    replacePlaceholders(text, db.name);

  return {
    systemPrompt: rp(db.systemPrompt?.content) ?? '',
    characterInfo: rp(db.characterInfo) ?? db.characterInfo,
    personalityTraits: rp(db.personalityTraits) ?? db.personalityTraits,
    personalityTone: rp(db.personalityTone),
    personalityAge: rp(db.personalityAge),
    personalityAppearance: rp(db.personalityAppearance),
    personalityLikes: rp(db.personalityLikes),
    personalityDislikes: rp(db.personalityDislikes),
    conversationalGoals: rp(db.conversationalGoals),
    conversationalExamples: rp(db.conversationalExamples),
  };
}

/**
 * Replace placeholders in text fields
 * Handles {user}, {{user}}, {assistant}, {shape}, {{char}}, {personality}
 */
export function replacePlaceholders(
  text: string | null | undefined,
  personalityName: string
): string | undefined {
  if (text === null || text === undefined || text.length === 0) {
    return undefined;
  }

  let result = text;

  // Replace user placeholders with generic "{user}" token
  // (actual user name will be injected at prompt-building time)
  for (const placeholder of PLACEHOLDERS.USER) {
    if (placeholder !== '{user}') {
      // Escape all special regex characters including backslashes
      const escapedPlaceholder = placeholder.replace(/[\\{}[\]().*+?^$|]/g, '\\$&');
      result = result.replace(new RegExp(escapedPlaceholder, 'g'), '{user}');
    }
  }

  // Replace assistant placeholders with personality name
  for (const placeholder of PLACEHOLDERS.ASSISTANT) {
    // Escape all special regex characters including backslashes
    const escapedPlaceholder = placeholder.replace(/[\\{}[\]().*+?^$|]/g, '\\$&');
    result = result.replace(new RegExp(escapedPlaceholder, 'g'), personalityName);
  }

  return result;
}

/**
 * Derive avatar URL from personality slug
 * Avatar files are named by slug: ${slug}.png
 * Uses PUBLIC_GATEWAY_URL if available (for external access like Discord avatars),
 * falls back to GATEWAY_URL for local development
 */
export function deriveAvatarUrl(
  slug: string,
  logger: { warn: (obj: object, msg: string) => void }
): string | undefined {
  const publicUrl = process.env.PUBLIC_GATEWAY_URL ?? process.env.GATEWAY_URL;
  if (publicUrl === undefined || publicUrl.length === 0) {
    logger.warn(
      {},
      '[PersonalityDefaults] No PUBLIC_GATEWAY_URL or GATEWAY_URL configured, cannot derive avatar URL'
    );
    return undefined;
  }

  return `${publicUrl}/avatars/${slug}.png`;
}

/**
 * Map database personality to LoadedPersonality type
 *
 * Config cascade priority:
 * 1. Personality-specific default config (db.defaultConfigLink?.llmConfig)
 * 2. Global default config (globalDefaultConfig parameter)
 * 3. Hardcoded env variable fallbacks (MODEL_DEFAULTS.DEFAULT_MODEL, etc.)
 *
 * Placeholder handling:
 * - User placeholders ({user}, {{user}}) are normalized to {user}
 * - Assistant placeholders ({assistant}, {shape}, {{char}}, {personality}) are replaced with the personality name
 */
export function mapToPersonality(
  db: DatabasePersonality,
  globalDefaultConfig: LlmConfig = null,
  logger: { warn: (obj: object, msg: string) => void }
): LoadedPersonality {
  // Parse personality-specific config from database (handles Decimal conversion)
  const personalityConfig = parseLlmConfig(db.defaultConfigLink?.llmConfig);

  return {
    // Identity fields
    id: db.id,
    name: db.name,
    displayName: db.displayName ?? db.name,
    slug: db.slug,
    avatarUrl: deriveAvatarUrl(db.slug, logger),
    avatarUpdatedAt: db.updatedAt,

    // LLM configuration (cascaded from personality > global > defaults)
    ...getRequiredLlmConfig(personalityConfig, globalDefaultConfig),
    ...getSamplingConfig(personalityConfig, globalDefaultConfig),
    ...getMemoryAndVisionConfig(personalityConfig, globalDefaultConfig),

    // Character definition fields (with placeholders replaced)
    ...processCharacterFields(db),

    // Custom error message
    errorMessage: db.errorMessage ?? undefined,

    // Extended context configuration (tri-state: null=auto, true=on, false=off)
    extendedContext: db.extendedContext,
  };
}
