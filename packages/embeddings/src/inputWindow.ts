/**
 * Input-window overflow reporting.
 *
 * The embedding pipeline truncates at {@link EMBEDDING_MAX_INPUT_TOKENS}
 * without erroring or warning, so an over-long input produces a perfectly
 * ordinary vector computed from a prefix. Nothing at the call site distinguishes
 * that from a full embedding — which is how a memory-search query grew to four
 * times the window and lost its referenced-message tail unnoticed.
 *
 * This module owns the decision "was anything discarded, and how much", kept
 * separate from the service so it can be exercised directly rather than through
 * a mocked worker exchange.
 */

import { EMBEDDING_MAX_INPUT_TOKENS } from './constants.js';

/** Everything worth logging about an input the model could only partly read. */
export interface InputOverflow {
  /** Real model tokens in the input, counted before truncation. */
  inputTokens: number;
  /** The window the input was measured against. */
  maxInputTokens: number;
  /** Tokens the model never saw. */
  discardedTokens: number;
  /** Discarded share of the input, 0-1, rounded to 3dp. */
  discardedFraction: number;
  /** Input length in characters, for callers that budget in characters. */
  inputChars: number;
  /**
   * Observed characters-per-token for THIS input, rounded to 2dp.
   *
   * Included because callers can only measure characters, and the ratio needed
   * to convert is content-dependent — ordinary prose runs near 4, dense markup
   * or unusual vocabulary lower. A caller sizing a budget should use a measured
   * ratio from its own traffic rather than a guessed constant.
   */
  charsPerToken: number;
}

/**
 * Describe how much of `text` the model discarded, or `undefined` when nothing
 * was lost.
 *
 * `undefined` for `inputTokens` means the count was unavailable, not that the
 * input fit — the worker degrades to `undefined` rather than failing an
 * embedding over a diagnostic. Treating unknown as "no overflow" is the correct
 * bias here: silence about a possible problem beats a warn that fires on every
 * call because counting broke.
 */
export function describeInputOverflow(
  text: string,
  inputTokens: number | undefined
): InputOverflow | undefined {
  if (inputTokens === undefined || inputTokens <= EMBEDDING_MAX_INPUT_TOKENS) {
    return undefined;
  }

  const discardedTokens = inputTokens - EMBEDDING_MAX_INPUT_TOKENS;
  return {
    inputTokens,
    maxInputTokens: EMBEDDING_MAX_INPUT_TOKENS,
    discardedTokens,
    discardedFraction: Math.round((discardedTokens / inputTokens) * 1000) / 1000,
    inputChars: text.length,
    charsPerToken: Math.round((text.length / inputTokens) * 100) / 100,
  };
}
