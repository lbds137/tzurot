import { describe, it, expect } from 'vitest';
import { stripQuotedSpans, hasFirstPerson, decideLengthState } from './archiveSummaryValidation.js';

describe('stripQuotedSpans', () => {
  it('removes straight-quoted spans', () => {
    expect(stripQuotedSpans('Nova called Jules "my dear" once.')).toBe('Nova called Jules  once.');
  });

  it('removes curly-quoted spans', () => {
    expect(stripQuotedSpans('Nova called Jules “my dear” once.')).toBe('Nova called Jules  once.');
  });
});

describe('hasFirstPerson', () => {
  it('MEM-ARCH-018: a quoted form of address is not a leak, the same words unquoted ARE', () => {
    expect(hasFirstPerson('Nova called Jules "my dear" once.')).toBe(false);
    expect(hasFirstPerson('Nova called Jules “my dear” once.')).toBe(false);
    expect(hasFirstPerson('Nova called Jules my dear once.')).toBe(true);
  });

  it('flags a curly-apostrophe contraction', () => {
    expect(hasFirstPerson('I’m going to the store.')).toBe(true);
  });

  it('flags sentence-initial We/My/Me/Our/Ours/Us/Mine/Myself', () => {
    expect(hasFirstPerson('We agreed to meet Saturday.')).toBe(true);
    expect(hasFirstPerson('My plan is to hike.')).toBe(true);
    expect(hasFirstPerson('Me and Jules talked.')).toBe(true);
    expect(hasFirstPerson('Our plan is set.')).toBe(true);
    expect(hasFirstPerson('Ours is the better plan.')).toBe(true);
    expect(hasFirstPerson('Us against the world.')).toBe(true);
    expect(hasFirstPerson('Mine was the second plan.')).toBe(true);
    expect(hasFirstPerson('Myself included, everyone agreed.')).toBe(true);
  });

  it('does not flag words that merely contain the pronoun as a substring', () => {
    expect(hasFirstPerson('Nova lives in Melbourne.')).toBe(false);
    expect(hasFirstPerson('The mineral was rare.')).toBe(false);
    expect(hasFirstPerson('Nova is using the tool.')).toBe(false);
  });

  it('flags the reflexive ourselves/ourself forms', () => {
    expect(hasFirstPerson('Ourselves included, everyone agreed.')).toBe(true);
    expect(hasFirstPerson('They kept the plan to ourselves.')).toBe(true);
    expect(hasFirstPerson('Ourself is an unusual word.')).toBe(true);
  });
});

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
