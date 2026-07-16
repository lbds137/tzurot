import { describe, it, expect } from 'vitest';
import type { Message } from 'discord.js';
import { OPT_OUT_FOOTER, isReleaseNotesDm } from './releaseDmContext.js';

const BOT_ID = 'bot-123';

function asMessage(authorId: string, content: string): Message {
  return { author: { id: authorId }, content } as unknown as Message;
}

describe('releaseDmContext', () => {
  it('footer names every recipient affordance: opt out, tune level, clean up', () => {
    expect(OPT_OUT_FOOTER).toContain('/notifications disable');
    expect(OPT_OUT_FOOTER).toContain('/notifications level');
    expect(OPT_OUT_FOOTER).toContain('/notifications cleanup');
    // Discord subtext line — starts blank-line-separated, renders small.
    expect(OPT_OUT_FOOTER.startsWith('\n\n-# ')).toBe(true);
    // BROADCAST_MESSAGE_MAX_LENGTH (1800) + footer must clear Discord's
    // 2000-char cap with headroom; a footer past 200 chars breaks the budget.
    expect(OPT_OUT_FOOTER.length).toBeLessThan(200);
  });

  describe('isReleaseNotesDm', () => {
    it('matches a bot-authored message carrying the footer', () => {
      const msg = asMessage(BOT_ID, `## v3.0 released${OPT_OUT_FOOTER}`);
      expect(isReleaseNotesDm(msg, BOT_ID)).toBe(true);
    });

    it('never matches a user message, even one quoting the footer verbatim', () => {
      const msg = asMessage('user-456', `what does ${OPT_OUT_FOOTER.trimStart()} mean?`);
      expect(isReleaseNotesDm(msg, BOT_ID)).toBe(false);
    });

    it('never matches ordinary bot messages without the footer', () => {
      const msg = asMessage(BOT_ID, 'a persona reply or transcript');
      expect(isReleaseNotesDm(msg, BOT_ID)).toBe(false);
    });
  });
});
