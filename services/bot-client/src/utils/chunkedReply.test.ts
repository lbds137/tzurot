/**
 * Tests for chunked ephemeral reply utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendChunkedReply } from './chunkedReply.js';
import { MessageFlags } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types';

vi.mock('@tzurot/common-types', async () => {
  const actual =
    await vi.importActual<typeof import('@tzurot/common-types')>('@tzurot/common-types');
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

    expect(interaction.editReply).toHaveBeenCalledWith('## Title\n\nShort content');
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
    const editReplyArg = vi.mocked(interaction.editReply).mock.calls[0][0] as string;
    expect(editReplyArg).toMatch(/^## Title\n\n/);

    // Follow-up should have continued header
    const followUpArg = vi.mocked(interaction.followUp).mock.calls[0][0] as {
      content: string;
    };
    expect(followUpArg.content).toMatch(/^## Title \(continued\)\n\n/);
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

    expect(interaction.editReply).toHaveBeenCalledWith(`${header}${fittingContent}`);
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
});
