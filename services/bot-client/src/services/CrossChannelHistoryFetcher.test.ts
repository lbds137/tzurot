/**
 * Tests for the known-channel-environments builder.
 *
 * (The cross-channel-history fetch was removed — the worker re-derives it.
 * Only the Discord-cache environment-name builder remains here.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType, type Client } from 'discord.js';
import {
  buildKnownChannelEnvironments,
  clearKnownChannelEnvironmentsCache,
} from './CrossChannelHistoryFetcher.js';

// Mock common-types logger
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('buildKnownChannelEnvironments', () => {
  const makeClient = (channels: Map<string, unknown>): Client =>
    ({ channels: { cache: channels } }) as unknown as Client;

  const guildTextChannel = (id: string, name: string) => ({
    id,
    name,
    type: ChannelType.GuildText,
    guild: { id: 'guild-1', name: 'Test Guild' },
    isThread: () => false,
    parent: null,
  });

  beforeEach(() => {
    clearKnownChannelEnvironmentsCache();
  });

  it('builds an env entry per cached guild channel and skips non-guild channels', () => {
    const channels = new Map<string, unknown>([
      ['111', guildTextChannel('111', 'general')],
      ['222', guildTextChannel('222', 'random')],
      // DM channel: no guild — skipped
      ['333', { id: '333', type: ChannelType.DM, isThread: () => false }],
    ]);

    const map = buildKnownChannelEnvironments(makeClient(channels));

    expect(Object.keys(map).sort()).toEqual(['111', '222']);
    expect(map['111']).toMatchObject({
      type: 'guild',
      guild: { id: 'guild-1', name: 'Test Guild' },
      channel: { id: '111', name: 'general' },
    });
  });

  it('serves the cached map within the TTL window (one cache walk)', () => {
    const channels = new Map<string, unknown>([['111', guildTextChannel('111', 'general')]]);
    const client = makeClient(channels);

    const first = buildKnownChannelEnvironments(client);
    channels.set('999', guildTextChannel('999', 'late-arrival'));
    const second = buildKnownChannelEnvironments(client);

    // Same object back — the late-arriving channel is invisible until the
    // TTL expires (channel renames/additions are rare; this is by design).
    expect(second).toBe(first);
    expect(second['999']).toBeUndefined();
  });
});
