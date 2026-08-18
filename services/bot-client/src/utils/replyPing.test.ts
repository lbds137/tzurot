import { describe, it, expect } from 'vitest';
import type { Message } from 'discord.js';
import { replyPingPermitsTrigger } from './replyPing.js';

const AUTHOR_ID = 'replied-author-1';
const GUILD_ID = 'guild-1';

/**
 * `guildId` is a REQUIRED argument rather than a defaulted field: the guild/DM
 * distinction now decides the answer outright, so a fixture that quietly
 * omitted it would send every case down the DM path and turn the suppression
 * assertions trivially true.
 */
function buildMessage(guildId: string | null, mentions: Record<string, unknown>): Message {
  return { id: 'msg-1', guildId, mentions } as unknown as Message;
}

describe('replyPingPermitsTrigger', () => {
  describe('in a guild — the toggle is the signal', () => {
    it('permits the trigger when the replied-to author is in the mentions set', () => {
      expect(
        replyPingPermitsTrigger(
          buildMessage(GUILD_ID, {
            repliedUser: { id: AUTHOR_ID },
            users: new Map([[AUTHOR_ID, { id: AUTHOR_ID }]]),
          })
        )
      ).toBe(true);
    });

    it('suppresses the trigger when the replied-to author is absent from the mentions set', () => {
      expect(
        replyPingPermitsTrigger(
          buildMessage(GUILD_ID, { repliedUser: { id: AUTHOR_ID }, users: new Map() })
        )
      ).toBe(false);
    });

    it('does not confuse a different mentioned user for the replied-to author', () => {
      // A ping-disabled reply that also @-mentions somebody else still has a
      // non-empty mentions set; only the replied author's membership counts.
      expect(
        replyPingPermitsTrigger(
          buildMessage(GUILD_ID, {
            repliedUser: { id: AUTHOR_ID },
            users: new Map([['someone-else', { id: 'someone-else' }]]),
          })
        )
      ).toBe(false);
    });

    it('fails open when the referenced author is null', () => {
      // Deleted or uncached referenced message: the toggle state is unknowable,
      // and dropping a trigger we cannot classify is the worse error.
      expect(
        replyPingPermitsTrigger(buildMessage(GUILD_ID, { repliedUser: null, users: new Map() }))
      ).toBe(true);
    });

    it('fails open when the referenced author is undefined', () => {
      expect(replyPingPermitsTrigger(buildMessage(GUILD_ID, { users: new Map() }))).toBe(true);
    });
  });

  describe('in a DM — the toggle is ignored entirely', () => {
    // The ping is not what delivers the notification in a DM, and there is no
    // room of other readers for "not you specifically" to distinguish against,
    // so a ping-off DM reply is still unambiguously addressed to the recipient.
    it('permits the trigger even with the replied-to author absent from mentions', () => {
      expect(
        replyPingPermitsTrigger(
          buildMessage(null, { repliedUser: { id: AUTHOR_ID }, users: new Map() })
        )
      ).toBe(true);
    });

    it('permits the trigger when the mentions set names only somebody else', () => {
      expect(
        replyPingPermitsTrigger(
          buildMessage(null, {
            repliedUser: { id: AUTHOR_ID },
            users: new Map([['someone-else', { id: 'someone-else' }]]),
          })
        )
      ).toBe(true);
    });

    it('permits the trigger when the ping is on, same as a guild', () => {
      expect(
        replyPingPermitsTrigger(
          buildMessage(null, {
            repliedUser: { id: AUTHOR_ID },
            users: new Map([[AUTHOR_ID, { id: AUTHOR_ID }]]),
          })
        )
      ).toBe(true);
    });

    it('never reads the mentions fields at all in a DM', () => {
      // The guild check runs BEFORE the membership test, so a DM message
      // missing `mentions` entirely must not throw. This is what makes the
      // "Discord may not list a DM bot author at all" risk unrepresentable
      // rather than merely untested.
      const dmWithoutMentions = { id: 'msg-1', guildId: null } as unknown as Message;

      expect(() => replyPingPermitsTrigger(dmWithoutMentions)).not.toThrow();
      expect(replyPingPermitsTrigger(dmWithoutMentions)).toBe(true);
    });
  });
});
