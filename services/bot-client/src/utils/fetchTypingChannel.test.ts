import { describe, it, expect, vi } from 'vitest';
import type { Client } from 'discord.js';
import { fetchTypingChannel } from './fetchTypingChannel.js';

function makeClient(fetchImpl: () => Promise<unknown>): Client {
  return { channels: { fetch: vi.fn(fetchImpl) } } as unknown as Client;
}

// A GuildText-shaped channel passes isTypingChannel (type 0 + text-based).
const typingChannel = {
  id: 'chan-1',
  type: 0,
  isTextBased: () => true,
  isThread: () => false,
};

describe('fetchTypingChannel', () => {
  it('returns the channel when it is a typing channel', async () => {
    const client = makeClient(async () => typingChannel);
    const result = await fetchTypingChannel(client, 'chan-1');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('chan-1');
  });

  it('returns null when the channel is not found', async () => {
    const client = makeClient(async () => null);
    expect(await fetchTypingChannel(client, 'missing')).toBeNull();
  });

  it('returns null for a non-typing channel (e.g. category)', async () => {
    // type 4 = GuildCategory — not text-based, fails isTypingChannel
    const category = { id: 'cat-1', type: 4, isTextBased: () => false };
    const client = makeClient(async () => category);
    expect(await fetchTypingChannel(client, 'cat-1')).toBeNull();
  });

  it('returns null (fails soft) when the fetch throws', async () => {
    const client = makeClient(async () => {
      throw new Error('Unknown Channel');
    });
    expect(await fetchTypingChannel(client, 'boom')).toBeNull();
  });
});
