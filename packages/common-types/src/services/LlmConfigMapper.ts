/**
 * LLM Config Mapper
 *
 * Single source of truth for reading and transforming LLM config data from the database.
 *
 * This module provides:
 * - `LLM_CONFIG_SELECT`: Prisma select constant for LlmConfig queries
 * - `RawLlmConfigFromDb`: Raw shape from Prisma query
 * - `MappedLlmConfig`: Transformed shape for application use
 * - `mapLlmConfigFromDb()`: Transform function
 *
 * Used by:
 * - PersonalityLoader (personality default configs)
 * - LlmConfigResolver (user config overrides)
 */

import {
  safeValidateAdvancedParams,
  advancedParamsToConfigFormat,
  type ConvertedLlmParams,
} from '../schemas/llmAdvancedParams.js';
import { CONFIG_KINDS, DEFAULT_CONFIG_KIND, type ConfigKind } from '../constants/ai.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('LlmConfigMapper');

// ============================================
// PRISMA SELECT CONSTANT
// ============================================

/**
 * Shared Prisma select for LlmConfig queries.
 *
 * This ensures consistency across all code paths that read LLM configs.
 * Uses the JSONB advancedParameters column (not legacy individual columns).
 *
 * Fields included:
 * - model: Model identifier
 * - kind: 'text' | 'vision' discriminator (vision configs are their own presets)
 * - advancedParameters: JSONB with ALL sampling/reasoning/output params
 * - memoryScoreThreshold, memoryLimit: Memory-related settings (not in JSONB)
 * - contextWindowTokens: Context window size (not in JSONB)
 * - name: Config name for display/logging (optional for some use cases)
 */
export const LLM_CONFIG_SELECT = {
  model: true,
  kind: true, // 'text' | 'vision' discriminator (vision rows are their own presets)
  provider: true, // String column — drives provider-tier routing (e.g. 'openrouter', 'zai-coding')
  advancedParameters: true, // JSONB (snake_case)
  memoryScoreThreshold: true, // Decimal column (not in JSONB)
  memoryLimit: true, // Integer column (not in JSONB)
  contextWindowTokens: true, // Integer column (not in JSONB)
  // Context settings - typed columns (not JSONB)
  maxMessages: true, // Max messages to fetch from conversation history
  maxAge: true, // Max age in seconds (null = no limit)
  maxImages: true, // Max images to process from extended context
} as const;

/**
 * Extended select that includes config name.
 * Use this when you need to display or log which config was used.
 */
export const LLM_CONFIG_SELECT_WITH_NAME = {
  ...LLM_CONFIG_SELECT,
  name: true,
} as const;

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Raw shape from Prisma query using LLM_CONFIG_SELECT.
 *
 * Note: Prisma returns `unknown` for JSONB columns and a Decimal type
 * for decimal columns. This interface represents that raw shape.
 */
export interface RawLlmConfigFromDb {
  model: string;
  kind: string; // 'text' | 'vision'
  provider: string; // 'openrouter' | 'zai-coding' | future enum values
  advancedParameters: unknown; // JSONB - validated via Zod
  memoryScoreThreshold: unknown; // Prisma Decimal - converted via toNumber()
  memoryLimit: number | null;
  contextWindowTokens: number;
  // Context settings - typed columns
  maxMessages: number;
  maxAge: number | null;
  maxImages: number;
}

/**
 * Raw shape with name included.
 */
export interface RawLlmConfigFromDbWithName extends RawLlmConfigFromDb {
  name: string;
}

/**
 * Mapped LLM config for application use.
 *
 * Extends ConvertedLlmParams (which includes ALL advanced parameters)
 * with database-specific fields that aren't in the JSONB column.
 */
export interface MappedLlmConfig extends ConvertedLlmParams {
  model: string;
  kind: ConfigKind; // validated from the raw DB string via toConfigKind()
  /**
   * Provider routing key. String-typed (not the AIProvider enum) because the
   * DB stores it as a string column and may carry future values not yet in the
   * enum. Consumers that need to switch on it should validate against the
   * AIProvider enum at the consumption boundary.
   */
  provider: string;
  memoryScoreThreshold: number | null;
  memoryLimit: number | null;
  contextWindowTokens: number;
  // Context settings
  maxMessages: number;
  maxAge: number | null;
  maxImages: number;
}

