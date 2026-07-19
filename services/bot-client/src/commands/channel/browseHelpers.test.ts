/**
 * Tests for the channel browse pure helpers (row formatting, query
 * filtering, guild-page chunking for the all-servers view).
 */

import { describe, it, expect } from 'vitest';
import type { Client } from 'discord.js';
import type { ChannelSettings } from '@tzurot/common-types/schemas/api/channel';
import {
  buildGuildPages,
  createChannelComparator,
  filterByQuery,
  formatChannelSettings,
  sortChannelSettings,
} from './browseHelpers.js';

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

function makeClient(
  guildNames: Record<string, string>,
  channelNames: Record<string, string> = {}
): Client {
  return {
    guilds: {
      cache: {
        get: (id: string) => (guildNames[id] !== undefined ? { name: guildNames[id] } : undefined),
      },
    },
    channels: {
      cache: {
        get: (id: string) =>
          channelNames[id] !== undefined ? { name: channelNames[id] } : undefined,
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

describe('createChannelComparator', () => {
  it('sorts by cached channel name, falling back to the raw id', () => {
    const client = makeClient({}, { '111': 'zebra-chat', '222': 'alpha-chat' });
    const comparator = createChannelComparator(client)('name');
    const a = makeSettings({ channelId: '111' });
    const b = makeSettings({ channelId: '222' });

    expect(comparator(a, b)).toBeGreaterThan(0);
    // '333' has no cached channel → compares by its id string, and digits
    // sort before letters, so the fallback id leads 'alpha-chat'.
    expect(comparator(makeSettings({ channelId: '333' }), b)).toBeLessThan(0);
  });
});

describe('sortChannelSettings', () => {
  const client = makeClient(
    { 'g-1': 'Beta Guild', 'g-2': 'Alpha Guild' },
    { '111': 'bravo', '222': 'alpha' }
  );

  it('sorts a single-server list by the comparator only', () => {
    const rows = [makeSettings({ channelId: '111' }), makeSettings({ channelId: '222' })];
    const sorted = sortChannelSettings(rows, 'name', client);
    expect(sorted.map(r => r.channelId)).toEqual(['222', '111']);
  });

  it('groups by guild name first in all-servers mode', () => {
    const rows = [
      makeSettings({ channelId: '111', guildId: 'g-1' }),
      makeSettings({ channelId: '222', guildId: 'g-2' }),
    ];
    const sorted = sortChannelSettings(rows, 'name', client, true);
    // Alpha Guild's channel leads even though its channel name sorts after.
    expect(sorted.map(r => r.guildId)).toEqual(['g-2', 'g-1']);
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
