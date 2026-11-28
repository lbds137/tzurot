import { describe, expect, it } from 'vitest';
import {
  REROLL_MEMORY_LOCKED_MESSAGE,
  REROLL_MEMORY_UNSAFE_MESSAGE,
  REROLL_OTHER_LOCKED_MESSAGE,
  rerollPreflightMessage,
} from './rerollPreflight.js';

describe('rerollPreflightMessage', () => {
  it('lets a none or remove plan proceed', () => {
    expect(rerollPreflightMessage({ kind: 'none' })).toBeNull();
    expect(rerollPreflightMessage({ kind: 'remove', memoryIds: ['m'], pendingIds: [] })).toBeNull();
  });

  it('refuses a locked memory with exactly the unlock hint', () => {
    expect(rerollPreflightMessage({ kind: 'blocked', reason: 'locked' })).toBe(
      "This reply's memory is locked. Unlock it in /memory to reroll."
    );
    expect(REROLL_MEMORY_LOCKED_MESSAGE).toBe(
      "This reply's memory is locked. Unlock it in /memory to reroll."
    );
  });

  it("refuses when someone else's memory of the reply is locked", () => {
    expect(rerollPreflightMessage({ kind: 'blocked', reason: 'other-locked' })).toBe(
      REROLL_OTHER_LOCKED_MESSAGE
    );
  });

  it.each(['chunked', 'ambiguous', 'off-template', 'reply-off-template'] as const)(
    'refuses a %s memory with the generic message',
    reason => {
      expect(rerollPreflightMessage({ kind: 'blocked', reason })).toBe(
        REROLL_MEMORY_UNSAFE_MESSAGE
      );
    }
  );
});
