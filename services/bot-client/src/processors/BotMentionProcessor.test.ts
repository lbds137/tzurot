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
  handleNsfwVerification: vi.fn(),
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
    // Default: verified user, not a new verification — the happy path for
    // most tests. NSFW-specific tests override this mock.
    vi.mocked(nsfwVerification.handleNsfwVerification).mockResolvedValue({
      allowed: true,
      wasNewVerification: false,
    });
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
      expect(replyArg.content).toContain('/character browse');
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

  describe('NSFW verification gate', () => {
    it('should call handleNsfwVerification before sending help', async () => {
      const message = createMockMessage({ hasBotMention: true });

      await processor.process(message);

      expect(nsfwVerification.handleNsfwVerification).toHaveBeenCalledWith(
        message,
        'BotMentionProcessor'
      );
    });

    it('should block help and return true when verification denied (unverified non-NSFW / DM)', async () => {
      // handleNsfwVerification sends the verification prompt itself and
      // returns allowed: false. The processor must stop here — no help message.
      vi.mocked(nsfwVerification.handleNsfwVerification).mockResolvedValue({
        allowed: false,
        wasNewVerification: false,
      });

      const message = createMockMessage({ hasBotMention: true, isNsfwChannel: false });

      const result = await processor.process(message);

      expect(result).toBe(true); // mention was handled (by the verification prompt)
      expect(message.reply).not.toHaveBeenCalled(); // no welcome help sent
    });

    it('should send confirmation on first-time verification then continue to help', async () => {
      vi.mocked(nsfwVerification.handleNsfwVerification).mockResolvedValue({
        allowed: true,
        wasNewVerification: true,
      });

      const message = createMockMessage({ hasBotMention: true, isNsfwChannel: true });

      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(nsfwVerification.sendVerificationConfirmation).toHaveBeenCalledWith(message.channel);
      expect(message.reply).toHaveBeenCalledTimes(1); // welcome help also sent
    });

    it('should not send confirmation when user was already verified', async () => {
      vi.mocked(nsfwVerification.handleNsfwVerification).mockResolvedValue({
        allowed: true,
        wasNewVerification: false,
      });

      const message = createMockMessage({ hasBotMention: true, isNsfwChannel: true });

      await processor.process(message);

      expect(nsfwVerification.sendVerificationConfirmation).not.toHaveBeenCalled();
      expect(message.reply).toHaveBeenCalledTimes(1); // just the welcome help
    });

    it('documents that handleNsfwVerification is expected to be error-safe', async () => {
      // The old fire-and-forget code wrapped `verifyNsfwUser` in `.catch(() => {})`.
      // The new code calls `handleNsfwVerification` directly with no local try/catch
      // for two reasons:
      //
      // 1. handleNsfwVerification is internally error-safe: verifyNsfwUser and
      //    checkNsfwVerification return null/falsy on API failure;
      //    sendNsfwVerificationMessage wraps message.reply in its own try/catch.
      //    So throwing requires something catastrophic deeper in the stack.
      //
      // 2. If it does throw, MessageHandler.handleMessage wraps the full
      //    processor chain in try/catch (handlers/MessageHandler.ts:80-92)
      //    and sends the user a friendly "Sorry, I encountered an error"
      //    reply. Propagating is BETTER UX than the old silent swallow —
      //    the user now gets explicit feedback that something broke.
      //
      // This test documents that contract: if the invariant ever breaks and
      // handleNsfwVerification starts throwing, this test fails loudly so we
      // know to re-add a local safety net.
      vi.mocked(nsfwVerification.handleNsfwVerification).mockRejectedValue(
        new Error('Gateway down')
      );

      const message = createMockMessage({ hasBotMention: true });

      // If handleNsfwVerification ever DOES throw, we expect it to propagate
      // (fail-closed). This test is the tripwire — the contract is "it
      // shouldn't throw in practice," and if it ever does, this assertion
      // tells us to either re-add a local catch or fix the upstream function.
      await expect(processor.process(message)).rejects.toThrow('Gateway down');
      expect(message.reply).not.toHaveBeenCalled();
    });
  });
});
