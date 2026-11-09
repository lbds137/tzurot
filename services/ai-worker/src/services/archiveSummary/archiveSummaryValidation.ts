/**
 * Memory-archive summarizer length-outcome decision.
 *
 * First-person detection lives in `@tzurot/common-types/utils/firstPersonDetection`.
 */

import { SUMMARY_SOFT_CAP_TOKENS, SUMMARY_HARD_CAP_TOKENS } from './constants.js';

/**
 * `'over_soft'` is retained for vocabulary parity with the pilot's telemetry
 * but is never produced by this flow: every over-soft first pass triggers
 * exactly one regeneration, so the outcome always resolves to `'regenerated'`
 * or `'overflow'` instead.
 */
export type LengthState = 'within_soft' | 'over_soft' | 'regenerated' | 'overflow';

/** Decide the length outcome of a summarization attempt: `overflow` is judged
 *  on the FINAL text, but `within_soft`/`over_soft`/`regenerated` describe
 *  the FIRST-pass verdict and whether a regeneration pass ran. */
export function decideLengthState(input: {
  firstTokens: number;
  finalTokens: number;
  regenerated: boolean;
}): LengthState {
  if (input.finalTokens > SUMMARY_HARD_CAP_TOKENS) {
    return 'overflow';
  }
  if (input.firstTokens <= SUMMARY_SOFT_CAP_TOKENS) {
    return 'within_soft';
  }
  if (input.regenerated) {
    return 'regenerated';
  }
  return 'over_soft';
}
