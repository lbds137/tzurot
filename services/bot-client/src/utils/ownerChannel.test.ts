/**
 * Tests for the shared owner-channel embed helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttachmentBuilder, EmbedBuilder, type Client } from 'discord.js';

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

  it('sends the embed with pings suppressed and reports delivery', async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = makeClient({ isTextBased: () => true, send });

    await expect(postOwnerChannelEmbed(client, embed)).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith({ embeds: [embed], allowedMentions: { parse: [] } });
  });

  it('forwards attachments to channel.send when files are passed', async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = makeClient({ isTextBased: () => true, send });
    const file = new AttachmentBuilder(Buffer.from('report body', 'utf-8'), {
      name: 'report.md',
    });

    await expect(postOwnerChannelEmbed(client, embed, [file])).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith({
      embeds: [embed],
      allowedMentions: { parse: [] },
      files: [file],
    });
  });

  it('omits the files key entirely when no attachments are passed', async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = makeClient({ isTextBased: () => true, send });

    await postOwnerChannelEmbed(client, embed);

    // Not just `files: undefined` — the key must be absent, so the six
    // embed-only call sites keep sending a byte-identical payload.
    const payload = send.mock.calls[0][0] as Record<string, unknown>;
    expect('files' in payload).toBe(false);
  });

  it('is a silent no-op (not delivered) when the channel id is unset', async () => {
    configMock.value = { FEEDBACK_CHANNEL_ID: undefined };
    const client = makeClient(null);

    await expect(postOwnerChannelEmbed(client, embed)).resolves.toBe(false);

    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('warns and reports non-delivery on a non-sendable channel (no throw)', async () => {
    const client = makeClient({ isTextBased: () => false });

    await expect(postOwnerChannelEmbed(client, embed)).resolves.toBe(false);
  });

  it('swallows a send failure and reports non-delivery — the caller primary action already succeeded', async () => {
    const send = vi.fn().mockRejectedValue(new Error('missing access'));
    const client = makeClient({ isTextBased: () => true, send });

    await expect(postOwnerChannelEmbed(client, embed)).resolves.toBe(false);
  });
});
