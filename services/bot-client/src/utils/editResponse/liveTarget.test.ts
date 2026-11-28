import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType, type Client, type Message } from 'discord.js';

const mockGetWebhook = vi.fn();
vi.mock('../../services/serviceRegistry.js', () => ({
  getWebhookManager: () => ({ getWebhook: mockGetWebhook }),
}));

import { fetchLiveChunks, resolveTarget } from './liveTarget.js';

function clientWith(channel: unknown): Client {
  return { channels: { fetch: vi.fn().mockResolvedValue(channel) } } as unknown as Client;
}

function chunk(overrides: Record<string, unknown>): Message {
  return {
    webhookId: null,
    content: '',
    author: { username: 'Lilith', displayAvatarURL: () => 'https://cdn/a.png' },
    ...overrides,
  } as unknown as Message;
}

describe('fetchLiveChunks', () => {
  it('returns every chunk in stored order', async () => {
    const fetchMessage = vi.fn((id: string) => Promise.resolve({ id }));
    const channel = { isTextBased: () => true, messages: { fetch: fetchMessage } };

    const live = await fetchLiveChunks(clientWith(channel), 'c1', ['m1', 'm2']);

    expect(live?.chunks.map(c => c.id)).toEqual(['m1', 'm2']);
    expect(fetchMessage).toHaveBeenNthCalledWith(1, 'm1');
    expect(fetchMessage).toHaveBeenNthCalledWith(2, 'm2');
  });

  it('returns null when the channel is not text based', async () => {
    const live = await fetchLiveChunks(clientWith({ isTextBased: () => false }), 'c1', ['m1']);
    expect(live).toBeNull();
  });

  it('returns null when any chunk is gone', async () => {
    const channel = {
      isTextBased: () => true,
      messages: { fetch: vi.fn().mockRejectedValue(new Error('Unknown Message')) },
    };
    expect(await fetchLiveChunks(clientWith(channel), 'c1', ['m1'])).toBeNull();
  });
});

describe('resolveTarget', () => {
  beforeEach(() => {
    mockGetWebhook.mockReset();
  });

  it('resolves a DM target with the stored prefix', async () => {
    const channel = { send: vi.fn(), isDMBased: () => true };
    const resolved = await resolveTarget(channel, [chunk({ content: 'plain' })], 'p1', 'c1');
    expect(resolved?.target.kind).toBe('dm');
  });

  it('refuses a bot-authored non-webhook message in a guild', async () => {
    const channel = { send: vi.fn(), isDMBased: () => false, type: ChannelType.GuildText };
    expect(await resolveTarget(channel, [chunk({})], 'p1', 'c1')).toBeNull();
  });

  it('resolves a webhook target in a guild text channel', async () => {
    mockGetWebhook.mockResolvedValue({ id: 'wh1' });
    const channel = { type: ChannelType.GuildText, isThread: () => false, id: 'c1' };
    const resolved = await resolveTarget(channel, [chunk({ webhookId: 'wh1' })], 'p1', 'c1');
    expect(resolved?.target).toMatchObject({ kind: 'webhook', personalityId: 'p1' });
  });

  it('refuses chunks that belong to a different webhook', async () => {
    mockGetWebhook.mockResolvedValue({ id: 'wh1' });
    const channel = { type: ChannelType.GuildText, isThread: () => false, id: 'c1' };
    expect(await resolveTarget(channel, [chunk({ webhookId: 'other' })], 'p1', 'c1')).toBeNull();
  });

  it('refuses when the webhook cannot be resolved', async () => {
    mockGetWebhook.mockRejectedValue(new Error('no perms'));
    const channel = { type: ChannelType.GuildText, isThread: () => false, id: 'c1' };
    expect(await resolveTarget(channel, [chunk({ webhookId: 'wh1' })], 'p1', 'c1')).toBeNull();
  });
});
