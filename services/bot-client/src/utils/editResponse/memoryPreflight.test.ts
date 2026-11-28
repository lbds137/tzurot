import { describe, expect, it } from 'vitest';
import {
  MEMORY_LOCKED_MESSAGE,
  MEMORY_UNSAFE_MESSAGE,
  REPLY_BREAKS_MEMORY_MESSAGE,
  memoryPreflightMessage,
} from './memoryPreflight.js';

describe('memoryPreflightMessage', () => {
  it('refuses a locked memory with the unlock hint', () => {
    expect(memoryPreflightMessage({ kind: 'blocked', reason: 'locked' })).toBe(
      MEMORY_LOCKED_MESSAGE
    );
  });

  it.each(['chunked', 'ambiguous', 'off-template'] as const)(
    'refuses a %s memory with the generic message',
    reason => {
      expect(memoryPreflightMessage({ kind: 'blocked', reason })).toBe(MEMORY_UNSAFE_MESSAGE);
    }
  );

  it('refuses a reply that cannot be stored with the separator hint', () => {
    expect(memoryPreflightMessage({ kind: 'blocked', reason: 'reply-off-template' })).toBe(
      REPLY_BREAKS_MEMORY_MESSAGE
    );
    expect(REPLY_BREAKS_MEMORY_MESSAGE).toBe(
      'That edit can\'t be saved to the character\'s memory as written. Remove any "{assistant}:" or trailing "[Referenced content: …]" text and try again.'
    );
  });

  it.each([{ kind: 'none' }, { kind: 'sync' }] as const)('allows a %o plan', memorySync => {
    expect(memoryPreflightMessage(memorySync)).toBeNull();
  });
});
