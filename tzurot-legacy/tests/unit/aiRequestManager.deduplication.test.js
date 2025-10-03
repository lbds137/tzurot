/**
 * @fileoverview Test for improved request deduplication in AI Request Manager
 */

const { createRequestId } = require('../../src/utils/aiRequestManager');

describe('AIRequestManager - Request Deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createRequestId with message ID', () => {
    it('should include message ID in request ID when available', () => {
      const personalityName = 'test-personality';
      const message = 'Hello world';
      const context = {
        userId: '123',
        channelId: '456',
        messageId: '789',
      };

      const requestId = createRequestId(personalityName, message, context);

      expect(requestId).toContain('msg789_');
      expect(requestId).toContain('test-personality');
      expect(requestId).toContain('123');
      expect(requestId).toContain('456');
    });

    it('should create different IDs for same content with different message IDs', () => {
      const personalityName = 'test-personality';
      const message = 'Hello world';
      const context1 = {
        userId: '123',
        channelId: '456',
        messageId: '789',
      };
      const context2 = {
        userId: '123',
        channelId: '456',
        messageId: '999',
      };

      const requestId1 = createRequestId(personalityName, message, context1);
      const requestId2 = createRequestId(personalityName, message, context2);

      expect(requestId1).not.toBe(requestId2);
      expect(requestId1).toContain('msg789_');
      expect(requestId2).toContain('msg999_');
    });

    it('should still work without message ID', () => {
      const personalityName = 'test-personality';
      const message = 'Hello world';
      const context = {
        userId: '123',
        channelId: '456',
      };

      const requestId = createRequestId(personalityName, message, context);

      expect(requestId).not.toContain('msg');
      expect(requestId).toContain('test-personality');
      expect(requestId).toContain('123');
      expect(requestId).toContain('456');
    });

    it('should include content hash for better uniqueness', () => {
      const personalityName = 'test-personality';
      const message1 = 'Hello world';
      const message2 = 'Hello world!'; // Slightly different
      const context = {
        userId: '123',
        channelId: '456',
      };

      const requestId1 = createRequestId(personalityName, message1, context);
      const requestId2 = createRequestId(personalityName, message2, context);

      // Different messages should have different hashes
      expect(requestId1).not.toBe(requestId2);
      expect(requestId1).toContain('_h');
      expect(requestId2).toContain('_h');
    });

    it('should handle multimodal content with message ID', () => {
      const personalityName = 'test-personality';
      const message = [
        { type: 'text', text: 'Check out this image' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
      ];
      const context = {
        userId: '123',
        channelId: '456',
        messageId: '789',
      };

      const requestId = createRequestId(personalityName, message, context);

      expect(requestId).toContain('msg789_');
      expect(requestId).toContain('_IMG-');
      expect(requestId).toContain('_h'); // Should have hash
    });

    it('should handle reference messages with message ID', () => {
      const personalityName = 'test-personality';
      const message = {
        messageContent: 'My response',
        referencedMessage: {
          content: 'Original message',
          author: 'user123',
        },
      };
      const context = {
        userId: '123',
        channelId: '456',
        messageId: '789',
      };

      const requestId = createRequestId(personalityName, message, context);

      expect(requestId).toContain('msg789_');
      expect(requestId).toContain('_ref'); // Reference hash
      expect(requestId).toContain('_h'); // Content hash
    });
  });
});
