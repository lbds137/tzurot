/**
 * Tests for character/tagPool.ts
 *
 * The tag primitives shared by `/random tag:` and `/chime-in tag:`: needle
 * normalization, uniform capped sampling, and the count-sorted vocabulary the
 * autocomplete offers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { TAG_LIMITS, type PersonalitySummary } from '@tzurot/common-types/schemas/api/personality';

// Partial-mock node:crypto so the sample's draw sequence is controllable while
// every other crypto function keeps its real implementation.
vi.mock('node:crypto', async importActual => ({
  ...(await importActual<typeof import('node:crypto')>()),
  randomInt: vi.fn(),
}));

import { randomInt } from 'node:crypto';
import {
  filterByTag,
  sampleUpTo,
  collectTagVocabulary,
  emptyTagPoolDetail,
  tagPoolDisplayName,
} from './tagPool.js';

// randomInt is overloaded (sync → number, async-callback → void); pin the sync
// form so mockReturnValue takes a number rather than the callback overload's void.
const mockedRandomInt = vi.mocked(randomInt as (max: number) => number);

const makeSummary = (slug: string, opts: { displayName?: string | null; tags?: string[] } = {}) =>
  ({
    id: `id-${slug}`,
    slug,
    name: slug,
    displayName: opts.displayName ?? null,
    isOwned: true,
    isPublic: true,
    ownerId: 'user-123',
    ownerDiscordId: 'user-123',
    tags: opts.tags ?? [],
    permissions: { canEdit: true, canDelete: true },
    // Typed so a PersonalitySummary shape change breaks this at compile time.
  }) satisfies PersonalitySummary;

beforeEach(() => {
  vi.clearAllMocks();
  mockedRandomInt.mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('filterByTag', () => {
  const pool = [
    makeSummary('a', { tags: ['fantasy', 'noir'] }),
    makeSummary('b', { tags: ['sci-fi'] }),
    makeSummary('c', { tags: [] }),
    makeSummary('d', { tags: ['fantasy'] }),
  ];

  it('keeps only the characters carrying the tag', () => {
    expect(filterByTag(pool, 'fantasy').map(p => p.slug)).toEqual(['a', 'd']);
  });

  it('normalizes the needle before matching', () => {
    expect(filterByTag(pool, '  Sci   Fi  ').map(p => p.slug)).toEqual(['b']);
  });

  it('matches the whole tag, never a prefix of one', () => {
    // 'fan' must NOT match the stored 'fantasy' — a substring match would make
    // the pool silently wider than the tag the user picked.
    expect(filterByTag(pool, 'fan')).toEqual([]);
  });

  it('matches nothing when the needle normalizes to empty', () => {
    // An empty needle must not degenerate into "match everything".
    expect(filterByTag(pool, '   ')).toEqual([]);
    expect(filterByTag(pool, '---')).toEqual([]);
  });

  it('returns an empty list for a tag nobody carries', () => {
    expect(filterByTag(pool, 'western')).toEqual([]);
  });
});

describe('sampleUpTo', () => {
  it('returns everything, in input order, when the cap covers the pool', () => {
    expect(sampleUpTo([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(sampleUpTo([1, 2, 3], 3)).toEqual([1, 2, 3]);
    // Sampling everything is not a sample — no draw should have been made
    expect(mockedRandomInt).not.toHaveBeenCalled();
  });

  it('copies rather than aliasing the input when the cap covers the pool', () => {
    const input = [1, 2, 3];
    const out = sampleUpTo(input, 5);
    expect(out).not.toBe(input);
  });

  it('returns exactly cap-many items when the pool is larger', () => {
    mockedRandomInt.mockReturnValue(0);
    expect(sampleUpTo(['a', 'b', 'c', 'd', 'e'], 2)).toHaveLength(2);
  });

  it('draws without replacement across a shrinking remainder', () => {
    // Always drawing index 0 walks the swap-with-last removal: a, then e (which
    // was swapped into slot 0), then d. Distinct items prove no replacement.
    mockedRandomInt.mockReturnValue(0);

    const drawn = sampleUpTo(['a', 'b', 'c', 'd', 'e'], 3);

    expect(drawn).toEqual(['a', 'e', 'd']);
    expect(new Set(drawn).size).toBe(3);
    // The half-open bound shrinks by one per draw — this is what makes the draw
    // uniform over the REMAINING items rather than the original pool.
    expect(mockedRandomInt.mock.calls).toEqual([[5], [4], [3]]);
  });

  it('honours the drawn index rather than always taking the head', () => {
    mockedRandomInt.mockReturnValueOnce(2).mockReturnValueOnce(0);

    expect(sampleUpTo(['a', 'b', 'c', 'd'], 2)).toEqual(['c', 'a']);
  });

  it('returns nothing for a non-positive cap', () => {
    expect(sampleUpTo(['a', 'b'], 0)).toEqual([]);
    expect(sampleUpTo(['a', 'b'], -1)).toEqual([]);
  });
});

describe('collectTagVocabulary', () => {
  it('counts each tag across the pool, most-used first', () => {
    // Tag names are deliberately in REVERSE alphabetical order of their counts,
    // so an alphabetical-only sort produces a different result. A fixture whose
    // count order happens to match its alphabetical order cannot tell the two
    // apart — this assertion proved nothing until the names were chosen to.
    const entries = collectTagVocabulary([
      makeSummary('a', { tags: ['zeta', 'mid'] }),
      makeSummary('b', { tags: ['zeta'] }),
      makeSummary('c', { tags: ['zeta', 'mid'] }),
      makeSummary('d', { tags: ['alpha'] }),
    ]);

    expect(entries).toEqual([
      { tag: 'zeta', count: 3 },
      { tag: 'mid', count: 2 },
      { tag: 'alpha', count: 1 },
    ]);
  });

  it('breaks count ties alphabetically so the dropdown is stable', () => {
    const entries = collectTagVocabulary([makeSummary('a', { tags: ['zeta', 'alpha', 'mid'] })]);

    expect(entries.map(e => e.tag)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('is empty when nothing in the pool is tagged', () => {
    expect(collectTagVocabulary([makeSummary('a'), makeSummary('b')])).toEqual([]);
  });

  it('only sees the pool it is handed (no vocabulary from outside it)', () => {
    // The caller passes the ACCESSIBLE list; a tag on a character absent from
    // that list is structurally unreachable here.
    const entries = collectTagVocabulary([makeSummary('a', { tags: ['visible'] })]);

    expect(entries.map(e => e.tag)).toEqual(['visible']);
  });
});

describe('emptyTagPoolDetail', () => {
  it('echoes the normalized needle', () => {
    expect(emptyTagPoolDetail('Sci Fi')).toContain('`sci-fi`');
  });

  it('folds an extra clause into the first sentence, before the advice', () => {
    const detail = emptyTagPoolDetail('fantasy', ' with `only-mine` also active');

    expect(detail).toContain('`fantasy` with `only-mine` also active.');
    expect(detail.indexOf('only-mine')).toBeLessThan(detail.indexOf('Try a different tag'));
  });

  it('omits the clause entirely when none is given', () => {
    expect(emptyTagPoolDetail('fantasy')).toContain('`fantasy`.');
  });

  it('escapes markdown in the echoed needle — an unmatched needle was never shape-validated', () => {
    // This function fires exactly when the needle matched nothing, so the
    // write-time [a-z0-9-] guarantee does not cover it: a backtick would
    // break out of the inline-code span without escaping.
    expect(emptyTagPoolDetail('sci`fi')).toContain('sci\\`fi');
  });

  it('caps the echoed needle so an over-long tag cannot overrun the reply', () => {
    // `tag` is a free-typed Discord string option — nothing upstream bounds it,
    // and escaping can roughly double what the user typed.
    const detail = emptyTagPoolDetail('a'.repeat(4000));

    expect(detail.length).toBeLessThanOrEqual(DISCORD_LIMITS.MESSAGE_LENGTH);
    expect(detail).toContain(`\`${'a'.repeat(TAG_LIMITS.MAX_LENGTH)}…\``);
  });

  it('cuts the echoed needle on a code-point boundary', () => {
    // A UTF-16 `.slice` at the cap would end on a lone surrogate.
    const detail = emptyTagPoolDetail('🎲'.repeat(TAG_LIMITS.MAX_LENGTH + 5));

    expect(detail).toContain(`\`${'🎲'.repeat(TAG_LIMITS.MAX_LENGTH)}…\``);
  });
});

describe('tagPoolDisplayName', () => {
  it('prefers displayName', () => {
    expect(tagPoolDisplayName(makeSummary('slug-a', { displayName: 'Fancy' }))).toBe('Fancy');
  });

  it('falls back to name when displayName is null', () => {
    expect(tagPoolDisplayName(makeSummary('slug-a', { displayName: null }))).toBe('slug-a');
  });

  it('falls back to name when displayName is the empty string', () => {
    expect(tagPoolDisplayName(makeSummary('slug-a', { displayName: '' }))).toBe('slug-a');
  });
});
