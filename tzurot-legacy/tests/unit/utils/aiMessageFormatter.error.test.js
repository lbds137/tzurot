/**
 * Tests for error handling in aiMessageFormatter
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
const { formatContextMetadata } = require('../../../src/utils/contextMetadataFormatter');
const logger = require('../../../src/logger');

describe('aiMessageFormatter - Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Reference processing errors', () => {
    it('should fall back to user message when reference processing fails', async () => {
      resolvePersonality.mockRejectedValue(new Error('Failed to resolve personality'));

      const content = {
        messageContent: 'My actual message',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Referenced content',
          author: 'RefUser',
          isFromBot: true,
          personalityName: 'broken-personality',
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({
        role: 'user',
        content: 'My actual message',
      });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing referenced message')
      );
    });

    it('should handle missing messageContent in reference error fallback', async () => {
      // When messageContent is null and there's no actual error thrown,
      // the formatter returns the content object as-is
      const content = {
        messageContent: null,
        userName: 'TestUser',
        referencedMessage: {
          content: 'Referenced content',
          author: 'RefUser',
          isFromBot: false,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      // When messageContent is not a string or array and no error is thrown,
      // it returns the whole content object
      expect(result[0]).toEqual({
        role: 'user',
        content: content,
      });
    });

    it('should handle array messageContent in reference error fallback', async () => {
      // Mock to throw during processing
      resolvePersonality.mockImplementation(() => {
        throw new Error('Processing failed');
      });

      const content = {
        messageContent: [
          { type: 'text', text: 'Array message content' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
        ],
        userName: 'TestUser',
        referencedMessage: {
          content: 'Ref',
          author: 'RefUser',
          isFromBot: true,
          personalityName: 'broken-bot',
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({
        role: 'user',
        content: content.messageContent,
      });
    });
  });

  describe('Context metadata formatting errors', () => {
    it('should continue without context metadata when formatting fails', async () => {
      formatContextMetadata.mockImplementation(() => {
        throw new Error('Context formatting failed');
      });

      const content = 'Test message';
      const message = { guild: { name: 'Test' } };

      const result = await formatApiMessages(content, 'test-personality', 'TestUser', false, message, false);

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0].content).toBe('Test message'); // No context prefix
      
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error formatting context metadata')
      );
    });

    it('should handle context metadata error in reference messages', async () => {
      resolvePersonality.mockResolvedValue(null);
      formatContextMetadata.mockImplementation(() => {
        throw new Error('Context error');
      });

      const content = {
        messageContent: 'What did they say?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Original message',
          author: 'OriginalUser',
          isFromBot: false,
        },
      };
      const message = { guild: { name: 'Test' } };

      const result = await formatApiMessages(content, 'test-personality', 'TestUser', false, message, false);

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      // Should still have the message content without context metadata
      expect(result[0].content[0].text).toContain('What did they say?');
      expect(result[0].content[0].text).toContain('OriginalUser said');
    });

    it('should handle context metadata error in multimodal messages', async () => {
      formatContextMetadata.mockImplementation(() => {
        throw new Error('Metadata error');
      });

      const content = [
        { type: 'text', text: 'Check this out' },
        { type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } },
      ];
      const message = { guild: { name: 'Test' } };

      const result = await formatApiMessages(content, 'test-personality', 'TestUser', false, message, false);

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0].content[0].text).toBe('Check this out'); // No context prefix
      expect(result[0].content[1].type).toBe('image_url');
    });
  });

  describe('Top-level error handling', () => {
    it('should handle unexpected content format gracefully', async () => {
      // Content that doesn't match expected format will fall through to the simple handler
      const weirdContent = { someField: 'value', anotherField: 123 };

      const result = await formatApiMessages(weirdContent, 'test-personality');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      // Non-string, non-array content is returned as-is
      expect(result[0]).toEqual({
        role: 'user',
        content: weirdContent,
      });
    });

    it('should handle null content', async () => {
      const result = await formatApiMessages(null, 'test-personality');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({
        role: 'user',
        content: null,
      });
    });

    it('should handle undefined content', async () => {
      const result = await formatApiMessages(undefined, 'test-personality');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({
        role: 'user',
        content: undefined,
      });
    });

    it('should extract messageContent from broken reference object', async () => {
      // Mock a scenario where resolvePersonality throws during processing
      let callCount = 0;
      resolvePersonality.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Resolve failed');
        }
        return null;
      });

      const content = {
        messageContent: 'This should be extracted',
        unknownField: 'ignored',
      };

      const result = await formatApiMessages(content, 'test-personality');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({
        role: 'user',
        content: 'This should be extracted',
      });
    });

    it('should handle complex messageContent in error recovery', async () => {
      const content = {
        messageContent: {
          nested: 'object',
          that: 'is not string or array',
        },
        userName: 'TestUser',
      };

      const result = await formatApiMessages(content, 'test-personality');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      // Complex messageContent in the special format is returned as-is
      expect(result[0]).toEqual({
        role: 'user',
        content: content.messageContent,
      });
    });
  });

  describe('Edge cases in error paths', () => {
    it('should handle errors when both reference processing and fallback fail', async () => {
      // Force an error in the try block but with proper reference message structure
      resolvePersonality.mockImplementation(() => {
        // This will cause an error when trying to process the Symbol
        throw new Error('Cannot process symbol');
      });

      const content = {
        messageContent: Symbol('cannot stringify'), // Will cause issues
        userName: 'TestUser',
        referencedMessage: {
          content: 'Ref',
          author: 'RefUser',
          isFromBot: true,
          personalityName: 'test-bot',
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({
        role: 'user',
        content: 'There was an error processing a referenced message.',
      });

      expect(logger.error).toHaveBeenCalled();
    });

    it('should log full error stack traces', async () => {
      const testError = new Error('Test error with stack');
      testError.stack = 'Error: Test error with stack\n    at testFunction (test.js:123)';
      
      resolvePersonality.mockRejectedValue(testError);

      const content = {
        messageContent: 'Test',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Ref',
          author: 'Bot',
          isFromBot: true,
          personalityName: 'test',
        },
      };

      await formatApiMessages(content, 'test-personality');

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Reference processing error stack:')
      );
    });
  });
});