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
import { DEFAULT_CONFIG_KIND, toConfigKind, type ConfigKind } from '@tzurot/common-types';
import { sendError } from './responseHelpers.js';
import { ErrorResponses } from './errorResponses.js';
import { validateModelAndContextWindow } from './modelValidation.js';
import { ModelCapabilityService } from '../services/ModelCapabilityService.js';
import type { OpenRouterModelCache } from '../services/OpenRouterModelCache.js';
import type { LlmConfigService } from '../services/LlmConfigService.js';

/**
 * Options for validating the model/contextWindow fields of an LLM config body.
 *
 * The `fallback` property distinguishes create from update semantics:
 *
 * - **Create path**: omit `fallback`. The helper forwards `body.model` directly
 *   to `validateModelAndContextWindow`, which handles an undefined model
 *   gracefully (skips model-specific checks and returns no error). So a create
 *   body without `model` is valid — validation simply has nothing to verify
 *   about the model in that case. Same goes for `modelCache: undefined`.
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
   * Whether the saving user has an active z.ai-coding API key. Gates the z.ai
   * catalog validation path in `validateModelAndContextWindow`: a user with a
   * key gets `z-ai/<model>` requests promoted to z.ai-direct at runtime, so
   * the model must be validated against z.ai's catalog (not OpenRouter). Admin
   * /global configs pass `true` (any user with a key can use the preset; users
   * without one fall through to OpenRouter at runtime). Defaults to `false`.
   */
  hasZaiCodingKey?: boolean;
  /**
   * Only present on update-path calls. Lets the helper fetch the current
   * model if the update body omits `model` but changes `contextWindowTokens`.
   */
  fallback?: {
    service: LlmConfigService;
    configId: string;
  };
  /**
   * Config kind, gating the vision capability check. Pass it explicitly on the
   * **create** path (from `body.kind`). On the **update** path leave it
   * undefined — kind is immutable (never in the update body), so the helper
   * derives it from the existing row via `fallback`. When neither is available
   * it defaults to {@link DEFAULT_CONFIG_KIND} (text), which never rejects.
   */
  kind?: ConfigKind;
}

/**
 * Resolve the effective model + kind for validation. On the update path the
 * stored row is the source of truth for both: the model fallback (when the body
 * omits it, so contextWindowTokens can still be validated against a known model)
 * AND the immutable kind (never in the update body, so only knowable from the
 * row). A single getById serves both, fetched only when something needs it:
 *  - model fallback: the body omits `model`.
 *  - kind for the capability gate: a model IS being set and kind is unknown
 *    (the update path never passes kind). A context-only edit doesn't need the
 *    kind, so it isn't derived.
 */
async function resolveEffectiveModelAndKind(
  opts: ValidateLlmConfigModelFieldsOptions
): Promise<{ effectiveModel: string | undefined; effectiveKind: ConfigKind }> {
  const { body, fallback, kind } = opts;
  let effectiveModel = body.model;
  let effectiveKind: ConfigKind = kind ?? DEFAULT_CONFIG_KIND;
  if (fallback !== undefined) {
    const needModelFallback = effectiveModel === undefined;
    const needKind = kind === undefined && body.model !== undefined;
    if (needModelFallback || needKind) {
      const current = await fallback.service.getById(fallback.configId);
      if (needModelFallback) {
        effectiveModel = current?.model;
      }
      if (needKind && current !== null) {
        effectiveKind = toConfigKind(current.kind);
      }
    }
  }
  return { effectiveModel, effectiveKind };
}

/**
 * Vision capability gate — fail closed. A vision config's model MUST be confirmed
 * vision-capable; the prod failure the epic targets is a vision config silently
 * pointing at a text-only model (→ no image description → the LLM improvises).
 * On failure sends a 400 and returns false; returns true when the model is
 * confirmed vision-capable.
 */
async function ensureVisionCapableModel(
  res: Response,
  modelCache: OpenRouterModelCache | undefined,
  model: string
): Promise<boolean> {
  const capabilities = await new ModelCapabilityService(modelCache).resolve(model);
  if (capabilities === null) {
    sendError(
      res,
      ErrorResponses.validationError(
        `Couldn't confirm '${model}' supports image input (vision) — it isn't in the model catalog. ` +
          `Choose a vision-capable model for a vision preset.`
      )
    );
    return false;
  }
  if (!capabilities.supportsVision) {
    sendError(
      res,
      ErrorResponses.validationError(
        `Model '${model}' doesn't support image input (vision). Choose a vision-capable model for a vision preset.`
      )
    );
    return false;
  }
  return true;
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
  const { res, modelCache, body, fallback, hasZaiCodingKey = false } = opts;

  // Update path: skip entirely when neither model nor contextWindowTokens is present.
  // A no-op update doesn't need model validation.
  if (
    fallback !== undefined &&
    body.model === undefined &&
    body.contextWindowTokens === undefined
  ) {
    return true;
  }

  const { effectiveModel, effectiveKind } = await resolveEffectiveModelAndKind(opts);

  const result = await validateModelAndContextWindow(
    modelCache,
    effectiveModel,
    body.contextWindowTokens,
    hasZaiCodingKey
  );

  if (result.error !== undefined) {
    sendError(res, ErrorResponses.validationError(result.error));
    return false;
  }

  // Vision capability gate. Only runs when a model is actually being SET — create
  // always sets one; update only when `body.model` is present — so a context-only
  // edit doesn't re-validate an unchanged model. Text configs never reach here;
  // vision models are also text-capable.
  if (effectiveKind === 'vision' && body.model !== undefined) {
    return ensureVisionCapableModel(res, modelCache, body.model);
  }

  return true;
}
