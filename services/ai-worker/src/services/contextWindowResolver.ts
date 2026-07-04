/**
 * Context Window Resolver
 *
 * Resolves the input-token budget for a generation: the configured
 * contextWindowTokens clamped to the model's real limit when known.
 * Gateway validation rejects new oversized saves; this clamp protects
 * generations driven by already-saved rows (and the schema's 131072
 * default) that exceed what the model can actually hold.
 */

import { getZaiCodingPlanContextLength, AIProvider } from '@tzurot/common-types/constants/ai';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { clampContextWindow } from '@tzurot/common-types/utils/contextWindowCap';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { checkModelContextLength } from '../redis.js';

const logger = createLogger('ContextWindowResolver');

/**
 * Resolve the model's real context limit (tokens) from whichever provider the
 * request will actually run on — the source must match the destination, since
 * z.ai and OpenRouter document different limits for the same model (z.ai
 * documents glm-5.1 at 200K; OpenRouter's card says 202752).
 *
 * - **z.ai-direct** (the request was promoted onto the coding plan): use z.ai's
 *   documented limit from the catalog. This is also the ONLY source for
 *   z.ai-only models (glm-5.2), which never appear in the OpenRouter cache.
 * - **OpenRouter** (or unknown provider — keyless fallthrough): use the
 *   OpenRouter cache. Safety-net: if the cache misses for a model that IS a
 *   z.ai catalog member (e.g. a z.ai-only model that somehow reached the
 *   OpenRouter path), fall back to the catalog so it still clamps rather than
 *   running unbounded.
 *
 * Returns `null` when neither source knows the model — the caller degrades
 * gracefully to the configured value.
 */
async function resolveModelContextLength(
  model: string,
  effectiveProvider: AIProvider | undefined
): Promise<number | null> {
  // Note: `getZaiCodingPlanContextLength` accepts bare names (`glm-5`) as well
  // as the prefixed `z-ai/glm-5` form. That's intentional asymmetry with the
  // gateway's save-time validation, which gates the catalog on the `z-ai/`
  // prefix (a bare `glm-5` must not be *saveable* since ProviderRouter only
  // promotes prefixed models). At runtime a clamp only ever reduces the budget,
  // so recognizing a stale bare-name config and capping it is strictly safer
  // than leaving it unclamped — save-correctness needs the guard, runtime
  // safety doesn't.
  if (effectiveProvider === AIProvider.ZaiCoding) {
    return getZaiCodingPlanContextLength(model);
  }
  const openRouterLength = await checkModelContextLength(model);
  return openRouterLength ?? getZaiCodingPlanContextLength(model);
}

/**
 * Resolve the effective context window for a generation: the configured
 * `contextWindowTokens` clamped to the model's real limit. Gateway validation
 * rejects new oversized saves; this clamp protects generations driven by
 * already-saved rows (and the schema's 131072 default) that exceed the limit.
 *
 * `effectiveProvider` is the provider the request will actually hit after
 * ProviderRouter (`auth.provider` in the pipeline) — it determines which
 * provider's limit applies (see `resolveModelContextLength`). Omitted (e.g. in
 * tests) it defaults to the OpenRouter path with the catalog safety-net.
 *
 * Unknown models degrade gracefully to the configured value. Logs when the
 * clamp engages — the "this preset is configured above the model's limit"
 * signal.
 */
export async function resolveEffectiveContextWindow(
  personality: LoadedPersonality,
  effectiveProvider?: AIProvider
): Promise<number> {
  const configured = personality.contextWindowTokens;
  const modelContextLength = await resolveModelContextLength(personality.model, effectiveProvider);
  const effective = clampContextWindow(configured, modelContextLength);
  if (effective < configured) {
    // warn, not info: this fires on every generation until the stored config
    // is corrected — it's a persistent misconfiguration signal, not routine flow
    logger.warn(
      { model: personality.model, configured, modelContextLength, effective, effectiveProvider },
      'Clamped context window to model limit'
    );
  }
  return effective;
}
