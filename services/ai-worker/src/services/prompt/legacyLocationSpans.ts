/**
 * Legacy location-span stripping for stored memory content.
 *
 * Extracted from MemoryFormatter.ts so MemoryNoteSplitRender.ts and
 * MemoryFormatter.ts can both depend on it without importing each other.
 */

/**
 * Remove the present-tense location preamble a retired formatter baked into
 * stored memory rows.
 *
 * Those rows carry a literal `<location>This conversation is taking place …`
 * span inside their content. Because `location` is not a protected tag, it
 * survives escaping as readable markup and reads to the model as another
 * candidate for "where am I" — competing with the real current channel. The
 * rows are already written, so render-time removal is the only path that
 * reaches them (the reference path has a sibling filter,
 * `usableLocationContext` in storedReference.ts).
 *
 * Two passes: the wrapped form, then a tense fallback for unwrapped variants
 * that the retired formatter also emitted.
 *
 * @param content - Raw stored memory content
 * @returns Content with legacy location preambles removed or made past-tense
 */
export function stripLegacyLocationSpans(content: string): string {
  return (
    content
      .replace(/<location>\s*This conversation is taking place[\s\S]*?<\/location>\s*/g, '')
      // Accepted tradeoff: this pass is unscoped, so a verbatim user quote
      // containing the exact phrase also gets tense-flipped. The phrase is
      // narrow and the damage is cosmetic; scoping the fallback would forfeit
      // coverage of unwrapped legacy variants, which is what it exists for.
      .replace(/This conversation is taking place/g, 'This conversation took place')
  );
}
