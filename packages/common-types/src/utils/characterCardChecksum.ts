/**
 * Checksum over the character-card fields a generated roster blurb is derived
 * from — the staleness signal that decides whether the blurb needs regenerating.
 *
 * The checksum's field set is deliberately NOT defined here. It must be exactly
 * the summarizer's INPUT set (the fields its prompt actually consumes), and the
 * two are defined together at the prompt so they cannot drift: a field in the
 * checksum the prompt never reads burns a model call on every edit to it, and a
 * field the prompt reads but the checksum omits leaves a stale blurb in place.
 * Callers pass the set; this module owns only the hashing.
 *
 * Do NOT reach for `contentHash()` in ai-worker's duplicateDetection.ts as the
 * precedent — it truncates to 16 chars and lowercases. The shape to copy is
 * {@link hashFeedbackContent}: one shared implementation, full digest,
 * normalization chosen on purpose rather than inherited.
 */

import { createHash } from 'node:crypto';

/**
 * A card field's value as it reaches the checksum. `null`/`undefined` are
 * accepted because most card columns are nullable.
 */
export type CardFieldValue = string | null | undefined;

/**
 * Collapse whitespace runs and trim, PRESERVING CASE.
 *
 * LOAD-BEARING BEYOND NORMALIZATION: collapsing `\s+` is also what makes
 * `hashCharacterCard`'s entry separator unforgeable, since it strips every
 * newline out of a value before the encoder ever sees it. That precondition is
 * pinned by the "insensitive to whitespace runs" test, whose fixture contains a
 * literal newline — narrowing this pattern to spaces and tabs reddens it. Do
 * not narrow it without reading that test.
 *
 * Unicode composition is normalized to NFC for the same reason whitespace is
 * collapsed: `café` typed on macOS (decomposed) and pasted from elsewhere
 * (composed) are the same string to every reader, and hashing them differently
 * would buy a paid regeneration for a byte-level difference nobody made. This
 * has to be settled BEFORE any hash is persisted — once blurbs are backfilled,
 * changing normalization invalidates every stored hash and regenerates the
 * whole corpus at once, at cost.
 *
 * Case-preservation is the deliberate departure from
 * `normalizeFeedbackContent`, which lowercases: feedback dedupe wants "Same
 * Complaint" and "same complaint" to collide, whereas a blurb that names its
 * character genuinely goes stale when the character is renamed `emily` →
 * `Emily`. Whitespace is collapsed for the opposite reason — a stray trailing
 * space changes nothing a summarizer would write, and regenerating on it
 * spends money for an identical blurb.
 */
function normalizeCardField(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Full 64-hex sha-256 over a card's summarizer-input fields.
 *
 * Fields whose normalized value is empty are treated as ABSENT and contribute
 * nothing — `null`, `undefined`, `''` and `'   '` all hash identically, because
 * the summarizer sees nothing in every one of those cases. Clearing a field by
 * any route is therefore one state, not four.
 *
 * Keys are sorted so a caller's object literal ordering cannot change the
 * digest. Entry boundaries are unforgeable because values are joined on `\n`
 * and normalization has already collapsed every newline out of them — a card
 * field cannot contain the separator. The additional LENGTH PREFIX is
 * redundancy against a future normalization that stops collapsing newlines:
 * it makes the encoding self-delimiting on its own terms, so that change would
 * not silently reopen a collision. That redundancy alone is deliberately
 * UNPINNED by a test: with the collapse in place no input can reach the case it
 * defends, so any test written for it would pass whether the prefix were
 * present or not. The collapse it backs up IS pinned — see normalizeCardField.
 *
 * PRECONDITION ON KEYS, not enforced by the signature: keys must be static
 * field-name literals containing no `:` and no newline. The entry encoding is
 * `key:length:value`, so a key carrying either character could forge a
 * boundary — and unlike values, keys are NOT normalized on the way in. Every
 * caller today passes fixed literals; building this object from dynamic keys
 * would void the guarantee silently, with no failure to notice.
 *
 * A fully-empty card hashes to the sha-256 of the empty string, shared by every
 * other fully-empty card. That follows from the absent-state collapse above and
 * is harmless — there is nothing to summarize either way — but a caller wanting
 * "this card has no content" should test for that rather than read a
 * per-character checksum into it.
 *
 * @returns 64 lowercase hex chars, sized for a `VarChar(64)` column.
 */
export function hashCharacterCard(fields: Record<string, CardFieldValue>): string {
  const entries = Object.keys(fields)
    .sort()
    .map(key => ({ key, value: normalizeCardField(fields[key] ?? '') }))
    .filter(entry => entry.value.length > 0)
    .map(entry => `${entry.key}:${String(entry.value.length)}:${entry.value}`);

  return createHash('sha256').update(entries.join('\n')).digest('hex');
}
