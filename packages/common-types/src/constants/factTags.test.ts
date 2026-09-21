import { describe, it, expect } from 'vitest';
import { COMMITMENT_TAG_KINDS } from './factTags.js';

describe('COMMITMENT_TAG_KINDS', () => {
  it('pins the exact four commitment tag kinds, in order', () => {
    expect(COMMITMENT_TAG_KINDS).toEqual([
      'commitment:promise',
      'commitment:decision',
      'commitment:address',
      'commitment:advice',
    ]);
  });
});
