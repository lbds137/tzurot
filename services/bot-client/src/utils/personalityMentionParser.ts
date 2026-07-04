/**
 * Utility for parsing personality mentions from Discord messages.
 *
 * Multi-tag aware: returns an array of mentioned personalities in textual
 * left-to-right order. At each `@`-anchored position, the longest valid
 * candidate wins (so `@Bambi Prime` beats `@Bambi` when both exist). Deduped
 * by personality ID (first occurrence keeps its slot).
 *
 * Handles:
 * - Multi-word personalities (`@Bambi Prime`, `@Angel Dust`)
 * - Abbreviation-style names with periods (`@Dr. Gregory House`)
 * - Possessive suffixes (`@Lilith's` → `Lilith`), straight OR typographic apostrophe
 * - Discord markdown wrapping (`*@X*`, `` `@X` ``, `||@X||`, etc.)
 * - Trailing punctuation (`@Lilith,` / `@Lilith?` / `@Lilith.`)
 * - Typographic "smart" quotes from mobile autocorrect (U+2018/2019/201C/201D → ASCII)
 *
 * Performance: batches all candidate lookups into a single Promise.all() so a
 * message with N mention positions × M candidates each costs one parallel
 * DB roundtrip rather than N×M sequential calls.
 *
 * Security: caps the position-extraction step at MAX_POTENTIAL_MENTIONS to
 * prevent resource exhaustion attacks (a message full of `@`-noise).
 */

import { MULTI_TAG } from '@tzurot/common-types/constants/message';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';

const logger = createLogger('PersonalityMentionParser');
const MAX_MENTION_WORDS = 4;
const MAX_POTENTIAL_MENTIONS = 10; // Bound on positions scanned per message.

/** Strip possessive suffix ('s) from a name candidate to also try the base form. */
const POSSESSIVE_SUFFIX = /'s$/i;

/**
 * Typographic "smart" quotes that mobile keyboards auto-insert for apostrophes
 * and quotes. Normalized to their ASCII equivalents on the raw capture so the
 * straight-quote POSSESSIVE_SUFFIX + punctuation strips below also handle them
 * (e.g. `@Lucifer's` typed on a phone arrives with U+2019, not `'`, so the
 * possessive strip never produces the `Lucifer` candidate). Bonus: a
 * smart-quote-typed apostrophe name (`@O'Brien`) then matches its straight-stored form.
 */
const SMART_SINGLE_QUOTES = /[\u2018\u2019]/g;
const SMART_DOUBLE_QUOTES = /[\u201c\u201d]/g;

/**
 * Strip trailing punctuation — full-strip variant. Strips sentence punctuation
 * (".", "!", "?"), list punctuation (",", ";", ":"), quotes, Discord markdown
 * chars (`*_~|`), and the backtick used for inline-code formatting.
 * Bounded `{1,16}` prevents polynomial-slide ReDoS.
 */
const WORD_PUNCTUATION_STRIP_ALL = /[.,!?;:)"'*_~|`]{1,16}$/;

/**
 * Strip trailing punctuation — period-preserving variant. Allows abbreviation
 * names like "Dr." to keep their semantic period while still stripping other
 * trailing markdown/punctuation. Both variants feed the candidate set; whichever
 * matches a real personality wins at lookup time.
 */
const WORD_PUNCTUATION_STRIP_NON_PERIOD = /[,!?;:)"'*_~|`]{1,16}$/;

/**
 * A matched personality mention with its textual position. Position is the
 * index of the `@` character in the original content; useful for slot
 * ordering when combined with other trigger sources (reply, activation).
 */
export interface PersonalityMentionMatch {
  /** The full loaded personality object (already access-checked for the user). */
  personality: LoadedPersonality;
  /** Index of the `@` character that started this match in the original content. */
  startIndex: number;
}

