/**
 * Preset Clone Name Utilities
 *
 * Pure name-generation helpers shared by bot-client (for initial candidate
 * name generation shown in clone UX) and api-gateway (for server-side
 * suffix bumping when the candidate collides with an existing name).
 *
 * Keeping both sides pointed at one implementation prevents drift between
 * "what the client suggests" and "what the server accepts" when the user
 * already has a pile of `(Copy N)` variants.
 */

// Inside-the-parens pattern. Anchored on both ends with a bounded
// whitespace run so the match stays linear-time. An earlier sliding
// regex (`/\s*\(Copy(?:\s+(\d+))?\)\s*$/i`) was flagged as polynomial
// ReDoS — leading `\s*` combined with the engine's starting-position
// slide produced O(N²) on spacey input. We now parse the tail with
// `trimEnd` + `lastIndexOf('(')` and only regex-match the content
// inside the parentheses.
//
// `\s{1,8}` between "copy" and the digit run is intentionally strict:
// inputs like "(Copy         5)" (>8 spaces) won't be recognised as a
// copy suffix, but that's preferable to re-introducing an unbounded
// `\s+` that could reopen the ReDoS surface on nasty inputs.
const COPY_INNER_PATTERN = /^copy(?:\s{1,8}(\d+))?$/i;

/**
 * Try to strip exactly one trailing `(Copy N)` suffix from the name.
 * Returns the base name and the copy number (1 when no number is present),
 * or null if the name has no recognisable copy suffix.
 */
function tryStripOneSuffix(name: string): { base: string; num: number } | null {
  const trimmed = name.trimEnd();
  if (trimmed.length === 0 || !trimmed.endsWith(')')) {
    return null;
  }

  const openIdx = trimmed.lastIndexOf('(');
  if (openIdx < 0) {
    return null;
  }

  const inside = trimmed.slice(openIdx + 1, trimmed.length - 1);
  const match = COPY_INNER_PATTERN.exec(inside);
  if (match === null) {
    return null;
  }

  const num = match[1] !== undefined ? parseInt(match[1], 10) : 1;
  const base = trimmed.slice(0, openIdx);
  return { base, num };
}

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

  while (true) {
    const stripped = tryStripOneSuffix(baseName);
    if (stripped === null) {
      break;
    }
    hadSuffix = true;
    maxNum = Math.max(maxNum, stripped.num);
    baseName = stripped.base;
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
  while (true) {
    const stripped = tryStripOneSuffix(base);
    if (stripped === null) {
      break;
    }
    base = stripped.base;
  }
  return base.trim();
}
