/**
 * Bot Mention Processor Tests
 *
 * Tests generic bot mention handling - sends help message when bot is mentioned directly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import { BotMentionProcessor } from './BotMentionProcessor.js';
import type { Message } from 'discord.js';
import * as nsfwVerification from '../utils/nsfwVerification.js';

// Mock common-types
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    getConfig: () => ({
      BOT_MENTION_CHAR: '@',
    }),
  };
});

// Mock NSFW verification utilities
vi.mock('../utils/nsfwVerification.js', () => ({
  isNsfwChannel: vi.fn(),
  verifyNsfwUser: vi.fn(),
  sendVerificationConfirmation: vi.fn(),
}));

function createMockMessage(options?: {
  hasBotMention?: boolean;
  content?: string;
  isReply?: boolean;
  isNsfwChannel?: boolean;
}): Message {
  const botId = '987654321';
  return {
    id: '123456789',
    content: options?.content ?? '<@987654321> hello',
    author: {
      id: '111222333',
      username: 'testuser',
      bot: false,
    },
    channelId: 'channel-123',
    channel: {
      type: ChannelType.GuildText,
      nsfw: options?.isNsfwChannel ?? false,
    },
    reference: options?.isReply ? { messageId: 'ref-123' } : null,
    client: {
      user: {
        id: botId,
      },
    },
    mentions: {
      has: vi.fn().mockReturnValue(options?.hasBotMention ?? false),
    },
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Message;
}

describe('BotMentionProcessor', () => {
  let processor: BotMentionProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new BotMentionProcessor();
  });

  describe('Bot mention detection', () => {
    it('should return false when no bot mention', async () => {
      const message = createMockMessage({ hasBotMention: false });

      const result = await processor.process(message);

      expect(result).toBe(false);
      expect(message.reply).not.toHaveBeenCalled();
    });

    it('should send help message when bot is mentioned directly', async () => {
      const message = createMockMessage({ hasBotMention: true });

      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalledTimes(1);

      const replyArg = vi.mocked(message.reply).mock.calls[0][0] as { content: string };
      expect(replyArg.content).toContain('multiple AI personalities');
      expect(replyArg.content).toContain('@personality');
      expect(replyArg.content).toContain('/character list');
      expect(replyArg.content).toContain('/character chat');
    });

    it('should include mention character from config in help message', async () => {
      const message = createMockMessage({ hasBotMention: true });

      await processor.process(message);

      const replyArg = vi.mocked(message.reply).mock.calls[0][0] as { content: string };
      expect(replyArg.content).toContain('@personality your message');
    });
  });

  describe('Implicit reply mentions', () => {
    it('should ignore implicit reply mention when no explicit @bot in content', async () => {
      // User replies to bot message - Discord adds bot to mentions but content has no @bot
      const message = createMockMessage({
        hasBotMention: true,
        content: 'This is just a reply with no mention',
        isReply: true,
      });

      const result = await processor.process(message);

      expect(result).toBe(false); // Should not handle
      expect(message.reply).not.toHaveBeenCalled();
    });

    it('should show help when user explicitly @mentions bot in a reply', async () => {
      // User replies AND explicitly @mentions the bot
      const message = createMockMessage({
        hasBotMention: true,
        content: '<@987654321> how do I use this?',
        isReply: true,
      });

      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalledTimes(1);
    });

    it('should handle nickname mention format in replies', async () => {
      // Discord sometimes uses <@!id> format for nickname mentions
      const message = createMockMessage({
        hasBotMention: true,
        content: '<@!987654321> help',
        isReply: true,
      });

      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalledTimes(1);
    });

    it('should ignore non-reply messages without explicit mention in content', async () => {
      // Edge case: mentions.has returns true but no @mention in content (shouldn't happen normally)
      const message = createMockMessage({
        hasBotMention: true,
        content: 'Some message without mention',
        isReply: false,
      });

      const result = await processor.process(message);

      expect(result).toBe(false);
      expect(message.reply).not.toHaveBeenCalled();
    });
  });

  describe('NSFW auto-verification', () => {
    it('should auto-verify user when mentioned in NSFW channel', async () => {
      vi.mocked(nsfwVerification.isNsfwChannel).mockReturnValue(true);
      vi.mocked(nsfwVerification.verifyNsfwUser).mockResolvedValue({
        nsfwVerified: true,
        nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
        alreadyVerified: false,
      });

      const message = createMockMessage({ hasBotMention: true, isNsfwChannel: true });

      await processor.process(message);

      expect(nsfwVerification.isNsfwChannel).toHaveBeenCalledWith(message.channel);
      expect(nsfwVerification.verifyNsfwUser).toHaveBeenCalledWith('111222333');
    });

    it('should send confirmation on first-time verification', async () => {
      vi.mocked(nsfwVerification.isNsfwChannel).mockReturnValue(true);
      vi.mocked(nsfwVerification.verifyNsfwUser).mockResolvedValue({
        nsfwVerified: true,
        nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
        alreadyVerified: false,
      });

      const message = createMockMessage({ hasBotMention: true, isNsfwChannel: true });

      await processor.process(message);

      // Wait for the fire-and-forget promise to settle
      await vi.waitFor(() => {
        expect(nsfwVerification.sendVerificationConfirmation).toHaveBeenCalledWith(message.channel);
      });
    });

    it('should not send confirmation when already verified', async () => {
      vi.mocked(nsfwVerification.isNsfwChannel).mockReturnValue(true);
      vi.mocked(nsfwVerification.verifyNsfwUser).mockResolvedValue({
        nsfwVerified: true,
        nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
        alreadyVerified: true,
      });

      const message = createMockMessage({ hasBotMention: true, isNsfwChannel: true });

      await processor.process(message);

      // Wait a tick for promise to settle
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(nsfwVerification.sendVerificationConfirmation).not.toHaveBeenCalled();
    });

    it('should not auto-verify in non-NSFW channel', async () => {
      vi.mocked(nsfwVerification.isNsfwChannel).mockReturnValue(false);

      const message = createMockMessage({ hasBotMention: true, isNsfwChannel: false });

      await processor.process(message);

      expect(nsfwVerification.verifyNsfwUser).not.toHaveBeenCalled();
    });

    it('should handle verification failure gracefully', async () => {
      vi.mocked(nsfwVerification.isNsfwChannel).mockReturnValue(true);
      vi.mocked(nsfwVerification.verifyNsfwUser).mockRejectedValue(new Error('API error'));

      const message = createMockMessage({ hasBotMention: true, isNsfwChannel: true });

      // Should not throw, still sends help message
      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalled();
    });
  });
});
