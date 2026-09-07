/**
 * Archive-summary pre-warm sweep — report arithmetic and formatting.
 *
 * Pure functions, no I/O — the sweep entry point does all the querying and
 * hands rows/counts in here.
 */

/**
 * Measured from `buildSummarizerPrompt` with an entirely empty exchange
 * (`displayName`, `subjectName`, `userText`, `assistantText` all `''`,
 * `referenced: null`), counted with common-types' `countTextTokens` — 705
 * tokens. This moves whenever the summarizer prompt text changes; it is an
 * estimate for an operator's pre-sweep spend check, not a billing figure.
 * Duplicated knowledge: tooling cannot import from a service.
 */
export const SUMMARIZER_PROMPT_OVERHEAD_TOKENS = 705;

/** Rough inflation from raw content chars to prompt tokens once the content
 *  is embedded in the summarizer's template (quoting, XML-ish wrapping). */
export const CONTENT_TOKEN_INFLATION = 1.3;

/** Rough chars-per-token ratio for English prose, used only for this
 *  pre-sweep estimate. */
export const CHARS_PER_TOKEN = 4;

/** The flip gate: summarized-share threshold before the operator switches
 *  a personality onto split-render summaries. */
export const FLIP_GATE_TARGET = 0.95;

export interface SelectedRow {
  id: string;
  content_chars: number;
}

export interface WindowCounts {
  total_non_chunk: number;
  retrieved_in_window: number;
  done_current: number;
  done_older: number;
  done_newer: number;
  pending: number;
  failed: number;
  dead: number;
  never_attempted: number;
}

/** Sum of per-row estimated input tokens: fixed prompt overhead plus the
 *  inflated, token-converted content length. */
export function estimateInputTokens(rows: SelectedRow[]): number {
  let total = 0;
  for (const row of rows) {
    total +=
      SUMMARIZER_PROMPT_OVERHEAD_TOKENS +
      Math.ceil((row.content_chars / CHARS_PER_TOKEN) * CONTENT_TOKEN_INFLATION);
  }
  return total;
}

/** Share of in-window rows already summarized under the current prompt
 *  version. `null` when nothing was retrieved in the window (no denominator). */
export function summarizedShare(counts: WindowCounts): number | null {
  if (counts.retrieved_in_window === 0) {
    return null;
  }
  return counts.done_current / counts.retrieved_in_window;
}

/** Share of in-window rows covered by a live fact. `null` on a zero
 *  denominator, same rule as `summarizedShare`. */
export function factCoverageShare(covered: number, retrievedInWindow: number): number | null {
  if (retrievedInWindow === 0) {
    return null;
  }
  return covered / retrievedInWindow;
}

/**
 * The flip-gate verdict line. The verdict is decided on the exact share
 * while the display rounds to one decimal, so a share just under the
 * target can print as `95.0%` and still read NOT READY.
 */
export function formatGateLine(share: number | null): string {
  if (share === null) {
    return 'GATE n/a (0 rows retrieved in the window) — NOT READY';
  }
  const pct = (share * 100).toFixed(1);
  const verdict = share >= FLIP_GATE_TARGET ? 'READY' : 'NOT READY';
  return `GATE ${pct}% of 95% — ${verdict}`;
}

/** The fact-coverage report line. */
export function formatFactCoverageLine(share: number | null): string {
  if (share === null) {
    return 'Fact coverage n/a (0 rows retrieved in the window)';
  }
  const pct = (share * 100).toFixed(1);
  return `Fact coverage ${pct}% of rows retrieved in the window`;
}
