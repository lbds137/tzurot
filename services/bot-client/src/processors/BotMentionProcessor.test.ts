/**
 * Bot Mention Processor Tests
 *
 * Tests generic bot mention handling - sends help message when bot is mentioned directly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BotMentionProcessor } from './BotMentionProcessor.js';
import type { Message } from 'discord.js';

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

function createMockMessage(options?: {
  hasBotMention?: boolean;
  content?: string;
  isReply?: boolean;
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
});
