/**
 * Browse Footer Helpers
 *
 * Composable helpers for building embed footer text across browse commands.
 * Each command assembles its own footer from atomic helpers via `joinFooter`,
 * preserving per-command UX while eliminating duplicated join/filter logic.
 *
 * Design: Proposal C (Joiner + Atomic Helpers) — approved 2026-04-09 after
 * council consultation with Gemini 3.1 Pro corrections applied.
 */

// === Constants ============================================================

/** Standard footer segment delimiter (U+2022 bullet). */
export const FOOTER_DELIMITER = ' \u2022 ';

// === Types ================================================================

export interface NounSpec {
  singular: string;
  plural: string;
}

interface PageIndicatorOptions {
  /** Append a `+` to the page count to indicate more pages beyond the
   *  known total (for rolling-window pagination like memory/search). */
  hasMore?: boolean;
}

// === Core joiner ==========================================================

/**
 * Join non-empty footer segments with the standard delimiter.
 *
 * Accepts strings plus common falsy values so the idiomatic
 * `cond && helper(x)` pattern works regardless of whether `cond` is a
 * boolean, number, or comparison result. Non-string values are filtered
 * out at runtime.
 */
export function joinFooter(...segments: (string | number | boolean | null | undefined)[]): string {
  return segments
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(FOOTER_DELIMITER);
}

// === Pluralization ========================================================

/**
 * Format a count with singular/plural agreement.
 *
 * - `count === 1` → `"1 {singular}"`
 * - all other counts → `"{count} {plural}"`
 */
export function pluralize(count: number, noun: NounSpec): string {
  return `${count} ${count === 1 ? noun.singular : noun.plural}`;
}

// === Filter formatters ====================================================

/** `"filtered by: {value}"` — used by character, preset. */
export function formatFilterLabeled(filter: string): string {
  return `filtered by: ${filter}`;
}

/** `"({value})"` — used by deny (always shown, even for "all"). */
export function formatFilterParens(filter: string): string {
  return `(${filter})`;
}

// === Sort formatters ======================================================

/**
 * `"Sorted by {label}"` — natural language sort indicator.
 *
 * Takes an explicit label rather than deriving one from a sort key.
 */
export function formatSortNatural(label: string): string {
  return `Sorted by ${label}`;
}

/**
 * Return a pre-formatted sort phrase verbatim. Used when the sort display
 * doesn't fit the "Sorted by X" pattern (e.g. `"Newest first"`,
 * `"Sorted alphabetically"`).
 */
export function formatSortHardcoded(phrase: string): string {
  return phrase;
}

// === Pagination ===========================================================

/**
 * `"Page {current} of {total}"` — optional `+` suffix for rolling-window
 * pagination where more pages may exist beyond the known total.
 */
export function formatPageIndicator(
  current: number,
  total: number,
  options?: PageIndicatorOptions
): string {
  const base = `Page ${current} of ${total}`;
  return options?.hasMore === true ? `${base}+` : base;
}
