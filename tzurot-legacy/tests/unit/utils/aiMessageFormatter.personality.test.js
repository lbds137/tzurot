/**
 * Tests for personality display name handling in aiMessageFormatter
 */

jest.mock('../../../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../../src/utils/aliasResolver', () => ({
  resolvePersonality: jest.fn(),
}));

jest.mock('../../../src/utils/contextMetadataFormatter', () => ({
  formatContextMetadata: jest.fn(() => '[Test Server | #test-channel | 2025-01-01T00:00:00.000Z]'),
}));

const { formatApiMessages } = require('../../../src/utils/aiMessageFormatter');
const { resolvePersonality } = require('../../../src/utils/aliasResolver');
const logger = require('../../../src/logger');

describe('aiMessageFormatter - Personality Display Names', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Bot message references with personality names', () => {
    it('should use DDD personality display name when available', async () => {
      resolvePersonality.mockResolvedValue({
        profile: { displayName: 'Friendly Assistant' },
      });

      const content = {
        messageContent: 'What did you say?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Hello there!',
          author: 'bot-user',
          isFromBot: true,
          personalityName: 'assistant-bot',
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      
      const textContent = result[0].content[0].text;
      expect(textContent).toContain('Friendly Assistant (assistant-bot) said');
      expect(textContent).toContain('"Hello there!"');
    });

    it('should fall back to provided display name if DDD personality not found', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'What did you say?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Hello there!',
          author: 'bot-user',
          isFromBot: true,
          personalityName: 'unknown-bot',
          personalityDisplayName: 'Legacy Display Name',
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textContent = result[0].content[0].text;
      expect(textContent).toContain('Legacy Display Name (unknown-bot) said');
    });

    it('should handle personality name only (no display name)', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'What did you say?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Hello there!',
          author: 'bot-user',
          isFromBot: true,
          personalityName: 'simple-bot',
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textContent = result[0].content[0].text;
      expect(textContent).toContain('simple-bot said');
    });

    it('should not show parentheses when display name equals personality name', async () => {
      resolvePersonality.mockResolvedValue({
        profile: { displayName: 'matching-name' },
      });

      const content = {
        messageContent: 'What did you say?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Hello there!',
          author: 'bot-user',
          isFromBot: true,
          personalityName: 'matching-name',
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textContent = result[0].content[0].text;
      expect(textContent).toContain('matching-name said');
      expect(textContent).not.toContain('matching-name (matching-name)');
    });

    it('should use second person when referencing same personality', async () => {
      resolvePersonality.mockResolvedValue({
        profile: { displayName: 'Current Bot' },
      });

      const content = {
        messageContent: 'Can you repeat that?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'I said something important',
          author: 'bot-user',
          isFromBot: true,
          personalityName: 'test-personality', // Same as current
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textContent = result[0].content[0].text;
      expect(textContent).toContain('You said: "I said something important"');
      expect(textContent).not.toContain('Current Bot');
    });

    it('should use third person when referencing different personality', async () => {
      resolvePersonality.mockResolvedValue({
        profile: { displayName: 'Other Bot' },
      });

      const content = {
        messageContent: 'What did they say?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Different bot message',
          author: 'bot-user',
          isFromBot: true,
          personalityName: 'other-personality', // Different from current
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textContent = result[0].content[0].text;
      expect(textContent).toContain('Other Bot (other-personality) said');
      expect(textContent).not.toContain('You said');
    });

    it('should handle webhook name fallback for bot messages', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'What was that?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Webhook message',
          author: 'bot-user',
          isFromBot: true,
          webhookName: 'PluralKit System',
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textContent = result[0].content[0].text;
      expect(textContent).toContain('PluralKit System said');
    });

    it('should prioritize webhook name over generic "another user" for PluralKit', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'Who said that?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'System message',
          author: 'webhook-user',
          isFromBot: true,
          webhookName: 'Alex (they/them)',
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textContent = result[0].content[0].text;
      expect(textContent).toContain('Alex (they/them) said');
    });

    it('should fall back to author field as last resort', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'What?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Message',
          author: 'fallback-author',
          isFromBot: true,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textContent = result[0].content[0].text;
      expect(textContent).toContain('fallback-author said');
    });

    it('should use "the bot" if no name information available', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'What?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Anonymous bot message',
          author: null,
          isFromBot: true,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textContent = result[0].content[0].text;
      expect(textContent).toContain('the bot said');
    });

    it('should handle deprecated displayName field', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'Reference test',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Test message',
          author: 'bot-user',
          isFromBot: true,
          personalityName: 'old-bot',
          displayName: 'Old Display Name', // Deprecated field
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textContent = result[0].content[0].text;
      expect(textContent).toContain('Old Display Name (old-bot) said');
    });

    it('should use assistant role for same personality references', async () => {
      resolvePersonality.mockResolvedValue({
        profile: { displayName: 'Test Bot' },
      });

      const content = {
        messageContent: 'Repeat please',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Previous message',
          author: 'bot-user',
          isFromBot: true,
          personalityName: 'test-personality',
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      // Check the internal structure for assistant role
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using assistant role for reference to same personality')
      );
    });

    it('should use user role for different personality references', async () => {
      resolvePersonality.mockResolvedValue({
        profile: { displayName: 'Other Bot' },
      });

      const content = {
        messageContent: 'What did they say?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Other bot message',
          author: 'bot-user',
          isFromBot: true,
          personalityName: 'other-bot',
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      // Check the internal structure for user role
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using user role for reference to different personality')
      );
    });
  });
});