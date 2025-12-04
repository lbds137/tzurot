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

function createMockMessage(options?: { hasBotMention?: boolean }): Message {
  const botId = '987654321';
  return {
    id: '123456789',
    content: '<@987654321> hello',
    author: {
      id: '111222333',
      username: 'testuser',
      bot: false,
    },
    channelId: 'channel-123',
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
    });

    it('should include mention character from config in help message', async () => {
      const message = createMockMessage({ hasBotMention: true });

      await processor.process(message);

      const replyArg = vi.mocked(message.reply).mock.calls[0][0] as { content: string };
      expect(replyArg.content).toContain('@personality your message');
    });
  });
});
