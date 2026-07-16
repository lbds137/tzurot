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
 * - advancedParameters: JSONB with ALL sampling/reasoning/output params
 * - contextWindowTokens: Context window size (not in JSONB)
 * - name: Config name for display/logging (optional for some use cases)
 */
export const LLM_CONFIG_SELECT = {
  model: true,
  provider: true, // String column — drives provider-tier routing (e.g. 'openrouter', 'zai-coding')
  advancedParameters: true, // JSONB (snake_case)
  contextWindowTokens: true, // Integer column (not in JSONB)
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
  provider: string; // 'openrouter' | 'zai-coding' | future enum values
  advancedParameters: unknown; // JSONB - validated via Zod
  contextWindowTokens: number;
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
  /**
   * Provider routing key. String-typed (not the AIProvider enum) because the
   * DB stores it as a string column and may carry future values not yet in the
   * enum. Consumers that need to switch on it should validate against the
   * AIProvider enum at the consumption boundary.
   */
  provider: string;
  contextWindowTokens: number;
}

/**
 * Mapped config with name included.
 */
export interface MappedLlmConfigWithName extends MappedLlmConfig {
  name: string;
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
export function mapLlmConfigFromDb(raw: RawLlmConfigFromDb): MappedLlmConfig {
  // Validate and convert advancedParameters JSONB
  const params = safeValidateAdvancedParams(raw.advancedParameters);
  const converted = params !== null ? advancedParamsToConfigFormat(params) : {};

  return {
    model: raw.model,
    provider: raw.provider,
    // Spread ALL converted params (sampling, reasoning, output, OpenRouter)
    ...converted,
    // Non-JSONB field (still an individual column; model-coupled)
    contextWindowTokens: raw.contextWindowTokens,
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
