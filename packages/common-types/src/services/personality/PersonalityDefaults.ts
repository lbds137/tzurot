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

  // Merge configs with proper precedence: Personality > Global > Hardcoded Defaults
  const temperature =
    personalityConfig?.temperature ?? globalDefaultConfig?.temperature ?? AI_DEFAULTS.TEMPERATURE;
  const maxTokens =
    personalityConfig?.maxTokens ?? globalDefaultConfig?.maxTokens ?? AI_DEFAULTS.MAX_TOKENS;
  const topP = personalityConfig?.topP ?? globalDefaultConfig?.topP;
  const frequencyPenalty =
    personalityConfig?.frequencyPenalty ?? globalDefaultConfig?.frequencyPenalty;
  const presencePenalty =
    personalityConfig?.presencePenalty ?? globalDefaultConfig?.presencePenalty;
  const memoryScoreThreshold =
    personalityConfig?.memoryScoreThreshold ?? globalDefaultConfig?.memoryScoreThreshold;
  const memoryLimit = personalityConfig?.memoryLimit ?? globalDefaultConfig?.memoryLimit;

  // Replace placeholders in text fields
  // This normalizes legacy imports and ensures consistency
  const systemPrompt = replacePlaceholders(db.systemPrompt?.content, db.name) ?? '';
  const characterInfo = replacePlaceholders(db.characterInfo, db.name) ?? db.characterInfo;
  const personalityTraits =
    replacePlaceholders(db.personalityTraits, db.name) ?? db.personalityTraits;

  return {
    id: db.id,
    name: db.name,
    displayName: db.displayName ?? db.name,
    slug: db.slug,
    systemPrompt,
    model: personalityConfig?.model ?? globalDefaultConfig?.model ?? MODEL_DEFAULTS.DEFAULT_MODEL,
    visionModel: personalityConfig?.visionModel ?? globalDefaultConfig?.visionModel ?? undefined,
    temperature,
    maxTokens,
    topP,
    topK: personalityConfig?.topK ?? globalDefaultConfig?.topK ?? undefined,
    frequencyPenalty,
    presencePenalty,
    contextWindowTokens:
      personalityConfig?.contextWindowTokens ??
      globalDefaultConfig?.contextWindowTokens ??
      AI_DEFAULTS.CONTEXT_WINDOW_TOKENS,
    avatarUrl: deriveAvatarUrl(db.slug, logger),
    memoryScoreThreshold,
    memoryLimit,
    // Character definition fields (with placeholders replaced)
    characterInfo,
    personalityTraits,
    personalityTone: replacePlaceholders(db.personalityTone, db.name),
    personalityAge: replacePlaceholders(db.personalityAge, db.name),
    personalityAppearance: replacePlaceholders(db.personalityAppearance, db.name),
    personalityLikes: replacePlaceholders(db.personalityLikes, db.name),
    personalityDislikes: replacePlaceholders(db.personalityDislikes, db.name),
    conversationalGoals: replacePlaceholders(db.conversationalGoals, db.name),
    conversationalExamples: replacePlaceholders(db.conversationalExamples, db.name),
    // Custom error message (sent as webhook message from personality on LLM failures)
    errorMessage: db.errorMessage ?? undefined,
  };
}
