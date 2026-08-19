/**
 * The character-card fields a roster blurb is generated from — the field set
 * itself, and the checksum taken over it.
 *
 * This lives in common-types rather than beside the summarizer prompt because
 * BOTH services need it: ai-worker builds the prompt from these fields, and
 * api-gateway stamps `cardSourceHash` from them on every card write. The
 * staleness comparison is then pure SQL (`roster_blurb_source_hash IS DISTINCT
 * FROM card_source_hash`) — nothing rehashes a card to discover that it
 * changed, because the write that changed it already said so.
 *
 * The set must stay exactly the summarizer's INPUT set. A field here the
 * prompt never reads burns a paid model call on every edit to it; a field the
 * prompt reads but this omits leaves a stale blurb in place forever. The two
 * halves now sit in different packages, so colocation no longer protects that
 * invariant — the per-field drift test beside the prompt does, asserting every
 * field moves the hash AND the prompt. That test is the guarantee; do not
 * treat this comment as one.
 */

import { hashCharacterCard, type CardFieldValue } from './characterCardChecksum.js';

/**
 * The summarizer's input fields, in the order the prompt renders them.
 *
 * Excluded, each for a reason that is about cost or safety rather than taste:
 *  - `conversationalExamples` — verbatim first-person example dialogue.
 *    Feeding it to a summarizer invites the blurb to quote it; removing the
 *    material beats prompting against it.
 *  - `errorMessage` — the character's custom failure text. It cannot appear in
 *    a third-person description, so hashing it would buy nothing but a
 *    regeneration on every edit to it.
 *  - `customFields` — arbitrary JSON with no register guarantee.
 *  - `birthMonth`/`birthDay`/`birthYear` — `personalityAge` already carries age
 *    in prose, and these are `Int?` on the model where the hash takes strings.
 *
 * These keys are also the checksum's entry keys, so they inherit
 * `hashCharacterCard`'s unenforced precondition: no `:` and no newline. Pinned
 * by a test rather than by the type system, because the property is about the
 * characters inside each key and a rename is what would break it silently.
 */
export const ROSTER_BLURB_CARD_FIELDS = [
  'name',
  'displayName',
  'characterInfo',
  'personalityTraits',
  'personalityTone',
  'personalityAge',
  'personalityAppearance',
  'personalityLikes',
  'personalityDislikes',
  'conversationalGoals',
] as const;

/** A field the summarizer reads — and therefore a checksum entry key. */
export type RosterBlurbCardField = (typeof ROSTER_BLURB_CARD_FIELDS)[number];

/** The card as the checksum, the prompt, and the write-path stamp all see it. */
export type RosterBlurbCard = Record<RosterBlurbCardField, CardFieldValue>;

/**
 * Project a personality row onto exactly the summarizer's input fields.
 *
 * The RUNTIME narrowing is the point. A Prisma `Personality` satisfies
 * `RosterBlurbCard` structurally and could be hashed directly, which would fold
 * all forty-odd of its columns into the digest and regenerate every blurb when
 * an unrelated column moved. Passing a row through here drops everything the
 * prompt does not read.
 *
 * The parameter type demands EVERY card field, which is what makes a
 * partially-selected row a compile error at the write paths rather than a
 * silently wrong hash: a `select` missing `personalityLikes` would otherwise
 * hash it as absent and stamp a digest no generation can ever match.
 */
export function buildRosterBlurbCard(source: RosterBlurbCard): RosterBlurbCard {
  return Object.fromEntries(
    ROSTER_BLURB_CARD_FIELDS.map(key => [key, source[key]])
  ) as RosterBlurbCard;
}

/**
 * The value written to `personalities.card_source_hash` on every card write.
 *
 * Call it with the row as it will exist AFTER the write — for a partial update
 * that means the stored row merged with the patch, not the patch alone.
 */
export function hashRosterBlurbCard(card: RosterBlurbCard): string {
  return hashCharacterCard(buildRosterBlurbCard(card));
}

/**
 * The digest every card with no describable content shares.
 *
 * `hashCharacterCard` collapses null, undefined, `''` and whitespace-only into
 * one absent state, so a card whose every field is empty hashes to the sha-256
 * of the empty string — the same value for every such character. The sweep
 * compares against THIS constant to skip the model call, and must never infer
 * emptiness by comparing two cards' checksums to each other.
 *
 * Derived, not transcribed, so it cannot drift from the hash it describes.
 */
export const EMPTY_ROSTER_BLURB_CARD_HASH = hashRosterBlurbCard(
  Object.fromEntries(ROSTER_BLURB_CARD_FIELDS.map(key => [key, null])) as RosterBlurbCard
);
