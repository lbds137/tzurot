/**
 * Tests for the channel browse pure helpers (row formatting, query
 * filtering, guild-page chunking for the all-servers view).
 */

import { describe, it, expect } from 'vitest';
import type { Client } from 'discord.js';
import type { ChannelSettings } from '@tzurot/common-types/schemas/api/channel';
import { buildGuildPages, filterByQuery, formatChannelSettings } from './browseHelpers.js';

function makeSettings(overrides: Partial<ChannelSettings>): ChannelSettings {
  return {
    channelId: '111',
    guildId: 'g-1',
    personalityId: 'p-1',
    personalityName: 'Lilith',
    personalitySlug: 'lilith',
    createdAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  } as ChannelSettings;
}

function makeClient(guildNames: Record<string, string>): Client {
  return {
    guilds: {
      cache: {
        get: (id: string) => (guildNames[id] !== undefined ? { name: guildNames[id] } : undefined),
      },
    },
  } as unknown as Client;
}

describe('formatChannelSettings', () => {
  it('renders mention, escaped name, slug, and activation date', () => {
    const line = formatChannelSettings(makeSettings({ personalityName: 'Li*lith' }));
    expect(line).toContain('<#111>');
    expect(line).toContain('Li\\*lith');
    expect(line).toContain('`lilith`');
    expect(line).toContain('Activated:');
  });
});

describe('filterByQuery', () => {
  it('matches personality name case-insensitively and passes null query through', () => {
    const rows = [
      makeSettings({ personalityName: 'Lilith' }),
      makeSettings({ channelId: '222', personalityName: 'Sapphomet', personalitySlug: 'sapph' }),
    ];
    expect(filterByQuery(rows, 'lil')).toHaveLength(1);
    expect(filterByQuery(rows, null)).toHaveLength(2);
  });
});

describe('buildGuildPages', () => {
  it('groups consecutive same-guild rows into pages with resolved names', () => {
    const rows = [
      makeSettings({ guildId: 'g-1' }),
      makeSettings({ channelId: '222', guildId: 'g-1' }),
      makeSettings({ channelId: '333', guildId: 'g-2' }),
    ];
    const pages = buildGuildPages(rows, makeClient({ 'g-1': 'Alpha', 'g-2': 'Beta' }));

    expect(pages).toHaveLength(2);
    expect(pages[0].guildName).toBe('Alpha');
    expect(pages[0].settings).toHaveLength(2);
    expect(pages[1].guildName).toBe('Beta');
  });

  it('labels unresolvable guilds and splits oversized guilds into continuations', () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      makeSettings({ channelId: `c-${index}`, guildId: 'g-x' })
    );
    const pages = buildGuildPages(many, makeClient({}));

    expect(pages[0].guildName).toContain('Unknown Server');
    // 10 channels at 8-per-page → a continuation page.
    expect(pages).toHaveLength(2);
    expect(pages[1].isContinuation).toBe(true);
  });
});
