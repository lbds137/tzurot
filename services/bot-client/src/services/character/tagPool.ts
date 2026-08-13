/**
 * Character Tag Pools
 *
 * Shared tag primitives for the two tag-aware surfaces: `/random tag:` (pick
 * ONE character carrying the tag) and `/chime-in tag:` (weigh in with up to the
 * admin-configured cap). Both read the same accessible pool the autocomplete
 * uses — `getCachedPersonalities`, i.e. owned + public — so a private character
 * belonging to someone else can never be reached, or even named, through a tag.
 *
 * Accepted tradeoff (design decision, not a defect): the tag VOCABULARY offered
 * by autocomplete is bounded by whatever the accessible-personality list
 * returns, which the gateway caps at `take: 500`. A user whose accessible pool
 * exceeds that cap sees the vocabulary of the first 500 characters only. The
 * cap is the list endpoint's, not this module's — raising it is a gateway
 * decision, and the degradation (a rarer tag missing from the dropdown; typing
 * it by hand still works) is milder than paginating on every keystroke against
 * Discord's 3-second autocomplete deadline.
 */

import { randomInt } from 'node:crypto';
import { escapeMarkdown } from 'discord.js';
import {
  normalizeTag,
  TAG_LIMITS,
  type PersonalitySummary,
} from '@tzurot/common-types/schemas/api/personality';

/** One entry of the count-sorted tag vocabulary offered by autocomplete. */
export interface TagVocabularyEntry {
  /** The normalized tag token. */
  tag: string;
  /** How many accessible characters carry it. */
  count: number;
}

/**
 * Characters from `pool` carrying `tag`.
 *
 * The needle is normalized at query time (`normalizeTag`) so a user typing
 * `Sci Fi` matches the stored `sci-fi`. Stored tags are already normalized by
 * `PersonalityTagSchema` on write, so only the needle needs the transform.
 * A needle that normalizes to empty (whitespace, punctuation-only) matches
 * nothing rather than everything.
 */
export function filterByTag(pool: PersonalitySummary[], tag: string): PersonalitySummary[] {
  const needle = normalizeTag(tag);
  if (needle.length === 0) {
    return [];
  }
  return pool.filter(p => p.tags.includes(needle));
}

/**
 * Up to `cap` items chosen uniformly at random, without replacement.
 *
 * Partial Fisher-Yates over a copy: each of the first `cap` positions draws
 * from the not-yet-drawn remainder, which makes every subset equally likely
 * without shuffling the whole array. `randomInt` (node:crypto) rather than
 * `Math.random` — the pick is pure UX, but using the secure primitive keeps
 * the insecure-randomness analyzer quiet without a per-site suppression.
 *
 * Returns the input's own order when `cap` covers the whole pool: sampling
 * everything is not a sample, and shuffling would make the notice's name list
 * needlessly unstable.
 */
export function sampleUpTo<T>(items: T[], cap: number): T[] {
  if (cap <= 0) {
    return [];
  }
  if (items.length <= cap) {
    return [...items];
  }
  const remaining = [...items];
  const drawn: T[] = [];
  for (let i = 0; i < cap; i++) {
    // randomInt(max) is [0, max); `remaining` shrinks by one each iteration and
    // i < cap < items.length keeps it non-empty, so max stays valid.
    const index = randomInt(remaining.length);
    drawn.push(remaining[index]);
    // Swap-with-last then pop: O(1) removal, and the order of the untouched
    // remainder is irrelevant to a uniform draw.
    remaining[index] = remaining[remaining.length - 1];
    remaining.pop();
  }
  return drawn;
}

/**
 * The tag vocabulary across an accessible pool, most-used first.
 *
 * Ties break alphabetically so the dropdown is stable between keystrokes —
 * an insertion-order tie-break would reshuffle as the gateway's list order
 * drifts. Only the ACCESSIBLE list is aggregated: a tag that exists solely on
 * someone else's private character must not leak into the vocabulary.
 */
export function collectTagVocabulary(pool: PersonalitySummary[]): TagVocabularyEntry[] {
  const counts = new Map<string, number>();
  for (const personality of pool) {
    for (const tag of personality.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * The "nothing carries this tag" sentence, shared by `/random` and `/chime-in`
 * so the two surfaces can't drift into describing the same state differently.
 *
 * Echoes the NORMALIZED needle — that is what was actually searched for, and
 * showing it back is how a user learns `Sci Fi` became `sci-fi`. The needle is
 * markdown-escaped: this function fires precisely when the needle matched NO
 * stored tag, so `TAG_PATTERN`'s `[a-z0-9-]` write-time guarantee does not
 * apply to it — `normalizeTag` leaves backticks, mentions, and other markdown
 * intact. (The sampling notice's unescaped echo rests on the OPPOSITE proof:
 * a needle that matched is byte-equal to a validated stored tag.)
 *
 * `extraClause` (e.g. ` with \`only-mine\` also active`) is folded into the
 * first sentence, so a caller that stacks other filters on top of the tag says
 * so before the advice rather than after it.
 *
 * The echo is length-capped: `tag` arrives from a free-typed Discord string
 * option, so nothing upstream bounds it, and escaping can roughly double what
 * the user typed — an unbounded echo pushes this very error past Discord's
 * message ceiling and the reply throws instead of explaining anything. Anything
 * longer than a storable tag could never have matched, so `TAG_LIMITS.MAX_LENGTH`
 * loses no diagnostic value.
 */
export function emptyTagPoolDetail(tag: string, extraClause = ''): string {
  return (
    `No characters carry the tag \`${escapeMarkdown(echoableNeedle(tag))}\`${extraClause}. ` +
    'Try a different tag — autocomplete lists the ones in use.'
  );
}

/**
 * The normalized needle, cut to the longest length a real tag could have.
 *
 * Sliced by code point rather than by `.slice`, which would cut an astral
 * character (emoji, some CJK) mid-surrogate and echo a lone surrogate back.
 *
 * Not built on `truncateByCodePoints` (utils/modal/toolkit.ts), which does the
 * same slice: that module's own docstring scopes it to EDITABLE prefill rather
 * than display text — hence no ellipsis — and importing it here would drag the
 * modal builder's discord.js surface into a services module for three lines.
 * A shared home for the three variants (prefill, this one, and the UTF-16
 * budgeted cut `truncateForSelect` needs) is tracked on TASK-581, where all
 * three exist at once and the right signature is actually decidable.
 */
function echoableNeedle(tag: string): string {
  const normalized = normalizeTag(tag);
  const codePoints = [...normalized];
  return codePoints.length > TAG_LIMITS.MAX_LENGTH
    ? `${codePoints.slice(0, TAG_LIMITS.MAX_LENGTH).join('')}…`
    : normalized;
}

/** Display label for one character in a fan-out notice. */
export function tagPoolDisplayName(personality: PersonalitySummary): string {
  const { displayName } = personality;
  return displayName !== null && displayName !== undefined && displayName !== ''
    ? displayName
    : personality.name;
}
