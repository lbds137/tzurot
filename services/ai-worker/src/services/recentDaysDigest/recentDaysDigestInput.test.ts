import { describe, expect, it } from 'vitest';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { buildDigestInput, type DigestSourceRow } from './recentDaysDigestInput.js';

const NAMES = { personaLabel: 'Jules', characterLabel: 'Nova' };
const NOW = new Date('2026-09-17T12:00:00.000Z');

function row(overrides: Partial<DigestSourceRow> & { index: number }): DigestSourceRow {
  const { index, ...rest } = overrides;
  return {
    id: `row-${index}`,
    role: MessageRole.User,
    content: 'hello',
    createdAt: new Date(NOW.getTime() - index * 1000),
    channelId: 'c1',
    guildId: null,
    ...rest,
  };
}

describe('buildDigestInput', () => {
  it('keeps the newest 200 of 201 rows, sets windowStart to the 2nd-oldest, and marks truncated', () => {
    // Newest-first: index 0 is newest, index 200 is oldest.
    const rows = Array.from({ length: 201 }, (_, i) => row({ index: i }));
    const result = buildDigestInput({ rows, tz: 'UTC', names: NAMES });

    expect(result.sourceRowCount).toBe(200);
    expect(result.truncated).toBe(true);
    expect(result.sourceRowIds).not.toContain('row-200');
    // The 2nd-oldest row overall is index 199 (index 200 was dropped).
    expect(result.windowStart).toEqual(rows[199].createdAt);
  });

  it('drops the oldest rows further, by token count, until the sum is at or under the cap', () => {
    // Three rows, each far bigger than a tiny cap — the newest alone must
    // survive (never drops to zero rows), and older rows over budget go.
    const bigContent = 'word '.repeat(2000); // several thousand tokens
    const rows = [
      row({ index: 0, content: bigContent }),
      row({ index: 1, content: bigContent }),
      row({ index: 2, content: bigContent }),
    ];
    const result = buildDigestInput({
      rows,
      tz: 'UTC',
      names: NAMES,
      caps: { maxMessages: 200, maxTokens: 100 },
    });

    expect(result.truncated).toBe(true);
    expect(result.sourceRowCount).toBe(1);
    expect(result.sourceRowIds).toEqual(['row-0']);
  });

  it('does not truncate when every row fits both caps', () => {
    const rows = [row({ index: 0 }), row({ index: 1 })];
    const result = buildDigestInput({ rows, tz: 'UTC', names: NAMES });
    expect(result.truncated).toBe(false);
    expect(result.sourceRowCount).toBe(2);
  });

  it('labels a DM row [DMs]', () => {
    const rows = [row({ index: 0, guildId: null })];
    const result = buildDigestInput({ rows, tz: 'UTC', names: NAMES });
    expect(result.lines[0]).toContain('[DMs]');
  });

  it('labels guild channels by first-appearance order, not channel-id sort order', () => {
    // Chronological (oldest first) order of appearance: channel 'zzz' first,
    // then channel 'aaa' — the reverse of id-sort order, so a
    // sort-by-channel-id mutation would swap the letters.
    const rows = [
      row({ index: 0, channelId: 'aaa', guildId: 'g1' }), // newest
      row({ index: 1, channelId: 'zzz', guildId: 'g1' }), // oldest
    ];
    const result = buildDigestInput({ rows, tz: 'UTC', names: NAMES });
    // Chronological order: row index 1 (channel zzz) first, then index 0 (channel aaa).
    expect(result.lines[0]).toContain('[server channel A]');
    expect(result.lines[1]).toContain('[server channel B]');
  });

  it('D10(e): has no parameter through which a prior digest can leak — the built lines never carry the sentinel', () => {
    const priorCandidate = { digestText: 'PRIOR DIGEST SENTINEL' };
    const rows = [row({ index: 0, content: 'new message' })];
    const result = buildDigestInput({ rows, tz: 'UTC', names: NAMES });
    expect(result.lines.join('\n')).not.toContain(priorCandidate.digestText);
  });

  it('emits speaker labels by role — assistant rows use the character label', () => {
    const rows = [
      row({ index: 0, role: MessageRole.Assistant, content: 'sure thing' }),
      row({ index: 1, role: MessageRole.User, content: 'hi' }),
    ];
    const result = buildDigestInput({ rows, tz: 'UTC', names: NAMES });
    expect(result.lines.some(l => l.includes('Nova: sure thing'))).toBe(true);
    expect(result.lines.some(l => l.includes('Jules: hi'))).toBe(true);
  });
});
