import { describe, expect, it } from 'vitest';
import {
  findQuotedNgram,
  decideDigestLength,
  validateDigest,
  hasFirstPerson,
} from './recentDaysDigestValidation.js';
import { RECENT_DAYS_DIGEST } from '@tzurot/common-types/constants/recentDaysDigest';

const EIGHT_WORDS = 'the quick brown fox jumps over the lazy dog today';

describe('findQuotedNgram', () => {
  it('flags an exact 8-word run repeated from an assistant row', () => {
    const found = findQuotedNgram(`Nova said ${EIGHT_WORDS} yesterday.`, [EIGHT_WORDS]);
    expect(found).not.toBeNull();
  });

  it('does not flag the same 8 words when they only appear in a USER row', () => {
    const found = findQuotedNgram(`Jules mentioned ${EIGHT_WORDS}.`, []);
    expect(found).toBeNull();
  });

  it('does not flag a 7-word run', () => {
    const sevenWords = 'the quick brown fox jumps over the';
    const found = findQuotedNgram(`Nova said ${sevenWords} yesterday.`, [sevenWords]);
    expect(found).toBeNull();
  });

  it('is defeated by neither case nor punctuation differences', () => {
    const digest = '"Hello, World" is what Nova told them, plus some more words to pad it out here';
    const assistant = 'hello world is what nova told them plus some';
    const found = findQuotedNgram(digest, [assistant]);
    expect(found).not.toBeNull();
  });

  it('is not defeated by a lifted run wrapped in curly single quotes', () => {
    const exactlyEight = 'we will meet at the old harbour tomorrow';
    expect(
      findQuotedNgram(`Nova wrote ‘${exactlyEight}’ to Jules.`, [exactlyEight])
    ).not.toBeNull();
  });
  it('respects a custom n', () => {
    const words = 'one two three four five six seven';
    expect(findQuotedNgram(`prefix ${words} suffix`, [words], 7)).not.toBeNull();
  });
});

describe('decideDigestLength', () => {
  it('is within_soft at or under the soft cap', () => {
    expect(decideDigestLength(RECENT_DAYS_DIGEST.SOFT_CAP_TOKENS)).toBe('within_soft');
  });

  it('is over_soft above the soft cap but at or under the hard cap', () => {
    expect(decideDigestLength(RECENT_DAYS_DIGEST.SOFT_CAP_TOKENS + 1)).toBe('over_soft');
    expect(decideDigestLength(RECENT_DAYS_DIGEST.HARD_CAP_TOKENS)).toBe('over_soft');
  });

  it('is overflow above the hard cap', () => {
    expect(decideDigestLength(RECENT_DAYS_DIGEST.HARD_CAP_TOKENS + 1)).toBe('overflow');
  });
});

describe('validateDigest', () => {
  it('flags first_person via the imported hasFirstPerson', () => {
    const result = validateDigest('I promised to help Jules move.', []);
    expect(result).toEqual({ ok: false, cls: 'first_person', detail: expect.any(String) });
    expect(hasFirstPerson('I promised')).toBe(true);
  });

  it('the first_person detail is the matched token', () => {
    const result = validateDigest('Nova and Jules talked. I will follow up.', []);
    expect(result).toEqual({ ok: false, cls: 'first_person', detail: 'I' });
  });

  it('flags quotation before overflow when both would trip', () => {
    const digest = `${EIGHT_WORDS} `.repeat(60); // long enough to overflow too
    const result = validateDigest(digest, [EIGHT_WORDS]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.cls).toBe('quotation');
    }
  });

  it('flags overflow on the final text over the hard cap', () => {
    const digest = 'word '.repeat(RECENT_DAYS_DIGEST.HARD_CAP_TOKENS + 50);
    const result = validateDigest(digest, []);
    expect(result).toEqual({ ok: false, cls: 'overflow', detail: expect.any(String) });
  });

  it('accepts a clean, third-person, unquoted digest under the hard cap', () => {
    const result = validateDigest('Jules and Nova discussed weekend plans.', ['sure, sounds good']);
    expect(result).toEqual({ ok: true });
  });

  it('accepts a single-quoted first-person span as third-person prose', () => {
    const result = validateDigest("Lila said 'I love you'; Emily called her best girlfriend.", []);
    expect(result).toEqual({ ok: true });
  });

  it('does not fail on over_soft alone', () => {
    const digest = 'word '.repeat(RECENT_DAYS_DIGEST.SOFT_CAP_TOKENS + 10);
    const result = validateDigest(digest, []);
    expect(result.ok).toBe(true);
  });
});
