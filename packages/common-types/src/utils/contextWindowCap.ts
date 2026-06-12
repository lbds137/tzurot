/**
 * Context Window Cap
 *
 * Shared formula for the maximum input-token budget allowed against a model's
 * real context length. Used in two places that must agree:
 * - api-gateway config validation (rejects oversized contextWindowTokens at save time)
 * - ai-worker generation budgeting (clamps already-saved values at runtime)
 *
 * Why headroom exists at all: the input budget must leave room for (a) the
 * model's generated output, which shares the context window, and (b) tokenizer
 * mismatch — budgets are counted with tiktoken, but providers count with their
 * own tokenizers, which can run 15-25% higher for the same text (Mistral-family
 * models especially). An input budget equal to the full context length is
 * guaranteed to overflow once either factor applies.
 *
 * Why the fraction is graduated: on large windows, 50% headroom costs little
 * relative to the budget and is comfortably safe. On small windows every token
 * matters, so the headroom shrinks to 25% — enough to absorb the known
 * tokenizer-mismatch class plus a modest response, without halving an already
 * small budget.
 */

/**
 * Models with context length at or below this threshold get the smaller (25%)
 * headroom; larger models reserve 50%.
 *
 * Note: this is a step function, not a gradient — a model at exactly this
 * value gets 75% of its context as input budget; a model one token above
 * gets 50% (49152 vs ~32768). Moving the threshold moves that cliff.
 */
export const SMALL_CONTEXT_THRESHOLD = 65536;

/** Input-budget fraction for small-context models (≤ SMALL_CONTEXT_THRESHOLD). */
const SMALL_CONTEXT_CAP_FRACTION = 0.75;

/** Input-budget fraction for large-context models. */
const LARGE_CONTEXT_CAP_FRACTION = 0.5;

/**
 * Compute the maximum allowed input-token budget for a model.
 *
 * @param contextLength - The model's real context length in tokens
 * @returns The capped input budget (always strictly less than contextLength)
 */
export function computeContextCap(contextLength: number): number {
  const fraction =
    contextLength <= SMALL_CONTEXT_THRESHOLD
      ? SMALL_CONTEXT_CAP_FRACTION
      : LARGE_CONTEXT_CAP_FRACTION;
  return Math.floor(contextLength * fraction);
}

/**
 * Clamp a configured context-window setting against the model's real limit.
 *
 * @param configured - The user-configured contextWindowTokens
 * @param modelContextLength - The model's real context length, or null when
 *   unknown (non-OpenRouter providers, model-cache miss). Unknown degrades
 *   gracefully: the configured value is used as-is.
 * @returns The effective input budget to use for generation
 */
export function clampContextWindow(configured: number, modelContextLength: number | null): number {
  if (modelContextLength === null) {
    return configured;
  }
  return Math.min(configured, computeContextCap(modelContextLength));
}
