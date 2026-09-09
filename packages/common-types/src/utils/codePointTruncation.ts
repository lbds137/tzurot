/**
 * Two truncation strategies for two different budgets, and neither ever
 * emits a lone surrogate.
 *
 * `truncateByCodePoints` bounds DISPLAY/prefill text by counting whole
 * characters (code points), so an astral-plane glyph (emoji, some CJK)
 * never gets cut in half. It has no hard ceiling behind it — nothing
 * downstream enforces the resulting code-point count — so its suffix is
 * NOT charged against the cap; the cap only decides where content stops.
 *
 * `truncateToUtf16Units` instead satisfies an actual API CEILING:
 * discord.js/@discordjs/builders (via `@sapphire/shapeshift`) validates
 * `String.prototype.length`, which counts UTF-16 code units, not code
 * points — a single astral character costs TWO units. A code-point cap of
 * 97 on an all-emoji string is still 194 units and still throws past a
 * 100-unit field. Because the ceiling admits no overrun, this function
 * charges the suffix against the cap and keeps the result's `.length`
 * within it unconditionally. A budget smaller than the suffix alone leaves
 * room for nothing, so it yields the empty string — the only result that
 * honours the ceiling.
 */

/**
 * Lower bound (inclusive) of the UTF-16 high-surrogate range. Exported so
 * callers whose truncation ALGORITHM differs (a word-boundary search, say)
 * still share the range definition rather than re-inlining the literals.
 */
export const HIGH_SURROGATE_MIN = 0xd800;
/** Upper bound (inclusive) of the UTF-16 high-surrogate range. */
export const HIGH_SURROGATE_MAX = 0xdbff;

/**
 * Truncate `value` to at most `maxCodePoints` code points, appending
 * `suffix` only when truncation actually happened. `suffix` is NOT counted
 * against `maxCodePoints` — this is a display/prefill cap with no hard API
 * ceiling behind it, so the caller decides how much room the suffix costs.
 *
 * Splitting by `[...value]` (not `.slice`) walks code points, so an astral
 * character is kept or dropped whole rather than cut into an unpaired
 * surrogate.
 */
export function truncateByCodePoints(value: string, maxCodePoints: number, suffix = ''): string {
  // Exact, not an approximation: an astral character costs two UTF-16 units and
  // every other character costs one, so `.length` is always >= the code-point
  // count — within the cap by units implies within it by code points. Skips the
  // spread on the common short-string case.
  if (value.length <= maxCodePoints) {
    return value;
  }
  const codePoints = [...value];
  if (codePoints.length <= maxCodePoints) {
    return value;
  }
  return `${codePoints.slice(0, maxCodePoints).join('')}${suffix}`;
}

/**
 * Truncate `value` so the result's `.length` (UTF-16 code units) never
 * exceeds `maxUnits` — the ceiling discord.js validates against. Unlike
 * `truncateByCodePoints`, `suffix` IS charged against the cap, because
 * there is no slack to spend: a result one unit over `maxUnits` throws at
 * build time regardless of why the extra unit is there.
 *
 * The unit-level cut can land inside a surrogate pair, leaving a lone high
 * surrogate at the end of `cut` — that single unpaired code unit is
 * dropped before the suffix is appended, so the result never contains an
 * unpaired surrogate either.
 *
 * A `maxUnits` below `suffix.length` cannot fit even the marker, so the
 * result is the empty string rather than an over-budget suffix. Pinned by
 * the budget-smaller-than-the-suffix cases in `codePointTruncation.test.ts`.
 */
export function truncateToUtf16Units(value: string, maxUnits: number, suffix = ''): string {
  if (value.length <= maxUnits) {
    return value;
  }
  if (maxUnits < suffix.length) {
    return '';
  }
  let cut = value.slice(0, maxUnits - suffix.length);
  // charCodeAt on an empty `cut` returns NaN, and every comparison against
  // NaN is false — that's the correct no-op when the suffix alone exactly
  // fills the budget; a smaller budget already returned above.
  const lastUnit = cut.charCodeAt(cut.length - 1);
  if (lastUnit >= HIGH_SURROGATE_MIN && lastUnit <= HIGH_SURROGATE_MAX) {
    cut = cut.slice(0, -1);
  }
  return `${cut}${suffix}`;
}
