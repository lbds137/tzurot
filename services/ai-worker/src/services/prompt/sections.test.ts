import { describe, it, expect } from 'vitest';
import {
  assembleSections,
  describeSections,
  SECTION_SEPARATOR,
  type PromptSection,
} from './sections.js';

function section(id: string, text: string, tier: PromptSection['tier'] = 'V'): PromptSection {
  return { id, tier, render: () => text };
}

describe('assembleSections', () => {
  it('joins non-empty sections with the separator, in order', () => {
    const result = assembleSections([section('a', 'first'), section('b', 'second')]);
    expect(result).toBe(`first${SECTION_SEPARATOR}second`);
  });

  it('omits empty sections without emitting their separator', () => {
    const result = assembleSections([
      section('a', 'first'),
      section('gone', ''),
      section('b', 'second'),
    ]);
    expect(result).toBe(`first${SECTION_SEPARATOR}second`);
  });

  it('returns an empty string when every section is empty', () => {
    expect(assembleSections([section('a', ''), section('b', '')])).toBe('');
  });

  it('returns a lone section bare (no separators)', () => {
    expect(assembleSections([section('only', 'content')])).toBe('content');
  });
});

describe('describeSections', () => {
  // The offsets exist for the prefix-diff tool and the composition log: a
  // divergence offset maps back to "which section changed". An off-by-one here
  // misattributes divergence, so offsets are checked against the assembled
  // string itself rather than against hand-computed numbers.
  it('reports offsets that index back into the assembled string', () => {
    const sections = [
      section('identity', '<system_identity>x</system_identity>', 'S1'),
      section('context', '<context>now</context>', 'V'),
      section('protocol', '<protocol>rules</protocol>', 'S1'),
    ];
    const assembled = assembleSections(sections);

    for (const described of describeSections(sections)) {
      const slice = assembled.slice(described.offset, described.offset + described.chars);
      expect(slice).toBe(sections.find(s => s.id === described.id)?.render());
    }
  });

  it('skips omitted sections and keeps later offsets correct', () => {
    const sections = [section('a', 'xxxx'), section('empty', ''), section('b', 'yy')];

    expect(describeSections(sections)).toEqual([
      { id: 'a', tier: 'V', chars: 4, offset: 0 },
      // 4 chars + the 2-char separator; the empty section contributes nothing
      { id: 'b', tier: 'V', chars: 2, offset: 6 },
    ]);
  });

  it('carries the tier through for placement-aware consumers', () => {
    const described = describeSections([section('platform_constraints', 'text', 'S0')]);
    expect(described[0].tier).toBe('S0');
  });

  it('returns an empty description list when nothing renders', () => {
    expect(describeSections([section('a', '')])).toEqual([]);
  });
});
