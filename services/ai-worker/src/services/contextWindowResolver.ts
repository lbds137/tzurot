/**
 * Context Window Resolver
 *
 * Resolves the input-token budget for a generation: the configured
 * contextWindowTokens clamped to the model's real limit when known.
 * Gateway validation rejects new oversized saves; this clamp protects
 * generations driven by already-saved rows (and the schema's 131072
 * default) that exceed what the model can actually hold.
 */

import { createLogger, clampContextWindow, type LoadedPersonality } from '@tzurot/common-types';
import { checkModelContextLength } from '../redis.js';

const logger = createLogger('ContextWindowResolver');

/**
 * Resolve the effective context window for a generation.
 *
 * Unknown models (non-OpenRouter providers, model-cache miss) degrade
 * gracefully to the configured value. Logs when the clamp engages — that's
 * the "this preset is configured above the model's limit" signal.
 */
export async function resolveEffectiveContextWindow(
  personality: LoadedPersonality
): Promise<number> {
  const configured = personality.contextWindowTokens;
  const modelContextLength = await checkModelContextLength(personality.model);
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
