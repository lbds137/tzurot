import { describe, it, expect } from 'vitest';
import type { Message } from 'discord.js';
import { replyPingIsEnabled } from './replyPing.js';

const AUTHOR_ID = 'replied-author-1';

function buildMessage(mentions: Record<string, unknown>): Message {
  return { id: 'msg-1', mentions } as unknown as Message;
}

describe('replyPingIsEnabled', () => {
  it('is true when the replied-to author is in the mentions set', () => {
    expect(
      replyPingIsEnabled(
        buildMessage({
          repliedUser: { id: AUTHOR_ID },
          users: new Map([[AUTHOR_ID, { id: AUTHOR_ID }]]),
        })
      )
    ).toBe(true);
  });

  it('is false when the replied-to author is absent from the mentions set', () => {
    expect(
      replyPingIsEnabled(buildMessage({ repliedUser: { id: AUTHOR_ID }, users: new Map() }))
    ).toBe(false);
  });

  it('does not confuse a different mentioned user for the replied-to author', () => {
    // A ping-disabled reply that also @-mentions somebody else still has a
    // non-empty mentions set; only the replied author's membership counts.
    expect(
      replyPingIsEnabled(
        buildMessage({
          repliedUser: { id: AUTHOR_ID },
          users: new Map([['someone-else', { id: 'someone-else' }]]),
        })
      )
    ).toBe(false);
  });

  it('fails open when the referenced author is null', () => {
    // Deleted or uncached referenced message: the toggle state is unknowable,
    // and dropping a trigger we cannot classify is the worse error.
    expect(replyPingIsEnabled(buildMessage({ repliedUser: null, users: new Map() }))).toBe(true);
  });

  it('fails open when the referenced author is undefined', () => {
    expect(replyPingIsEnabled(buildMessage({ users: new Map() }))).toBe(true);
  });
});
