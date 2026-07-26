import { describe, it, expect } from 'vitest';
import type { Message } from 'discord.js';
import {
  buildRetentionNotice,
  isRetentionNoticeDm,
  RETENTION_NOTICE_FOOTER,
} from './noticeContent.js';

const SENT_AT = new Date('2026-08-01T12:00:00.000Z');
const BOT_ID = '999999999999999999';

function makeMessage(authorId: string, content: string): Message {
  return { author: { id: authorId }, content } as Message;
}

describe('buildRetentionNotice', () => {
  it('stays inside the Discord budget with the footer attached', () => {
    const full = buildRetentionNotice(SENT_AT) + RETENTION_NOTICE_FOOTER;

    // Same 1800-char discipline as the release DM: comfortable headroom
    // under Discord's 2000 cap.
    expect(full.length).toBeLessThanOrEqual(1800);
  });

  it('renders the concrete deletion deadline as a localized Discord timestamp', () => {
    const notice = buildRetentionNotice(SENT_AT);

    // SENT_AT plus the 30-day grace window, as a unix epoch.
    expect(notice).toContain('<t:1788177600:D>');
    expect(notice).toContain('30 days from this notice');
  });

  it('offers the three affordances and never an expiring export link', () => {
    const notice = buildRetentionNotice(SENT_AT);

    expect(notice).toContain('use the bot once');
    expect(notice).toContain('/settings data export');
    expect(notice).toContain('/settings data delete');
    expect(notice).not.toContain('/exports/');
    expect(notice).toContain('180 days');
  });

  it('explains the shared-character re-home rather than promising total deletion', () => {
    // The policy's one exception must be IN the notice — a user who reads
    // "everything is erased" and later finds their shared character alive
    // was misinformed by us.
    expect(buildRetentionNotice(SENT_AT)).toContain('holding account');
  });
});

describe('isRetentionNoticeDm', () => {
  it('matches a bot-authored message carrying the footer', () => {
    const msg = makeMessage(BOT_ID, `warning body${RETENTION_NOTICE_FOOTER}`);

    expect(isRetentionNoticeDm(msg, BOT_ID)).toBe(true);
  });

  it('never matches a USER quoting the footer text (author check first)', () => {
    const msg = makeMessage('111111111111111111', `look at this${RETENTION_NOTICE_FOOTER}`);

    expect(isRetentionNoticeDm(msg, BOT_ID)).toBe(false);
  });

  it('ignores ordinary bot messages', () => {
    expect(isRetentionNoticeDm(makeMessage(BOT_ID, 'hello there'), BOT_ID)).toBe(false);
  });
});
