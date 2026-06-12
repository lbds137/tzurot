/**
 * Model Validation Utilities
 *
 * Server-side validation for model IDs and context window settings.
 * Used by both user and admin LLM config routes.
 */

import { computeContextCap } from '@tzurot/common-types';
import type { OpenRouterModelCache } from '../services/OpenRouterModelCache.js';

/**
 * Result of model validation.
 * If `error` is set, the request should be rejected with a 400.
 */
export interface ModelValidationResult {
  /** Error message if validation failed, undefined if OK */
  error?: string;
  /** Validated context window cap, undefined if model unknown */
  contextWindowCap?: number;
}

/**
 * Validate a model ID against the OpenRouter model cache and enforce
 * contextWindowTokens <= computeContextCap(context_length) — the graduated
 * headroom cap shared with ai-worker's runtime clamp (see
 * common-types/utils/contextWindowCap.ts for the rationale).
 *
 * Gracefully degrades: if the model cache is unavailable (e.g., OpenRouter
 * is down), validation is skipped and the request proceeds.
 *
 * @param modelCache - OpenRouter model cache (may be undefined if not wired)
 * @param modelId - The model ID to validate (e.g., "anthropic/claude-sonnet-4")
 * @param contextWindowTokens - Optional context window setting to validate
 * @returns Validation result with optional error message
 */
export async function validateModelAndContextWindow(
  modelCache: OpenRouterModelCache | undefined,
  modelId: string | undefined,
  contextWindowTokens: number | undefined
): Promise<ModelValidationResult> {
  // No cache available — skip validation gracefully
  if (modelCache === undefined || modelId === undefined) {
    return {};
  }

  const model = await modelCache.getModelById(modelId);

  // Model not found in cache — could be a new model or cache is stale
  // Reject with a helpful message
  if (model === null) {
    return {
      error:
        `Model '${modelId}' not found in the available models list. ` +
        'Use the model autocomplete to select a valid model, or check if the model ID is correct.',
    };
  }

  const cap = computeContextCap(model.contextLength);
  if (contextWindowTokens !== undefined && contextWindowTokens > cap) {
    const contextK = Math.round(model.contextLength / 1000);
    const capK = Math.round(cap / 1000);
    return {
      error:
        `Context window setting (${contextWindowTokens} tokens) exceeds the safe limit for '${modelId}'. ` +
        `Model supports ${contextK}K tokens; maximum allowed for this model is ${capK}K (${cap} tokens) ` +
        `to leave room for the response. Reduce the Context Window value before saving.`,
      contextWindowCap: cap,
    };
  }

  return { contextWindowCap: cap };
}

/** Object with optional model context fields, set by enrichWithModelContext */
interface ModelContextEnrichable {
  modelContextLength?: number;
  contextWindowCap?: number;
}

/**
 * Enrich an API response object with model context window info.
 * Adds `modelContextLength` and `contextWindowCap` fields if the model
 * is found in the cache. Gracefully skips if cache or model is unavailable.
 *
 * Used by GET/create/update handlers so the bot-client can display
 * context window cap info in the preset dashboard.
 */
export async function enrichWithModelContext(
  response: ModelContextEnrichable,
  model: string | undefined,
  modelCache: OpenRouterModelCache | undefined
): Promise<void> {
  if (modelCache === undefined || model === undefined) {
    return;
  }
  const modelInfo = await modelCache.getModelById(model);
  if (modelInfo === null) {
    return;
  }
  response.modelContextLength = modelInfo.contextLength;
  response.contextWindowCap = computeContextCap(modelInfo.contextLength);
}
