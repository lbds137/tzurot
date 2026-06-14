/**
 * Context Window Resolver
 *
 * Resolves the input-token budget for a generation: the configured
 * contextWindowTokens clamped to the model's real limit when known.
 * Gateway validation rejects new oversized saves; this clamp protects
 * generations driven by already-saved rows (and the schema's 131072
 * default) that exceed what the model can actually hold.
 */

import {
  createLogger,
  clampContextWindow,
  getZaiCodingPlanContextLength,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { checkModelContextLength } from '../redis.js';

const logger = createLogger('ContextWindowResolver');

/**
 * Resolve the effective context window for a generation.
 *
 * Unknown models (non-OpenRouter providers, model-cache miss) degrade
 * gracefully to the configured value. Logs when the clamp engages — that's
 * the "this preset is configured above the model's limit" signal.
 *
 * z.ai coding-plan models are resolved from the static catalog FIRST: a
 * z.ai-only model (e.g. glm-5.2) never lands in the OpenRouter model cache, so
 * without the catalog lookup it would resolve to "unknown" and run unclamped —
 * exactly the overflow the gateway cap exists to prevent. The catalog matches
 * whether the configured model is the prefixed `z-ai/glm-5` form or a bare
 * promoted name.
 */
export async function resolveEffectiveContextWindow(
  personality: LoadedPersonality
): Promise<number> {
  const configured = personality.contextWindowTokens;
  // Intentional asymmetry with the gateway's save-time validation: that path
  // gates the catalog lookup on the `z-ai/` prefix (a bare `glm-5` must NOT be
  // saveable, since ProviderRouter only promotes prefixed models). Here we let
  // `getZaiCodingPlanContextLength` accept a bare name too — a clamp only ever
  // *reduces* the budget, so recognizing a stale bare-name config and capping
  // it is strictly safer than leaving it unclamped. Save-correctness needs the
  // guard; runtime-safety doesn't.
  const zaiContextLength = getZaiCodingPlanContextLength(personality.model);
  const modelContextLength = zaiContextLength ?? (await checkModelContextLength(personality.model));
  const effective = clampContextWindow(configured, modelContextLength);
  if (effective < configured) {
    // warn, not info: this fires on every generation until the stored config
    // is corrected — it's a persistent misconfiguration signal, not routine flow
    logger.warn(
      { model: personality.model, configured, modelContextLength, effective },
      'Clamped context window to model limit'
    );
  }
  return effective;
}
