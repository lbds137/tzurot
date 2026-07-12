/**
 * Tests for chunked ephemeral reply utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendChunkedReply } from './chunkedReply.js';
import { MessageFlags } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';

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

vi.mock('@tzurot/common-types/utils/discord', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/discord')>(
    '@tzurot/common-types/utils/discord'
  );
  return {
    ...actual,
    splitMessage: vi.fn((content: string, maxLen: number) => {
      // Simple split for testing
      const chunks: string[] = [];
      for (let i = 0; i < content.length; i += maxLen) {
        chunks.push(content.slice(i, i + maxLen));
      }
      return chunks;
    }),
  };
});

function createMockInteraction() {
  return {
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as import('discord.js').ButtonInteraction;
}

describe('sendChunkedReply', () => {
  let interaction: ReturnType<typeof createMockInteraction>;

  beforeEach(() => {
    vi.clearAllMocks();
    interaction = createMockInteraction();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should send single message when content fits', async () => {
    await sendChunkedReply({
      interaction,
      content: 'Short content',
      header: '## Title\n\n',
      continuedHeader: '## Title (continued)\n\n',
    });

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '## Title\n\nShort content',
      embeds: [],
      components: [],
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it('should split into chunks when content exceeds limit', async () => {
    // Create content that's too long for a single message
    const headerLen = '## Title (continued)\n\n'.length;
    const maxContent = DISCORD_LIMITS.MESSAGE_LENGTH - headerLen;
    const longContent = 'x'.repeat(maxContent + 100);

    await sendChunkedReply({
      interaction,
      content: longContent,
      header: '## Title\n\n',
      continuedHeader: '## Title (continued)\n\n',
    });

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalled();

    // Verify follow-ups are ephemeral
    const followUpCall = vi.mocked(interaction.followUp).mock.calls[0][0] as {
      content: string;
      flags: unknown;
    };
    expect(followUpCall.flags).toBe(MessageFlags.Ephemeral);
  });

  it('should use header for first chunk and continuedHeader for rest', async () => {
    const headerLen = '## Title (continued)\n\n'.length;
    const maxContent = DISCORD_LIMITS.MESSAGE_LENGTH - headerLen;
    const longContent = 'x'.repeat(maxContent + 100);

    await sendChunkedReply({
      interaction,
      content: longContent,
      header: '## Title\n\n',
      continuedHeader: '## Title (continued)\n\n',
    });

    // First message should have header
    const editReplyArg = (vi.mocked(interaction.editReply).mock.calls[0][0] as { content: string })
      .content;
    expect(editReplyArg).toMatch(/^## Title\n\n/);

    // Follow-up should have continued header
    const followUpArg = vi.mocked(interaction.followUp).mock.calls[0][0] as {
      content: string;
    };
    expect(followUpArg.content).toMatch(/^## Title \(continued\)\n\n/);
  });

  it('sends every chunk as a follow-up when via is followUp (single chunk)', async () => {
    await sendChunkedReply({
      interaction,
      content: 'Short report',
      header: '',
      continuedHeader: '_(continued)_\n',
      via: 'followUp',
    });

    // editReply untouched — the caller's summary embed stays intact
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'Short report',
      components: [],
      flags: MessageFlags.Ephemeral,
    });
  });

  it('sends every chunk as a follow-up when via is followUp (multi chunk)', async () => {
    const continuedHeader = '_(continued)_\n';
    const maxContent = DISCORD_LIMITS.MESSAGE_LENGTH - continuedHeader.length;
    const longContent = 'x'.repeat(maxContent + 100);

    await sendChunkedReply({
      interaction,
      content: longContent,
      header: '',
      continuedHeader,
      via: 'followUp',
    });

    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledTimes(2);
    const second = vi.mocked(interaction.followUp).mock.calls[1][0] as { content: string };
    expect(second.content).toMatch(/^_\(continued\)_\n/);
  });

  it('does not throw when a later chunk fails after the first was delivered', async () => {
    // Delivery contract: a mid-stream failure must stay inside the utility —
    // callers' error handlers would clobber/mislabel already-shown content.
    const continuedHeader = '(cont)\n';
    const maxContent = DISCORD_LIMITS.MESSAGE_LENGTH - continuedHeader.length;
    const longContent = 'x'.repeat(maxContent * 2 + 100); // 3 chunks

    vi.mocked(interaction.followUp)
      .mockRejectedValueOnce(new Error('Discord API hiccup')) // chunk 2 fails
      .mockResolvedValue(undefined as never); // notice succeeds

    await expect(
      sendChunkedReply({ interaction, content: longContent, header: '', continuedHeader })
    ).resolves.toBeUndefined();

    // chunk 1 delivered, chunk 2 failed, then the part-way notice — chunk 3 never attempted
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledTimes(2);
    const notice = vi.mocked(interaction.followUp).mock.calls[1][0] as { content: string };
    expect(notice.content).toContain('failed to send');
  });

  it('does not throw when the part-way notice also fails', async () => {
    const continuedHeader = '(cont)\n';
    const maxContent = DISCORD_LIMITS.MESSAGE_LENGTH - continuedHeader.length;
    const longContent = 'x'.repeat(maxContent + 100);

    vi.mocked(interaction.followUp).mockRejectedValue(new Error('Discord API down'));

    await expect(
      sendChunkedReply({ interaction, content: longContent, header: '', continuedHeader })
    ).resolves.toBeUndefined();
  });

  it('still throws when the FIRST chunk fails (nothing was delivered)', async () => {
    // Callers rely on this: their catch means "nothing reached the user"
    vi.mocked(interaction.editReply).mockRejectedValue(new Error('ack lost'));

    await expect(
      sendChunkedReply({ interaction, content: 'short', header: '', continuedHeader: 'c\n' })
    ).rejects.toThrow('ack lost');
  });

  it('still throws when the first chunk fails in followUp mode', async () => {
    vi.mocked(interaction.followUp).mockRejectedValue(new Error('Discord API down'));

    await expect(
      sendChunkedReply({
        interaction,
        content: 'short report',
        header: '',
        continuedHeader: 'c\n',
        via: 'followUp',
      })
    ).rejects.toThrow('Discord API down');
  });

  it('should use longer header for calculating max content length', async () => {
    // short header, long continuedHeader
    const header = 'H\n';
    const continuedHeader = 'This is a much longer continued header\n';
    const maxContent = DISCORD_LIMITS.MESSAGE_LENGTH - continuedHeader.length;

    // Content exactly at limit should not chunk
    const fittingContent = 'x'.repeat(maxContent);
    await sendChunkedReply({
      interaction,
      content: fittingContent,
      header,
      continuedHeader,
    });

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: `${header}${fittingContent}`,
      embeds: [],
      components: [],
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
});
