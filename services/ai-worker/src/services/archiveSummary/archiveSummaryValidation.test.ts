import { describe, it, expect } from 'vitest';
import { decideLengthState } from './archiveSummaryValidation.js';

describe('decideLengthState', () => {
  it('overflow: final text over the hard cap', () => {
    expect(decideLengthState({ firstTokens: 200, finalTokens: 130, regenerated: true })).toBe(
      'overflow'
    );
  });

  it('within_soft: first pass already under the soft cap', () => {
    expect(decideLengthState({ firstTokens: 50, finalTokens: 50, regenerated: false })).toBe(
      'within_soft'
    );
  });

  it('regenerated: first pass over soft cap, regeneration ran and produced an acceptable final', () => {
    expect(decideLengthState({ firstTokens: 90, finalTokens: 70, regenerated: true })).toBe(
      'regenerated'
    );
  });

  it('over_soft: unreachable in production but exercised as the branch fallback', () => {
    expect(decideLengthState({ firstTokens: 90, finalTokens: 90, regenerated: false })).toBe(
      'over_soft'
    );
  });
});
