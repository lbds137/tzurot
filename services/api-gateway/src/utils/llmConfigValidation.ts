/**
 * LLM Config Validation Helpers
 *
 * Shared logic for the model-id + context-window validation step used by both
 * admin and user LLM config create/update routes.
 *
 * Collapses four call sites across two files (admin/llm-config.ts,
 * user/llm-config.ts) that previously duplicated the validate-and-error-respond
 * pattern, including the subtle "fetch current model as fallback" logic used
 * only on update paths.
 *
 * Deliberately scoped: does NOT bundle the preceding Zod `safeParse + sendZodError`
 * step. The two routes use different schemas (`LlmConfigCreateSchema` vs
 * `LlmConfigUpdateSchema`), and the parse idiom is a clean 3-liner that's better
 * left at each call site.
 */

import type { Response } from 'express';
import { sendError } from './responseHelpers.js';
import { ErrorResponses } from './errorResponses.js';
import { validateModelAndContextWindow } from './modelValidation.js';
import type { OpenRouterModelCache } from '../services/OpenRouterModelCache.js';
import type { LlmConfigService } from '../services/LlmConfigService.js';

/**
 * Options for validating the model/contextWindow fields of an LLM config body.
 *
 * The `fallback` property distinguishes create from update semantics:
 *
 * - **Create path**: omit `fallback`. Validation always runs, using `body.model`
 *   directly. Absence of `body.model` is allowed only when `modelCache` is
 *   undefined (graceful skip).
 * - **Update path**: pass `fallback: { service, configId }`. Validation skips
 *   entirely when neither `body.model` nor `body.contextWindowTokens` is present
 *   (no-op edit). If only `body.contextWindowTokens` is provided, the helper
 *   fetches the current config's model from `service` and validates the new
 *   context window against it.
 */
export interface ValidateLlmConfigModelFieldsOptions {
  res: Response;
  /**
   * OpenRouter model cache used to look up context-window caps.
   *
   * **Accepting `undefined` is intentional**: the underlying
   * `validateModelAndContextWindow` gracefully skips all validation when the
   * cache is absent (e.g., in local dev without an OpenRouter API key, or in
   * tests that construct routes without a cache). Callers should pass through
   * whatever cache reference they have without a pre-check.
   */
  modelCache: OpenRouterModelCache | undefined;
  body: {
    model?: string;
    contextWindowTokens?: number;
  };
  /**
   * Only present on update-path calls. Lets the helper fetch the current
   * model if the update body omits `model` but changes `contextWindowTokens`.
   */
  fallback?: {
    service: LlmConfigService;
    configId: string;
  };
}

/**
 * Validate `body.model` + `body.contextWindowTokens` against the OpenRouter
 * model cache, handling both create and update paths.
 *
 * On failure, sends a 400 validation error response and returns `false`. On
 * success (or skipped validation), returns `true`.
 *
 * @returns `true` if validation passed or was skipped, `false` if error sent
 */
export async function validateLlmConfigModelFields(
  opts: ValidateLlmConfigModelFieldsOptions
): Promise<boolean> {
  const { res, modelCache, body, fallback } = opts;

  // Update path: skip entirely when neither model nor contextWindowTokens is present.
  // A no-op update doesn't need model validation.
  if (
    fallback !== undefined &&
    body.model === undefined &&
    body.contextWindowTokens === undefined
  ) {
    return true;
  }

  // Resolve effective model. Update path with body.model absent falls back to
  // the currently-stored model so contextWindowTokens can still be validated
  // against a known model.
  let effectiveModel = body.model;
  if (effectiveModel === undefined && fallback !== undefined) {
    const current = await fallback.service.getById(fallback.configId);
    effectiveModel = current?.model;
  }

  const result = await validateModelAndContextWindow(
    modelCache,
    effectiveModel,
    body.contextWindowTokens
  );

  if (result.error !== undefined) {
    sendError(res, ErrorResponses.validationError(result.error));
    return false;
  }

  return true;
}