/**
 * Find all personality mentions in a message, in textual order.
 *
 * Returns an array of `{personality, startIndex}` deduplicated by personality
 * ID (first occurrence keeps its slot). Capped at `maxMentions` after dedupe.
 *
 * @param content      Message content to search.
 * @param mentionChar  Mention prefix character (from `BOT_MENTION_CHAR`).
 * @param personalityService  Loader used to validate candidates (also enforces access control).
 * @param userId       Discord user ID — only personalities accessible to this user match.
 * @param maxMentions  Maximum mentions to return. Defaults to `MULTI_TAG.MAX_TAGS`.
 *
 * Examples:
 * - `'@Lilith hi'`  → `[{personality: Lilith, startIndex: 0}]`
 * - `'@Bambi @Bambi Prime hi'` → `[{Bambi, 0}, {BambiPrime, 7}]` (two distinct personalities)
 * - `'@Bambi @Bambi hi'` → `[{Bambi, 0}]` (dedupe — same personality)
 * - `'@Unknown @Lilith hi'` → `[{Lilith, 9}]` (invalid mention skipped)
 * - `'@A @B @C @D @E @F'` with cap 5 → first 5 in textual order
 */
export async function findPersonalityMentions(
  content: string,
  mentionChar: string,
  personalityService: IPersonalityLoader,
  userId: string,
  maxMentions: number = MULTI_TAG.MAX_TAGS
): Promise<PersonalityMentionMatch[]> {
  logger.debug({ contentLength: content.length, mentionChar }, 'Parsing multi-tag mentions');

  const escapedChar = mentionChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Step 1: walk all `@`-anchored positions, generate candidate names per position.
  const positions = extractCandidatesByPosition(content, escapedChar);

  if (positions.length === 0) {
    return [];
  }

  // Step 2: batch-load all unique candidates across all positions.
  const allCandidateNames = new Set<string>();
  for (const pos of positions) {
    for (const name of pos.candidates) {
      allCandidateNames.add(name);
    }
  }

  const nameToPersonality = new Map<string, LoadedPersonality | null>();
  await Promise.all(
    Array.from(allCandidateNames).map(async name => {
      const loaded = await personalityService.loadPersonality(name, userId);
      nameToPersonality.set(name, loaded);
    })
  );

  // Step 3: walk positions in textual order, picking longest valid candidate per position.
  // Dedupe by personality ID — first occurrence keeps its slot.
  const seenPersonalityIds = new Set<string>();
  const results: PersonalityMentionMatch[] = [];

  for (const pos of positions) {
    if (results.length >= maxMentions) {
      break;
    }
    for (const candidateName of pos.candidates) {
      const personality = nameToPersonality.get(candidateName);
      if (personality === null || personality === undefined) {
        continue;
      }
      if (seenPersonalityIds.has(personality.id)) {
        // Same personality already in another slot — stop trying candidates
        // at this position. We don't fall through to a shorter alternative
        // because the longest-match-wins rule already picked the right one
        // at the earlier position; trying a shorter name here would be
        // semantically equivalent to "@Bambi @Bambi Prime" picking
        // "Bambi Prime" at slot 0 and then "Bambi" at slot 1 — wrong.
        break;
      }
      seenPersonalityIds.add(personality.id);
      results.push({ personality, startIndex: pos.startIndex });
      break;
    }
  }

  logger.debug(
    {
      mentionCount: results.length,
      names: results.map(r => r.personality.name),
    },
    'Found personality mentions'
  );

  return results;
}

interface CandidatesAtPosition {
  /** Position of the `@` character in the original content. */
  startIndex: number;
  /** Candidate names to try, longest-first. First valid one wins for this position. */
  candidates: string[];
}

/**
 * Walk all `@`-anchored matches in textual order and produce a candidate list
 * per match position. Each match consumes up to `MAX_MENTION_WORDS` words
 * after the `@`; the candidate list goes from longest (all captured words) to
 * shortest (single word), with both punctuation-stripping variants and the
 * possessive-stripped form included.
 *
 * Capped at `MAX_POTENTIAL_MENTIONS` positions.
 */

