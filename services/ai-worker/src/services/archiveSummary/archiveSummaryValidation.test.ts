import { describe, it, expect } from 'vitest';
import {
  stripQuotedSpans,
  hasFirstPerson,
  findFirstPersonToken,
  decideLengthState,
} from './archiveSummaryValidation.js';

describe('stripQuotedSpans', () => {
  it('removes straight-quoted spans', () => {
    expect(stripQuotedSpans('Nova called Jules "my dear" once.')).toBe('Nova called Jules  once.');
  });

  it('removes curly-quoted spans', () => {
    expect(stripQuotedSpans('Nova called Jules “my dear” once.')).toBe('Nova called Jules  once.');
  });

  it('removes straight single-quoted spans', () => {
    expect(stripQuotedSpans("Nova called Jules 'my dear' once.")).toBe('Nova called Jules  once.');
  });

  it('removes curly single-quoted spans', () => {
    expect(stripQuotedSpans('Nova called Jules ‘my dear’ once.')).toBe('Nova called Jules  once.');
  });

  it('leaves possessive apostrophes alone', () => {
    expect(stripQuotedSpans("Lila's 2024 breakthrough; Sera's repentance.")).toBe(
      "Lila's 2024 breakthrough; Sera's repentance."
    );
  });

  it('a dash right after the closing quote still closes it', () => {
    expect(stripQuotedSpans("Lila said 'goodbye'—then left.")).toBe('Lila said —then left.');
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

  it('a straight single-quoted span is not a leak, the same words unquoted ARE', () => {
    expect(hasFirstPerson("Lila said 'I love you'; Emily called her best girlfriend.")).toBe(false);
    expect(hasFirstPerson("Lila shared the Nightwish song 'Come Cover Me With You'.")).toBe(false);
    expect(hasFirstPerson("Lila's favourite line 'I love you' came up again.")).toBe(false);
    expect(hasFirstPerson('Lila said I love you; Emily called her best girlfriend.')).toBe(true);
  });

  it('a curly single-quoted span is not a leak', () => {
    expect(hasFirstPerson('Lila said ‘I love you’ again.')).toBe(false);
  });

  it('an apostrophe neither opens nor closes a span', () => {
    expect(hasFirstPerson("Lila's 2024 breakthrough; Sera's repentance.")).toBe(false);
    expect(hasFirstPerson("Sera's repentance, which I doubted, echoed the sisters' vow.")).toBe(
      true
    );
  });

  it('an apostrophe inside a single-quoted span is content, not a closer', () => {
    expect(hasFirstPerson("Lila said 'I don't know' about that.")).toBe(false);
    expect(hasFirstPerson('she said ‘don’t leave me’ softly.')).toBe(false);
    expect(hasFirstPerson("Lila said 'I'm happy' today.")).toBe(false);
    expect(hasFirstPerson("Lila said I don't know about that.")).toBe(true);
  });
});

describe('findFirstPersonToken', () => {
  it('returns the matched token for a bare pronoun after other words', () => {
    expect(findFirstPersonToken('She said I will')).toBe('I');
  });

  it('returns the matched contraction token', () => {
    expect(findFirstPersonToken('I’m going')).toBe('I’m');
  });

  it('returns null for a quoted span containing the only first-person word', () => {
    expect(findFirstPersonToken('Nova called Jules "my dear" once.')).toBeNull();
  });

  it('returns null when no first-person token is present', () => {
    expect(findFirstPersonToken('Nova lives in Melbourne.')).toBeNull();
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
