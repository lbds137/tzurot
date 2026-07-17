/**
 * Tests for the shared owner-channel embed helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbedBuilder, type Client } from 'discord.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const configMock = vi.hoisted(() => ({
  value: { FEEDBACK_CHANNEL_ID: undefined as string | undefined },
}));
vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: () => configMock.value,
}));

import { postOwnerChannelEmbed } from './ownerChannel.js';

function makeClient(channel: unknown) {
  return {
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
  } as unknown as Client;
}

const embed = new EmbedBuilder().setTitle('test');

describe('postOwnerChannelEmbed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.value = { FEEDBACK_CHANNEL_ID: '123456789012345678' };
  });

  it('sends the embed with pings suppressed', async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = makeClient({ isTextBased: () => true, send });

    await postOwnerChannelEmbed(client, embed);

    expect(send).toHaveBeenCalledWith({ embeds: [embed], allowedMentions: { parse: [] } });
  });

  it('is a silent no-op when the channel id is unset', async () => {
    configMock.value = { FEEDBACK_CHANNEL_ID: undefined };
    const client = makeClient(null);

    await postOwnerChannelEmbed(client, embed);

    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('warns-and-returns on a non-sendable channel (no throw)', async () => {
    const client = makeClient({ isTextBased: () => false });

    await expect(postOwnerChannelEmbed(client, embed)).resolves.toBeUndefined();
  });

  it('swallows a send failure — the caller primary action already succeeded', async () => {
    const send = vi.fn().mockRejectedValue(new Error('missing access'));
    const client = makeClient({ isTextBased: () => true, send });

    await expect(postOwnerChannelEmbed(client, embed)).resolves.toBeUndefined();
  });
});
