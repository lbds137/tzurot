import { describe, it, expect } from 'vitest';

import { pickEvenlySpaced } from '../memory/sampling.js';
import {
  assignDepthStrata,
  detectProtocolFormat,
  parseDepthsOption,
  pickPersonalities,
  type PersonalityPick,
} from './voice-probes.js';

describe('parseDepthsOption', () => {
  it('parses a comma-separated string', () => {
    expect(parseDepthsOption('5, 10,15')).toEqual([5, 10, 15]);
  });

  it('accepts a NUMBER (cac coerces a single digit-only --depths value at tokenize time)', () => {
    expect(parseDepthsOption(30)).toEqual([30]);
  });

  it('dedupes repeated depths (a duplicate would emit duplicate probes)', () => {
    expect(parseDepthsOption('5,5,10')).toEqual([5, 10]);
  });

  it('returns undefined for absent/empty input', () => {
    expect(parseDepthsOption(undefined)).toBeUndefined();
    expect(parseDepthsOption('')).toBeUndefined();
    expect(parseDepthsOption('   ')).toBeUndefined();
  });

  it('throws on non-positive or non-integer values', () => {
    expect(() => parseDepthsOption('5,0')).toThrow(/positive integers/);
    expect(() => parseDepthsOption('5,abc')).toThrow(/positive integers/);
    expect(() => parseDepthsOption('2.5')).toThrow(/positive integers/);
  });
});

const JSON_PROTOCOL = JSON.stringify({
  permissions: ['a'],
  characterDirectives: ['b'],
  formattingRules: ['c'],
});

describe('detectProtocolFormat', () => {
  it('detects the JSON protocol shape (three string arrays)', () => {
    expect(detectProtocolFormat(JSON_PROTOCOL)).toBe('json');
  });

  it('treats non-JSON text as the legacy XML format', () => {
    expect(detectProtocolFormat('<protocol>You are {user}’s companion</protocol>')).toBe('legacy');
  });

  it('treats VALID JSON missing the protocol fields as legacy (matches production fallback)', () => {
    // parseProtocolJson returns null for these, and production then takes the
    // legacy pass-through path — so the miner must label them the same way.
    expect(detectProtocolFormat('{"permissions": ["a"]}')).toBe('legacy');
    expect(detectProtocolFormat('{"permissions": [1, 2]}')).toBe('legacy');
    expect(detectProtocolFormat('"just a JSON string"')).toBe('legacy');
  });

  it('labels empty/missing protocols none', () => {
    expect(detectProtocolFormat(null)).toBe('none');
    expect(detectProtocolFormat(undefined)).toBe('none');
    expect(detectProtocolFormat('')).toBe('none');
  });
});

describe('pickPersonalities', () => {
  const pick = (
    slug: string,
    assistantTurns: number,
    protocolFormat: PersonalityPick['protocolFormat']
  ): PersonalityPick => ({
    id: `id-${slug}`,
    slug,
    name: slug,
    protocolFormat,
    assistantTurns,
  });

  it('picks the most-active personalities when both formats are already covered', () => {
    const { picked, warnings } = pickPersonalities(
      [
        pick('a', 100, 'json'),
        pick('b', 90, 'legacy'),
        pick('c', 80, 'json'),
        pick('d', 5, 'json'),
      ],
      3
    );
    expect(picked.map(p => p.slug)).toEqual(['a', 'b', 'c']);
    expect(warnings).toEqual([]);
  });

  it('swaps the least-active pick for the most-active candidate of a missing format', () => {
    const { picked, warnings } = pickPersonalities(
      [
        pick('a', 100, 'json'),
        pick('b', 90, 'json'),
        pick('c', 80, 'json'),
        pick('d', 5, 'legacy'),
      ],
      3
    );
    expect(picked.map(p => p.slug)).toEqual(['a', 'b', 'd']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('legacy');
  });

  it('warns (without failing) when a format simply does not exist among candidates', () => {
    const { picked, warnings } = pickPersonalities(
      [pick('a', 10, 'json'), pick('b', 5, 'json')],
      2
    );
    expect(picked.map(p => p.slug)).toEqual(['a', 'b']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('single format');
  });

  it('excludes protocol-less personalities entirely', () => {
    const { picked } = pickPersonalities([pick('a', 100, 'none'), pick('b', 1, 'json')], 2);
    expect(picked.map(p => p.slug)).toEqual(['b']);
  });

  it('warns when fewer qualifying personalities exist than requested (no silent under-fill)', () => {
    const { picked, warnings } = pickPersonalities([pick('a', 10, 'json')], 4);
    expect(picked.map(p => p.slug)).toEqual(['a']);
    expect(warnings.some(warning => warning.includes('Only 1'))).toBe(true);
  });

  it('returns empty (no phantom swap, no warning) for a non-positive count', () => {
    const { picked, warnings } = pickPersonalities([pick('a', 10, 'json')], 0);
    expect(picked).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('count=1 keeps the MOST-ACTIVE candidate — no format-coverage swap with a single slot', () => {
    // With one slot, both-format coverage is unachievable; the swap loop must
    // not overwrite the top pick with a far-less-active other-format candidate.
    const { picked, warnings } = pickPersonalities(
      [pick('top-json', 1000, 'json'), pick('weak-legacy', 1, 'legacy')],
      1
    );
    expect(picked.map(p => p.slug)).toEqual(['top-json']);
    expect(warnings).toEqual([]);
  });

  it('is deterministic on activity ties (slug tie-break)', () => {
    const first = pickPersonalities([pick('zz', 10, 'json'), pick('aa', 10, 'legacy')], 1);
    const second = pickPersonalities([pick('aa', 10, 'legacy'), pick('zz', 10, 'json')], 1);
    expect(first.picked.map(p => p.slug)).toEqual(second.picked.map(p => p.slug));
  });
});

describe('assignDepthStrata', () => {
  const anchors = Array.from({ length: 40 }, (_, index) => ({ id: `a${index}`, index }));

  it('deals evenly-spaced anchors round-robin so each depth spans the timeline', () => {
    const strata = assignDepthStrata(anchors, [5, 10], 3, pickEvenlySpaced);
    expect(strata.get(5)).toHaveLength(3);
    expect(strata.get(10)).toHaveLength(3);
    // Round-robin over an evenly-spaced pick: both depths span the timeline
    // (each stratum's candidates cover at least half the 40-anchor range),
    // instead of one depth clustering in one era.
    const indexOf = (list: { index: number }[] | undefined): number[] =>
      (list ?? []).map(item => item.index);
    for (const depth of [5, 10]) {
      const indices = indexOf(strata.get(depth));
      expect(Math.max(...indices) - Math.min(...indices)).toBeGreaterThanOrEqual(15);
    }
  });

  it('is deterministic', () => {
    const first = assignDepthStrata(anchors, [5, 10, 15], 2, pickEvenlySpaced);
    const second = assignDepthStrata(anchors, [5, 10, 15], 2, pickEvenlySpaced);
    expect(first).toEqual(second);
  });

  it('handles a pool smaller than the request', () => {
    const tiny = anchors.slice(0, 3);
    const strata = assignDepthStrata(tiny, [5, 10], 4, pickEvenlySpaced);
    const total = (strata.get(5)?.length ?? 0) + (strata.get(10)?.length ?? 0);
    expect(total).toBe(3);
  });

  it('returns empty strata for empty depths', () => {
    expect(assignDepthStrata(anchors, [], 3, pickEvenlySpaced).size).toBe(0);
  });
});