/**
 * Mapped config with name included.
 */
export interface MappedLlmConfigWithName extends MappedLlmConfig {
  name: string;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Convert Prisma Decimal to number with type safety.
 *
 * Handles Prisma's Decimal type which has a toNumber() method.
 * Validates the result is actually a number to catch any future
 * changes in Prisma's internal implementation.
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  // Handle Prisma Decimal (has toNumber method)
  if (
    typeof value === 'object' &&
    value !== null &&
    'toNumber' in value &&
    typeof (value as Record<string, unknown>).toNumber === 'function'
  ) {
    const result = (value as { toNumber: () => unknown }).toNumber();
    if (typeof result === 'number') {
      return result;
    }
    logger.warn({ valueType: typeof result }, 'Prisma Decimal.toNumber() returned non-number');
    return null;
  }
  logger.warn({ valueType: typeof value }, 'Unexpected value type in toNumber');
  return null;
}

// ============================================
// TRANSFORMATION FUNCTIONS
// ============================================

/**
 * Transform raw DB result to application format.
 *
 * This function:
 * 1. Validates and parses the advancedParameters JSONB
 * 2. Converts snake_case params to camelCase
 * 3. Converts Prisma Decimal to number
 * 4. Returns a clean, typed object
 *
 * @param raw - Raw result from Prisma query using LLM_CONFIG_SELECT
 * @returns Mapped config ready for use in application code
 */
/**
 * Narrow a raw DB `kind` string to a {@link ConfigKind}. The column is constrained
 * (default 'text', only our own code writes it), so this normally just narrows the
 * type; an unrecognized value defensively falls back to the default kind rather than
 * propagating an unknown discriminator through the resolver cascade.
 */
export function toConfigKind(value: string): ConfigKind {
  if ((CONFIG_KINDS as readonly string[]).includes(value)) {
    return value as ConfigKind;
  }
  // Should never fire (the column is constrained + defaulted) — but if a malformed
  // kind reaches here via schema drift or a partial deploy, the silent floor to 'text'
  // would make a vision row resolve as text and quietly fall to the vision fallback.
  // Warn so the drift is observable rather than invisible.
  logger.warn(
    { actual: value, validKinds: CONFIG_KINDS },
    'Unknown LlmConfig.kind — flooring to default (text)'
  );
  return DEFAULT_CONFIG_KIND;
}

export function mapLlmConfigFromDb(raw: RawLlmConfigFromDb): MappedLlmConfig {
  // Validate and convert advancedParameters JSONB
  const params = safeValidateAdvancedParams(raw.advancedParameters);
  const converted = params !== null ? advancedParamsToConfigFormat(params) : {};

  return {
    model: raw.model,
    kind: toConfigKind(raw.kind),
    provider: raw.provider,
    // Spread ALL converted params (sampling, reasoning, output, OpenRouter)
    ...converted,
    // Non-JSONB fields (still use individual columns)
    memoryScoreThreshold: toNumber(raw.memoryScoreThreshold),
    memoryLimit: raw.memoryLimit,
    contextWindowTokens: raw.contextWindowTokens,
    // Context settings (typed columns)
    maxMessages: raw.maxMessages,
    maxAge: raw.maxAge,
    maxImages: raw.maxImages,
  };
}

/**
 * Transform raw DB result with name to application format.
 *
 * @param raw - Raw result from Prisma query using LLM_CONFIG_SELECT_WITH_NAME
 * @returns Mapped config with name included
 */
export function mapLlmConfigFromDbWithName(
  raw: RawLlmConfigFromDbWithName
): MappedLlmConfigWithName {
  const base = mapLlmConfigFromDb(raw);
  return {
    ...base,
    name: raw.name,
  };
}