function extractCandidatesByPosition(content: string, escapedChar: string): CandidatesAtPosition[] {
  // Multi-word capture: starts at `@`, captures 1..MAX_MENTION_WORDS whitespace-
  // separated tokens that contain no `@` or newline. Single-word mentions like
  // `@Lilith` are captured as a 1-word match (next char is a separator or EOL).
  const multiWordRegex = new RegExp(
    `${escapedChar}([^\\s${escapedChar}\\n]+(?:\\s+[^\\s${escapedChar}\\n]+){0,${MAX_MENTION_WORDS - 1}})`,
    'gi'
  );

  const positions: CandidatesAtPosition[] = [];

  for (const match of content.matchAll(multiWordRegex)) {
    if (positions.length >= MAX_POTENTIAL_MENTIONS) {
      logger.warn(
        { limit: MAX_POTENTIAL_MENTIONS },
        'Position cap reached; remaining mentions ignored to prevent resource exhaustion'
      );
      break;
    }

    // Normalize "smart" quotes to ASCII first so the straight-quote possessive +
    // punctuation strips below see e.g. `Lucifer's` (U+2019) as `Lucifer's`.
    const captureGroup = (match[1] ?? '')
      .replace(SMART_SINGLE_QUOTES, "'")
      .replace(SMART_DOUBLE_QUOTES, '"');
    const startIndex = match.index ?? 0;

    // Strip trailing punctuation from the whole capture before splitting.
    const cleanedCapture = captureGroup.replace(WORD_PUNCTUATION_STRIP_ALL, '');
    if (cleanedCapture.length === 0) {
      continue;
    }

    const rawWords = cleanedCapture.split(/\s+/);
    const wordsAllStripped = rawWords.map(w => w.replace(WORD_PUNCTUATION_STRIP_ALL, ''));
    const wordsPeriodPreserved = rawWords.map(w =>
      w.replace(WORD_PUNCTUATION_STRIP_NON_PERIOD, '')
    );

    // Build candidate list longest-first; both punctuation variants per word
    // count; plus possessive-stripped forms. Dedup within this position so we
    // don't try the same name twice.
    const candidates: string[] = [];
    const seen = new Set<string>();
    const addCandidate = (name: string): void => {
      // Skip empty / already-seen names + Discord-mention-syntax artifacts
      // that the `@`-anchored capture can produce:
      //   - `<@123>` / `@123456` (user) → all-digit → personality names
      //     can't be purely numeric anyway.
      //   - `<@&123>` (role) → capture starts at `@`, captures `&123` or
      //     `&123>` (the trailing `>` survives `WORD_PUNCTUATION_STRIP_ALL`
      //     which doesn't include `>`). The optional-`>?` branch of the
      //     filter regex catches both shapes.
      // Channel mentions `<#123>` don't start with `@`, so they never
      // enter this parser at all — the `#` branch in the filter regex is
      // defensive belt-and-suspenders, not load-bearing.
      // Mixed names like "2B" (digit + letter) still pass — filter is
      // strictly Discord-mention-shape, not "contains-digits."
      if (name.length === 0 || seen.has(name)) {
        return;
      }
      if (/^\d+$/.test(name) || /^[&#]\d+>?$/.test(name)) {
        return;
      }
      candidates.push(name);
      seen.add(name);
    };

    for (
      let wordCount = Math.min(MAX_MENTION_WORDS, rawWords.length);
      wordCount >= 1;
      wordCount--
    ) {
      const stripped = wordsAllStripped.slice(0, wordCount).join(' ').trim();
      const withPeriod = wordsPeriodPreserved.slice(0, wordCount).join(' ').trim();

      addCandidate(stripped);
      addCandidate(stripped.replace(POSSESSIVE_SUFFIX, ''));
      if (withPeriod !== stripped) {
        addCandidate(withPeriod);
        addCandidate(withPeriod.replace(POSSESSIVE_SUFFIX, ''));
      }
    }

    if (candidates.length > 0) {
      positions.push({ startIndex, candidates });
    }
  }

  return positions;
}
