import { describe, it, expect } from 'vitest';
import { StopSequencesResponseSchema } from './stopSequences.js';

const STARTED_AT = '2026-01-01T00:00:00.000Z';

describe('StopSequencesResponseSchema', () => {
  it('accepts the empty observability state (no activations yet)', () => {
    expect(
      StopSequencesResponseSchema.safeParse({
        totalActivations: 0,
        bySequence: {},
        byModel: {},
        startedAt: STARTED_AT,
      }).success
    ).toBe(true);
  });

  it('accepts populated breakdowns', () => {
    expect(
      StopSequencesResponseSchema.safeParse({
        totalActivations: 42,
        bySequence: { '<|im_end|>': 30, STOP: 12 },
        byModel: { 'gpt-4o-mini': 25, 'claude-3-5-sonnet': 17 },
        startedAt: STARTED_AT,
      }).success
    ).toBe(true);
  });

  it('rejects negative counts', () => {
    expect(
      StopSequencesResponseSchema.safeParse({
        totalActivations: -1,
        bySequence: {},
        byModel: {},
        startedAt: STARTED_AT,
      }).success
    ).toBe(false);
  });

  it('rejects non-integer counts', () => {
    expect(
      StopSequencesResponseSchema.safeParse({
        totalActivations: 5,
        bySequence: { foo: 1.5 },
        byModel: {},
        startedAt: STARTED_AT,
      }).success
    ).toBe(false);
  });

  it('rejects missing startedAt (handler always supplies it via fallback)', () => {
    expect(
      StopSequencesResponseSchema.safeParse({
        totalActivations: 0,
        bySequence: {},
        byModel: {},
      }).success
    ).toBe(false);
  });
});
