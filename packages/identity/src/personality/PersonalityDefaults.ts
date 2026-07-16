/**
 * PersonalityDefaults
 * Default value merging and placeholder replacement logic for personalities
 */

import { AI_DEFAULTS } from '@tzurot/common-types/constants/ai';
import { PLACEHOLDERS } from '@tzurot/common-types/constants/message';
import {
  mapLlmConfigFromDb,
  type MappedLlmConfig,
} from '@tzurot/common-types/services/LlmConfigMapper';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { DatabasePersonality } from './PersonalityValidator.js';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';

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
  pc: MappedLlmConfig | null,
  gc: MappedLlmConfig | null
): Pick<
  LoadedPersonality,
  'model' | 'temperature' | 'maxTokens' | 'contextWindowTokens' | 'provider'
> {
  // Nothing-configured terminal: the cascade lands on the runtime
  // fallbackTextModel setting (owner decision: no separate everyday-default
  // constant — the configured fallback IS where the cascade terminates).
  const fallbackModel = getSystemSetting('fallbackTextModel');
  return {
    model: getConfigValue(pc?.model, gc?.model, fallbackModel) ?? fallbackModel,
    // Provider routing key — cascades through personality-specific config
    // → global default → 'openrouter' fallback. Drives ProviderRouter and
    // ModelFactory branch selection at request time.
    provider: getConfigValue(pc?.provider, gc?.provider, 'openrouter') ?? 'openrouter',
    temperature:
      getConfigValue(pc?.temperature, gc?.temperature, AI_DEFAULTS.TEMPERATURE) ??
      AI_DEFAULTS.TEMPERATURE,
    // maxTokens intentionally has NO default — when not explicitly set:
    // - Reasoning models: ModelFactory scales based on reasoning.effort
    // - Standard models: OpenRouter uses per-model defaults
    maxTokens: getConfigValue(pc?.maxTokens, gc?.maxTokens),
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
  pc: MappedLlmConfig | null,
  gc: MappedLlmConfig | null
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
 * Get reasoning/thinking config
 * Includes both display preference (showThinking) and reasoning token config (reasoning)
 */
function getReasoningConfig(
  pc: MappedLlmConfig | null,
  gc: MappedLlmConfig | null
): Pick<LoadedPersonality, 'showThinking' | 'reasoning'> {
  return {
    showThinking: getConfigValue(pc?.showThinking, gc?.showThinking),
    reasoning: getConfigValue(pc?.reasoning, gc?.reasoning),
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
 * Derive avatar URL from personality slug with cache-busting timestamp
 *
 * Uses path-based versioning for Discord CDN cache-busting:
 * - Format: /avatars/{slug}-{timestamp}.png
 * - Discord's CDN ignores query params (?v=...) but treats different paths as new resources
 * - The API gateway extracts the slug from the path using regex
 *
 * Uses PUBLIC_GATEWAY_URL if available (for external access like Discord avatars),
 * falls back to GATEWAY_URL for local development
 */
export function deriveAvatarUrl(
  slug: string,
  updatedAt: Date,
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

  // Path-based versioning: timestamp in filename forces Discord CDN to fetch fresh image
  const timestamp = updatedAt.getTime();
  return `${publicUrl}/avatars/${slug}-${timestamp}.png`;
}

/**
 * Map database personality to LoadedPersonality type
 *
 * Config cascade priority:
 * 1. Personality-specific default config (db.defaultConfigLink?.llmConfig)
 * 2. Global default config (globalDefaultConfig parameter)
 * 3. The runtime fallback settings (fallbackTextModel, etc.) as the cascade terminal
 *
 * Placeholder handling:
 * - User placeholders ({user}, {{user}}) are normalized to {user}
 * - Assistant placeholders ({assistant}, {shape}, {{char}}, {personality}) are replaced with the personality name
 */
export function mapToPersonality(
  db: DatabasePersonality,
  globalDefaultConfig: MappedLlmConfig | null = null,
  logger: { warn: (obj: object, msg: string) => void }
): LoadedPersonality {
  // Map personality-specific config from database using the shared mapper
  // This converts advancedParameters JSONB to camelCase format
  const personalityConfig = db.defaultConfigLink?.llmConfig
    ? mapLlmConfigFromDb(db.defaultConfigLink.llmConfig)
    : null;

  return {
    // Identity fields
    id: db.id,
    name: db.name,
    displayName: db.displayName ?? db.name,
    slug: db.slug,
    // Owner UUID, used by diagnostic-log snapshots so /inspect can render
    // owner-vs-non-owner views with the right redaction. PERSONALITY_SELECT
    // already queries this column.
    ownerId: db.ownerId,
    // Avatar URL with path-based cache-busting (timestamp in filename)
    // Discord CDN ignores query params, so we embed the timestamp in the path
    avatarUrl: deriveAvatarUrl(db.slug, db.updatedAt, logger),

    // LLM configuration (cascaded from personality > global > defaults).
    // Memory + context-limit settings (memoryScoreThreshold/memoryLimit,
    // maxMessages/maxAge/maxImages) are NOT sourced here — they come from the
    // config-override cascade at request time, not the LlmConfig columns.
    ...getRequiredLlmConfig(personalityConfig, globalDefaultConfig),
    ...getSamplingConfig(personalityConfig, globalDefaultConfig),
    ...getReasoningConfig(personalityConfig, globalDefaultConfig),

    // Character definition fields (with placeholders replaced)
    ...processCharacterFields(db),

    // Custom error message
    errorMessage: db.errorMessage ?? undefined,

    // Voice configuration
    voiceEnabled: db.voiceEnabled,
  };
}
