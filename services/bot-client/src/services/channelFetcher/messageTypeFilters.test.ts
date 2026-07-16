/**
 * Tests for messageTypeFilters
 *
 * Unit tests for message filtering functions used in extended context.
 */

import { describe, it, expect } from 'vitest';
import {
  isThinkingBlockMessage,
  isBotTranscriptReply,
  isContextExcludedBotMessage,
} from './messageTypeFilters.js';
import { OPT_OUT_FOOTER } from '../releaseDm/releaseDmContext.js';
import type { Message } from 'discord.js';

/**
 * Create a minimal mock message for testing
 */
function createMockMessage(overrides: {
  content?: string;
  authorId?: string;
  referenceMessageId?: string | null;
}): Message {
  return {
    content: overrides.content ?? '',
    author: { id: overrides.authorId ?? 'user-123' },
    reference:
      overrides.referenceMessageId !== null
        ? { messageId: overrides.referenceMessageId }
        : undefined,
  } as unknown as Message;
}

describe('messageTypeFilters', () => {
  describe('isThinkingBlockMessage', () => {
    it('should return true for thinking block messages', () => {
      const msg = createMockMessage({
        content: '💭 **Thinking:**\n||Some reasoning content||',
      });

      expect(isThinkingBlockMessage(msg)).toBe(true);
    });

    it('should return true for thinking block with just the header', () => {
      const msg = createMockMessage({
        content: '💭 **Thinking:**',
      });

      expect(isThinkingBlockMessage(msg)).toBe(true);
    });

    it('should return false for normal messages', () => {
      const msg = createMockMessage({
        content: 'Hello, this is a normal response.',
      });

      expect(isThinkingBlockMessage(msg)).toBe(false);
    });

    it('should return false for messages containing thinking emoji but not at start', () => {
      const msg = createMockMessage({
        content: 'I was 💭 **Thinking:** about something',
      });

      expect(isThinkingBlockMessage(msg)).toBe(false);
    });

    it('should return false for empty messages', () => {
      const msg = createMockMessage({
        content: '',
      });

      expect(isThinkingBlockMessage(msg)).toBe(false);
    });

    it('should return false for messages starting with different emoji', () => {
      const msg = createMockMessage({
        content: '🤔 **Thinking:**',
      });

      expect(isThinkingBlockMessage(msg)).toBe(false);
    });
  });

  describe('isBotTranscriptReply', () => {
    const botUserId = 'bot-123';

    it('should return true for bot reply with content', () => {
      const msg = createMockMessage({
        authorId: botUserId,
        content: 'Transcribed voice message text',
        referenceMessageId: 'original-voice-msg-123',
      });

      expect(isBotTranscriptReply(msg, botUserId)).toBe(true);
    });

    it('should return false if message is not from bot', () => {
      const msg = createMockMessage({
        authorId: 'other-user-456',
        content: 'Some text',
        referenceMessageId: 'msg-123',
      });

      expect(isBotTranscriptReply(msg, botUserId)).toBe(false);
    });

    it('should return false if message is not a reply', () => {
      const msg = createMockMessage({
        authorId: botUserId,
        content: 'Some text',
        referenceMessageId: null,
      });

      expect(isBotTranscriptReply(msg, botUserId)).toBe(false);
    });

    it('should return false if message has no content', () => {
      const msg = createMockMessage({
        authorId: botUserId,
        content: '',
        referenceMessageId: 'msg-123',
      });

      expect(isBotTranscriptReply(msg, botUserId)).toBe(false);
    });

    it('should return false for bot message without reply reference', () => {
      const msg = createMockMessage({
        authorId: botUserId,
        content: 'Just a bot message',
      });
      // Remove reference entirely
      (msg as unknown as Record<string, unknown>).reference = undefined;

      expect(isBotTranscriptReply(msg, botUserId)).toBe(false);
    });
  });

  describe('isContextExcludedBotMessage', () => {
    const botUserId = 'bot-123';

    it('excludes each of the three bot-message shapes', () => {
      const transcript = createMockMessage({
        authorId: botUserId,
        content: 'transcript text',
        referenceMessageId: 'voice-1',
      });
      const thinking = createMockMessage({ content: '💭 **Thinking:**\n||...||' });
      const releaseDm = createMockMessage({
        authorId: botUserId,
        content: `## v3.0 released${OPT_OUT_FOOTER}`,
      });
      (releaseDm as unknown as Record<string, unknown>).reference = undefined;

      expect(isContextExcludedBotMessage(transcript, botUserId)).toBe(true);
      expect(isContextExcludedBotMessage(thinking, botUserId)).toBe(true);
      expect(isContextExcludedBotMessage(releaseDm, botUserId)).toBe(true);
    });

    it('keeps ordinary bot replies and user messages', () => {
      const botReply = createMockMessage({ authorId: botUserId, content: 'a persona reply' });
      (botReply as unknown as Record<string, unknown>).reference = undefined;
      const userMsg = createMockMessage({
        authorId: 'user-9',
        content: `quoting ${OPT_OUT_FOOTER.trimStart()}`,
      });
      (userMsg as unknown as Record<string, unknown>).reference = undefined;

      expect(isContextExcludedBotMessage(botReply, botUserId)).toBe(false);
      expect(isContextExcludedBotMessage(userMsg, botUserId)).toBe(false);
    });
  });
});
