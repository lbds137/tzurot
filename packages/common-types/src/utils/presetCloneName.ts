/**
 * Preset Clone Name Utilities
 *
 * Pure name-generation helpers shared by bot-client (for initial candidate
 * name generation shown in clone UX) and api-gateway (for server-side
 * suffix bumping when the candidate collides with an existing name).
 *
 * Keeping both sides pointed at one implementation prevents drift between
 * "what the client suggests" and "what the server accepts" when the user
 * already has a Pile of `(Copy N)` variants.
 */

/**
 * Pattern to match a trailing (Copy) or (Copy N) suffix.
 * Module-scoped to avoid regex recompilation on each call.
 * Group 1 captures the optional number for extraction.
 */
const COPY_SUFFIX_PATTERN = /\s*\(Copy(?:\s+(\d+))?\)\s*$/i;

/**
 * Generate a cloned name by stripping all `(Copy N)` suffixes and adding a new one.
 * Finds the maximum copy number among all trailing suffixes and increments it.
 *
 * @example
 * generateClonedName('Preset')              // → 'Preset (Copy)'
 * generateClonedName('Preset (Copy)')       // → 'Preset (Copy 2)'
 * generateClonedName('Preset (Copy 2)')     // → 'Preset (Copy 3)'
 * generateClonedName('Preset (Copy) (Copy)')// → 'Preset (Copy 2)'  (max of 1,1 → next is 2)
 * generateClonedName('Preset (Copy 5) (Copy)') // → 'Preset (Copy 6)'  (max of 5,1 → next is 6)
 *
 * @param originalName - The preset name to clone
 * @returns A new name with an appropriate `(Copy N)` suffix
 */
export function generateClonedName(originalName: string): string {
  let baseName = originalName;
  let maxNum = 0;
  let hadSuffix = false;

  let match: RegExpExecArray | null;
  while ((match = COPY_SUFFIX_PATTERN.exec(baseName)) !== null) {
    hadSuffix = true;
    const num = match[1] !== undefined ? parseInt(match[1], 10) : 1;
    maxNum = Math.max(maxNum, num);
    baseName = baseName.slice(0, match.index);
  }

  baseName = baseName.trim();

  if (!hadSuffix) {
    // Trim the original too so trailing whitespace doesn't leak into the
    // output — matches the suffix-present branch's `.trim()` above.
    return `${originalName.trim()} (Copy)`;
  }

  return `${baseName} (Copy ${maxNum + 1})`;
}

/**
 * Strip all trailing `(Copy N)` suffixes from a name to find the original
 * base. Used on the server side to enumerate existing copy variants via a
 * `WHERE name LIKE base || ' (Copy%'` query.
 *
 * @example
 * stripCopySuffix('Preset')             // → 'Preset'
 * stripCopySuffix('Preset (Copy)')      // → 'Preset'
 * stripCopySuffix('Preset (Copy 5)')    // → 'Preset'
 * stripCopySuffix('Preset (Copy) (Copy 3)') // → 'Preset' (strips both)
 *
 * @param name - A preset name that may or may not end in copy suffixes
 * @returns The base name with all trailing copy suffixes removed
 */
export function stripCopySuffix(name: string): string {
  let base = name;
  while (COPY_SUFFIX_PATTERN.test(base)) {
    base = base.replace(COPY_SUFFIX_PATTERN, '');
  }
  return base.trim();
}
