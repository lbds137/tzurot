import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { hashContentFull, buildRegenerationFeedback, CallTally } from './archiveSummaryFeedback.js';
import { SUMMARY_SOFT_CAP_TOKENS } from './constants.js';

describe('hashContentFull', () => {
  it('returns the full 64-char sha256 hex of the content', () => {
    const expected = createHash('sha256').update('hello world').digest('hex');
    expect(hashContentFull('hello world')).toBe(expected);
    expect(hashContentFull('hello world')).toHaveLength(64);
  });

  it('is case-sensitive (unlike duplicateDetection.ts contentHash)', () => {
    expect(hashContentFull('Hello')).not.toBe(hashContentFull('hello'));
  });
});

describe('buildRegenerationFeedback', () => {
  it('returns an empty array when nothing applies', () => {
    expect(buildRegenerationFeedback(10, false, [])).toEqual([]);
  });

  it('flags an over-length first pass', () => {
    expect(buildRegenerationFeedback(SUMMARY_SOFT_CAP_TOKENS + 1, false, [])).toEqual([
      'over the length cap',
    ]);
  });

  it('flags a first-person leak', () => {
    expect(buildRegenerationFeedback(10, true, [])).toEqual(['contains a first-person pronoun']);
  });

  it('names every dangling referent, comma-joined', () => {
    expect(buildRegenerationFeedback(10, false, ['the plan', 'the vet'])).toEqual([
      'names: the plan, the vet',
    ]);
  });

  it('combines all three when all apply', () => {
    expect(buildRegenerationFeedback(SUMMARY_SOFT_CAP_TOKENS + 1, true, ['the plan'])).toEqual([
      'over the length cap',
      'contains a first-person pronoun',
      'names: the plan',
    ]);
  });
});

describe('CallTally', () => {
  it('starts at zero', () => {
    const tally = new CallTally();
    expect(tally).toEqual({ calls: 0, tokensIn: 0, tokensOut: 0 });
  });

  it('sums tokensIn/tokensOut across every recorded call, distinct counts each', () => {
    const tally = new CallTally();
    tally.record({ tokensIn: 10, tokensOut: 5 });
    tally.record({ tokensIn: 20, tokensOut: 8 });
    tally.record({ tokensIn: 7, tokensOut: 3 });
    tally.record({ tokensIn: 1, tokensOut: 1 });

    expect(tally.calls).toBe(4);
    expect(tally.tokensIn).toBe(38);
    expect(tally.tokensOut).toBe(17);
  });
});
