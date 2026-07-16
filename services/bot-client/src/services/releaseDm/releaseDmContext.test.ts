import { describe, it, expect } from 'vitest';
import type { Message } from 'discord.js';
import { OPT_OUT_FOOTER, isReleaseNotesDm } from './releaseDmContext.js';

const BOT_ID = 'bot-123';

function asMessage(authorId: string, content: string): Message {
  return { author: { id: authorId }, content } as unknown as Message;
}

describe('releaseDmContext', () => {
  it('footer names the explicit opt-out invocation', () => {
    expect(OPT_OUT_FOOTER).toContain('/notifications disable');
    // Discord subtext line — starts blank-line-separated, renders small.
    expect(OPT_OUT_FOOTER.startsWith('\n\n-# ')).toBe(true);
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
