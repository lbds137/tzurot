import { describe, it, expect, vi } from 'vitest';
import type { APIButtonComponentWithCustomId } from 'discord.js';
import { buildDetailEmbed, buildDetailButtons, ENTITY_TYPE, VALID_SCOPES } from './detailTypes.js';

vi.mock('@tzurot/common-types', () => ({
  DISCORD_COLORS: { ERROR: 0xff0000, WARNING: 0xffaa00 },
  formatDateShort: vi.fn((date: string | Date) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }),
}));

const sampleEntry = {
  id: 'entry-uuid-1234',
  type: 'USER',
  discordId: '111222333444555666',
  scope: 'BOT',
  scopeId: '*',
  mode: 'BLOCK',
  reason: 'Spamming',
  addedAt: '2026-01-15T00:00:00.000Z',
  addedBy: 'owner-1',
};

describe('constants', () => {
  it('should export entity type', () => {
    expect(ENTITY_TYPE).toBe('deny');
  });

  it('should export valid scopes', () => {
    expect(VALID_SCOPES).toEqual(['BOT', 'GUILD', 'CHANNEL', 'PERSONALITY']);
  });
});

describe('buildDetailEmbed', () => {
  it('should build embed for USER BLOCK entry', () => {
    const embed = buildDetailEmbed(sampleEntry);

    expect(embed.data.title).toContain('Denylist Entry');
    expect(embed.data.color).toBe(0xff0000);
    expect(embed.data.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Target',
          value: expect.stringContaining('<@111222333444555666>'),
        }),
        expect.objectContaining({ name: 'Type', value: 'USER' }),
        expect.objectContaining({ name: 'Mode', value: expect.stringContaining('BLOCK') }),
        expect.objectContaining({ name: 'Scope', value: 'Bot-wide' }),
        expect.objectContaining({ name: 'Reason', value: 'Spamming' }),
      ])
    );
    expect(embed.data.footer?.text).toContain('entry-uuid-1234');
  });

  it('should build embed for GUILD MUTE entry', () => {
    const entry = { ...sampleEntry, type: 'GUILD', mode: 'MUTE', reason: null };
    const embed = buildDetailEmbed(entry);

    expect(embed.data.color).toBe(0xffaa00);
    expect(embed.data.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Target', value: expect.stringContaining('(Guild)') }),
        expect.objectContaining({ name: 'Mode', value: expect.stringContaining('MUTE') }),
      ])
    );
    // Should NOT have Reason field when null
    expect(embed.data.fields).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Reason' })])
    );
  });

  it('should show scope detail for non-BOT scopes', () => {
    const entry = { ...sampleEntry, scope: 'CHANNEL', scopeId: '123456789' };
    const embed = buildDetailEmbed(entry);

    expect(embed.data.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Scope', value: 'CHANNEL: `123456789`' }),
      ])
    );
  });
});

describe('buildDetailButtons', () => {
  it('should build buttons for BLOCK mode (browse-sourced)', () => {
    const rows = buildDetailButtons('entry-123', 'BLOCK', true);

    expect(rows).toHaveLength(2);
    // First row: Edit (Primary) + Mode Toggle
    const row1 = rows[0].toJSON().components as APIButtonComponentWithCustomId[];
    expect(row1[0].label).toBe('Edit');
    expect(row1[1].label).toBe('Switch to Mute');

    // Second row: Back + Delete (Danger always last)
    const row2 = rows[1].toJSON().components as APIButtonComponentWithCustomId[];
    expect(row2[0].label).toBe('Back to Browse');
    expect(row2[1].label).toBe('Delete');
  });

  it('should build buttons for MUTE mode', () => {
    const rows = buildDetailButtons('entry-123', 'MUTE', true);

    const row1 = rows[0].toJSON().components as APIButtonComponentWithCustomId[];
    expect(row1[1].label).toBe('Switch to Block');
  });

  it('should include entry ID in custom IDs', () => {
    const rows = buildDetailButtons('entry-123', 'BLOCK', true);

    const row1 = rows[0].toJSON().components as APIButtonComponentWithCustomId[];
    expect(row1[0].custom_id).toBe('deny::edit::entry-123');
    expect(row1[1].custom_id).toBe('deny::mode::entry-123');

    const row2 = rows[1].toJSON().components as APIButtonComponentWithCustomId[];
    expect(row2[0].custom_id).toBe('deny::back::entry-123');
    expect(row2[1].custom_id).toBe('deny::del::entry-123');
  });

  it('omits Back-to-Browse when the detail view was not opened from /deny browse', () => {
    // The /deny view entry point sets browseContext=null on the session —
    // clicking a Back-to-Browse button in that case would route to
    // handleSharedBackButton, which correctly refuses (no browseContext)
    // and shows "session expired". Avoid the dead-end by omitting the
    // button entirely when there's no list to return to.
    const rows = buildDetailButtons('entry-123', 'BLOCK', false);

    expect(rows).toHaveLength(2);
    const row2 = rows[1].toJSON().components as APIButtonComponentWithCustomId[];
    expect(row2).toHaveLength(1);
    expect(row2[0].label).toBe('Delete');
    expect(row2[0].custom_id).toBe('deny::del::entry-123');
  });
});
