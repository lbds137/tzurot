/**
 * Register metric for the 'Generated response' log line.
 *
 * A cheap, continuous proxy for the voice/register drift doc-97's one-off
 * historical-memory script diagnosed by hand: `!` characters per 1000 chars
 * of generated text. Formula: `('!' character count) * 1000 / text.length`,
 * rounded to 2 decimals. This is deliberately the SAME formula the doc-97
 * prod curve script used over stored memories,
 * so the field is comparable with that historical curve — single `!`
 * characters counted individually (ASCII `!` only; a `!!` run counts as 2),
 * `text.length` in UTF-16 code units like the line's `charCount`.
 */

/**
 * Count of `!` characters per 1000 characters of `text`, rounded to 2
 * decimals. Returns `0` (never `NaN`) when `text` is empty.
 */
export function exclamationsPer1kChars(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const exclamationCount = (text.match(/!/g) ?? []).length;
  return Math.round(((exclamationCount * 1000) / text.length) * 100) / 100;
}
