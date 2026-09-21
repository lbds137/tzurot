/**
 * The memory-archive summary coverage gate, shared by the tooling pre-warm
 * sweep's report and the gateway's auto-promotion service so the threshold
 * and the formula exist once.
 */

/** Minimum done-share before a personality's archive is considered ready to flip. */
export const FLIP_GATE_TARGET = 0.95;

/**
 * The two counts the coverage share is computed from. Deliberately narrower than
 * the sweep report's own row type so the gateway can pass a two-column SQL row.
 */
export interface SummaryCoverageCounts {
  /** In-window non-chunk rows summarized under the CURRENT prompt version. */
  done_current: number;
  /** Non-chunk rows retrieved inside the coverage window. */
  retrieved_in_window: number;
}

/** Share of in-window rows already summarized under the current prompt version.
 *  `null` when nothing was retrieved in the window (no denominator). */
export function summarizedShare(counts: SummaryCoverageCounts): number | null {
  if (counts.retrieved_in_window === 0) {
    return null;
  }
  return counts.done_current / counts.retrieved_in_window;
}

/** Coverage window: how far back `last_retrieved_at` counts toward the denominator. */
export const SUMMARY_COVERAGE_WINDOW_DAYS = 30;
