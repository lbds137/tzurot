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

  it('refuses a reply that breaks the template when a memory would be rewritten', () => {
    expect(memoryPreflightMessage({ kind: 'sync' }, 'a\n{assistant}: b')).toBe(
      REPLY_BREAKS_MEMORY_MESSAGE
    );
  });

  it('names the separator as users see it', () => {
    expect(REPLY_BREAKS_MEMORY_MESSAGE).toContain('Remove "{assistant}:"');
  });

  it('allows a template-breaking reply when there is no memory to sync', () => {
    expect(memoryPreflightMessage({ kind: 'none' }, 'a\n{assistant}: b')).toBeNull();
  });

  it('allows an ordinary reply and a modal-open check without text', () => {
    expect(memoryPreflightMessage({ kind: 'sync' }, 'fine')).toBeNull();
    expect(memoryPreflightMessage({ kind: 'sync' })).toBeNull();
  });
});
