/**
 * Coercion for the `list` system-setting control (comma-separated personality
 * slugs). Used by the slash setter (`settingsSet.ts` `coerceValue`) and by
 * the dashboard's modal-submit path (`settingsModalSubmit.ts`), so the two
 * never diverge on what counts as a valid entry.
 *
 * Entries are lowercased before trimming and deduping: personality slugs are
 * lowercase-only by the creation validator, and the runtime activation check
 * matches slugs exactly — a mixed-case entry would save cleanly and then
 * never match at activation time.
 */

/** `"A, a,,B"` → `['a', 'b']`. `""` → `[]`. */
export function parseSlugList(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.toLowerCase().trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
