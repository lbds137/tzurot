/**
 * Tests for webhook name handling in aiMessageFormatter
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

describe('aiMessageFormatter - Webhook Name Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('formatApiMessages with webhook references', () => {
    it('should use webhook name when personality info is not available', async () => {
      resolvePersonality.mockResolvedValue(null); // No personality found

      const content = {
        messageContent: 'Hello',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Previous message',
          author: 'WebhookUser',
          webhookName: 'PluralKit Member',
          isFromBot: true,
          personalityName: null, // No personality info
          personalityDisplayName: null,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      // The content is returned as an array with text objects
      expect(result).toBeDefined();
      expect(result[0].role).toBe('user');

      // Check the text content
      const textContent = result[0].content[0].text;
      expect(textContent).toContain('PluralKit Member said');
      expect(textContent).not.toContain('the bot said');
    });

    it('should use author name as fallback when webhook name is not available', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'Hello',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Previous message',
          author: 'AuthorName',
          webhookName: null, // No webhook name
          isFromBot: true,
          personalityName: null,
          personalityDisplayName: null,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textContent = result[0].content[0].text;
      expect(textContent).toContain('AuthorName said');
      expect(textContent).not.toContain('the bot said');
    });

    it('should only use "the bot" as last resort', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'Hello',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Previous message',
          author: null,
          webhookName: null,
          isFromBot: true,
          personalityName: null,
          personalityDisplayName: null,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      // Only use 'the bot' when all other options are null
      const textContent = result[0].content[0].text;
      expect(textContent).toContain('the bot said');
    });

    it('should prefer personality display name when available', async () => {
      const mockPersonality = {
        name: 'test-personality-full',
        profile: {
          name: 'test-personality-full',
          displayName: 'Test Display',
        },
      };
      resolvePersonality.mockResolvedValue(mockPersonality);

      const content = {
        messageContent: 'Hello',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Previous message',
          author: 'AuthorName',
          webhookName: 'WebhookName',
          isFromBot: true,
          personalityName: 'test-personality-full',
          personalityDisplayName: 'Test Display',
        },
      };

      const result = await formatApiMessages(content, 'other-personality');

      // Should use personality display name when available
      const textContent = result[0].content[0].text;
      expect(textContent).toContain('Test Display (test-personality-full) said');
    });

    it('should handle proxy system webhooks with proper names', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'Response to proxy',
        userName: 'RealUser',
        referencedMessage: {
          content: 'Message from proxy system',
          author: 'pk;ProxyMember[APP]',
          webhookName: 'ProxyMember',
          isFromBot: true,
          personalityName: null,
          personalityDisplayName: null,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textContent = result[0].content[0].text;
      expect(textContent).toContain('ProxyMember said');
      expect(textContent).toContain('Message from proxy system');
    });

    it('should handle media references with webhook names', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'Nice image!',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Check this out',
          author: 'WebhookUser',
          webhookName: 'CustomWebhook',
          isFromBot: true,
          personalityName: null,
          personalityDisplayName: null,
          imageUrl: 'https://example.com/image.png',
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textContent = result[0].content[0].text;
      expect(textContent).toContain('CustomWebhook said (with an image)');
      expect(textContent).toContain('Check this out');
    });

    it('should handle self-references correctly', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'Correction',
        userName: 'TestUser',
        userId: '123456',
        referencedMessage: {
          content: 'Original message',
          author: 'TestUser',
          authorId: '123456', // Same as current user
          webhookName: 'SomeWebhook',
          isFromBot: false,
          personalityName: null,
          personalityDisplayName: null,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      // Should use "I said" for self-references
      const textContent = result[0].content[0].text;
      expect(textContent).toContain('I said');
      expect(textContent).not.toContain('TestUser said');
    });
  });

  describe('Edge cases', () => {
    it('should handle missing reference data gracefully', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'Hello',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Previous message',
          // All identifying fields are missing
          author: undefined,
          webhookName: undefined,
          isFromBot: true,
          personalityName: undefined,
          personalityDisplayName: undefined,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      // Should still work with fallback
      expect(result).toBeDefined();
      const textContent = result[0].content[0].text;
      expect(textContent).toContain('the bot said');
    });

    it('should handle empty webhook names', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'Hello',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Previous message',
          author: 'FallbackAuthor',
          webhookName: '', // Empty string
          isFromBot: true,
          personalityName: null,
          personalityDisplayName: null,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      // Should fall back to author
      const textContent = result[0].content[0].text;
      expect(textContent).toContain('FallbackAuthor said');
    });
  });
});
