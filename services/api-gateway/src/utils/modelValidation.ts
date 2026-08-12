/**
 * Model Validation Utilities
 *
 * Server-side validation for model IDs and context window settings.
 * Used by both user and admin LLM config routes.
 */

import { getZaiCodingPlanContextLength, ZAI_MODEL_PREFIX } from '@tzurot/common-types/constants/ai';
import { computeContextCap } from '@tzurot/common-types/utils/contextWindowCap';
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
 * Compute the graduated context-window cap for a model and check the requested
 * contextWindowTokens against it. Shared by the OpenRouter and z.ai validation
 * paths so both produce identical cap math and error wording. The only
 * difference between the two paths is where `contextLength` comes from
 * (OpenRouter cache vs. z.ai catalog).
 */
function checkContextWindowCap(
  modelId: string,
  contextWindowTokens: number | undefined,
  contextLength: number
): ModelValidationResult {
  const cap = computeContextCap(contextLength);
  if (contextWindowTokens !== undefined && contextWindowTokens > cap) {
    const contextK = Math.round(contextLength / 1000);
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

/**
 * Validate a model ID and enforce
 * contextWindowTokens <= computeContextCap(context_length) — the graduated
 * headroom cap shared with ai-worker's runtime clamp (see
 * common-types/utils/contextWindowCap.ts for the rationale).
 *
 * Two validation paths, mirroring runtime provider routing:
 *
 * 1. **z.ai catalog** (when `hasZaiCodingKey` and the model is a `z-ai/<model>`
 *    in the coding-plan catalog): validate against the catalog's context
 *    length. This mirrors `ProviderRouter.tryAutoPromoteToZai` — a user with a
 *    z.ai-coding key will have the request promoted to z.ai-direct at runtime,
 *    so it must be validated against z.ai's limits, not OpenRouter's. It also
 *    unblocks z.ai-only models (e.g. `glm-5.2`) that aren't on OpenRouter at
 *    all — while still capping them, so a bad config can't overflow at the
 *    provider.
 *
 * 2. **OpenRouter cache** (everything else): validate against the cache and
 *    reject BOTH on a genuine miss (unknown model) and on an unreachable
 *    catalog (e.g. OpenRouter is down) — the two produce distinct error
 *    messages so an outage isn't misdiagnosed as a typo. Pinned by the
 *    `modelValidation.test.ts` describe block "catalog-unavailable vs.
 *    genuine-miss (TASK-539)". The ONLY case that skips validation entirely
 *    is `modelCache === undefined` (the cache was never wired), handled
 *    below.
 *
 * @param modelCache - OpenRouter model cache (may be undefined if not wired)
 * @param modelId - The model ID to validate (e.g., "anthropic/claude-sonnet-4")
 * @param contextWindowTokens - Optional context window setting to validate
 * @param hasZaiCodingKey - Whether the saving user has an active z.ai-coding
 *   key (admin/global configs pass `true`). Gates the z.ai catalog path.
 * @returns Validation result with optional error message
 */
export async function validateModelAndContextWindow(
  modelCache: OpenRouterModelCache | undefined,
  modelId: string | undefined,
  contextWindowTokens: number | undefined,
  hasZaiCodingKey = false
): Promise<ModelValidationResult> {
  if (modelId === undefined) {
    return {};
  }

  // z.ai path first: a `z-ai/`-prefixed coding-plan model + a key means runtime
  // will promote to z.ai-direct, so validate against the catalog (not
  // OpenRouter). Falls through to the OpenRouter path for non-catalog models or
  // when no key.
  //
  // The prefix guard is load-bearing: `getZaiCodingPlanContextLength` also
  // accepts BARE names (`glm-5`) because the runtime resolver sees the promoted
  // bare form. But ProviderRouter only promotes `z-ai/`-prefixed models, so a
  // saved bare `glm-5` would NOT promote — it'd hit OpenRouter as a bare ID that
  // doesn't exist there. Validation must mirror the router's prefix gate, or it
  // accepts a config runtime can't honor.
  if (hasZaiCodingKey && modelId.startsWith(ZAI_MODEL_PREFIX)) {
    const zaiContextLength = getZaiCodingPlanContextLength(modelId);
    if (zaiContextLength !== null) {
      return checkContextWindowCap(modelId, contextWindowTokens, zaiContextLength);
    }
  }

  // No cache available — skip validation gracefully
  if (modelCache === undefined) {
    return {};
  }

  const lookup = await modelCache.lookupModelById(modelId);

  // Catalog unreachable (e.g. OpenRouter is down) — reject, but with a
  // message that points at the outage rather than the model ID, so the user
  // isn't sent hunting a typo that doesn't exist.
  if (lookup.kind === 'unavailable') {
    return {
      error: `Could not reach the model catalog to validate '${modelId}'. This is usually temporary — try saving again in a moment.`,
    };
  }

  // Model genuinely absent from the catalog — could be a new model or a typo.
  // Reject with a helpful message.
  if (lookup.kind === 'absent') {
    // A `z-ai/`-prefixed catalog model that reached the OpenRouter lookup means
    // the saving user has no z.ai-coding key (the keyed path returns earlier) AND
    // this model isn't carried on OpenRouter either — i.e. a z.ai-only model like
    // `z-ai/glm-5.2`. The generic "not found / check the model ID" message
    // misdescribes the fix: the id is valid, the constraint is the missing key.
    // z.ai models that DO exist on OpenRouter (glm-5.1, glm-4.7, …) are found by
    // the lookup above and never reach here, so they keep validating normally.
    if (
      !hasZaiCodingKey &&
      modelId.startsWith(ZAI_MODEL_PREFIX) &&
      getZaiCodingPlanContextLength(modelId) !== null
    ) {
      return {
        error:
          `Model '${modelId}' is served by the z.ai Coding Plan. ` +
          'Add a z.ai-coding API key with /settings apikey set to use it.',
      };
    }
    return {
      error:
        `Model '${modelId}' not found in the available models list. ` +
        'Use the model autocomplete to select a valid model, or check if the model ID is correct.',
    };
  }

  return checkContextWindowCap(modelId, contextWindowTokens, lookup.model.contextLength);
}

/**
 * Decide whether a saved config's model should show a "requires z.ai key" badge
 * for the viewing user — i.e. the preset references a z.ai coding-plan model the
 * viewer cannot actually run without a z.ai-coding key.
 *
 * Mirrors the dedicated-error condition in `validateModelAndContextWindow`'s
 * not-found branch, so the dashboard badge and the save-time error agree on what
 * "needs a z.ai key" means:
 *
 * - viewer has a z.ai key → no badge (the model is promoted to z.ai-direct for them)
 * - model isn't a `z-ai/`-prefixed catalog member → no badge (ordinary model)
 * - model IS on OpenRouter (glm-5.1, glm-4.7, …) → no badge: a keyless viewer
 *   runs it on OpenRouter at runtime, so the preset works for them
 * - model is z.ai-only (absent from OpenRouter, e.g. glm-5.2) → BADGE: a keyless
 *   viewer's OpenRouter fallthrough would 404 at runtime
 *
 * When the catalog is unavailable we can't confirm OpenRouter absence, so we
 * return `false` (no badge) rather than risk a false positive — same
 * graceful-degrade stance as `enrichWithModelContext`. That requires the
 * TAGGED lookup: `getModelById` reports an outage and a genuine absence as the
 * same `null`, so branching on it showed the badge during an outage, which is
 * the opposite of what this paragraph promised. Pinned by the
 * `computeRequiresZaiKey` test "does NOT badge when the catalog is
 * unreachable".
 */
export async function computeRequiresZaiKey(
  model: string | undefined,
  hasZaiCodingKey: boolean,
  modelCache: OpenRouterModelCache | undefined
): Promise<boolean> {
  if (model === undefined || hasZaiCodingKey) {
    return false;
  }
  if (!model.startsWith(ZAI_MODEL_PREFIX) || getZaiCodingPlanContextLength(model) === null) {
    return false;
  }
  if (modelCache === undefined) {
    return false;
  }
  // Only a CONFIRMED absence earns the badge; `resolved` means it runs on
  // OpenRouter, and `unavailable` means we don't know.
  return (await modelCache.lookupModelById(model)).kind === 'absent';
}

/** Object with optional model context fields, set by enrichWithModelContext */
interface ModelContextEnrichable {
  modelContextLength?: number;
  contextWindowCap?: number;
}

/**
 * Enrich an API response object with model context window info.
 * Adds `modelContextLength` and `contextWindowCap` fields if the model's
 * context length is resolvable. Gracefully skips if neither source has it.
 *
 * Two resolution sources, matching the validation paths: z.ai catalog first
 * (so z.ai-only models like `glm-5.2` — absent from the OpenRouter cache —
 * still show their cap in the dashboard), then the OpenRouter cache.
 *
 * Used by GET/create/update handlers so the bot-client can display
 * context window cap info in the preset dashboard.
 */
export async function enrichWithModelContext(
  response: ModelContextEnrichable,
  model: string | undefined,
  modelCache: OpenRouterModelCache | undefined
): Promise<void> {
  if (model === undefined) {
    return;
  }

  // Mirror the validation path's prefix gate: only `z-ai/`-prefixed models
  // resolve from the z.ai catalog. A bare `glm-5` runs on OpenRouter at
  // runtime, so its dashboard cap must come from the OpenRouter cache too.
  if (model.startsWith(ZAI_MODEL_PREFIX)) {
    const zaiContextLength = getZaiCodingPlanContextLength(model);
    if (zaiContextLength !== null) {
      response.modelContextLength = zaiContextLength;
      response.contextWindowCap = computeContextCap(zaiContextLength);
      return;
    }
  }

  if (modelCache === undefined) {
    return;
  }
  const modelInfo = await modelCache.getModelById(model);
  if (modelInfo === null) {
    return;
  }
  response.modelContextLength = modelInfo.contextLength;
  response.contextWindowCap = computeContextCap(modelInfo.contextLength);
}
