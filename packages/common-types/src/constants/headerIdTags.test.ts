import { describe, it, expect } from 'vitest';
import { HEADER_ID_TAG_WIDTHS, buildHeaderIdTagPattern } from './headerIdTags.js';

describe('HEADER_ID_TAG_WIDTHS', () => {
  it('pins the three emitted widths', () => {
    expect(HEADER_ID_TAG_WIDTHS).toEqual([4, 8, 32]);
  });
});

describe('buildHeaderIdTagPattern', () => {
  it('matches a 4-hex tag', () => {
    expect('(id:abcd)').toMatch(buildHeaderIdTagPattern());
  });

  it('matches an 8-hex tag', () => {
    expect('(id:abcd1234)').toMatch(buildHeaderIdTagPattern());
  });

  it('matches a 32-hex tag', () => {
    expect(`(id:${'a'.repeat(32)})`).toMatch(buildHeaderIdTagPattern());
  });

  it('rejects a 5-hex tag — bounded widths, not open-ended', () => {
    expect('(id:abcde)').not.toMatch(buildHeaderIdTagPattern());
  });

  it('rejects a 12-hex tag — bounded widths, not open-ended', () => {
    expect('(id:abcdef012345)').not.toMatch(buildHeaderIdTagPattern());
  });

  it('matches uppercase hex', () => {
    expect('(id:ABCD1234)').toMatch(buildHeaderIdTagPattern());
  });

  it('carries the g flag, and successive calls are independent objects', () => {
    const first = buildHeaderIdTagPattern();
    const second = buildHeaderIdTagPattern();
    expect(first.flags).toContain('g');
    expect(first).not.toBe(second);

    // Advance the first pattern's lastIndex mid-scan; the second must be
    // unaffected since it is a fresh object, not an alias.
    const text = '(id:abcd) (id:1234)';
    first.exec(text);
    expect(first.lastIndex).toBeGreaterThan(0);
    expect(second.lastIndex).toBe(0);
  });

  it('ties the full-hex fallback width to a real UUID producer shape', () => {
    // Mirrors ai-worker's `hexOf`: lowercase, strip hyphens.
    const uuid = '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';
    const hex = uuid.toLowerCase().replace(/-/g, '');

    expect(hex).toHaveLength(32);
    expect(hex).toHaveLength(HEADER_ID_TAG_WIDTHS[HEADER_ID_TAG_WIDTHS.length - 1]);
    expect(`(id:${hex})`).toMatch(buildHeaderIdTagPattern());
  });
});
