import { describe, it, expect } from 'vitest';
import { StopSequencesResponseSchema } from './stopSequences.js';

describe('StopSequencesResponseSchema', () => {
  it('accepts the empty observability state (no activations yet)', () => {
    expect(
      StopSequencesResponseSchema.safeParse({
        totalActivations: 0,
        bySequence: {},
        byModel: {},
      }).success
    ).toBe(true);
  });

  it('accepts populated breakdowns', () => {
    expect(
      StopSequencesResponseSchema.safeParse({
        totalActivations: 42,
        bySequence: { '<|im_end|>': 30, STOP: 12 },
        byModel: { 'gpt-4o-mini': 25, 'claude-3-5-sonnet': 17 },
      }).success
    ).toBe(true);
  });

  it('rejects negative counts', () => {
    expect(
      StopSequencesResponseSchema.safeParse({
        totalActivations: -1,
        bySequence: {},
        byModel: {},
      }).success
    ).toBe(false);
  });

  it('rejects non-integer counts', () => {
    expect(
      StopSequencesResponseSchema.safeParse({
        totalActivations: 5,
        bySequence: { foo: 1.5 },
        byModel: {},
      }).success
    ).toBe(false);
  });
});
