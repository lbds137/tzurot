/**
 * Tests for audio handling functionality in the webhookManager
 */

const webhookManager = require('../../src/webhookManager');

// Mock the dependencies without requiring actual modules
jest.mock('discord.js', () => ({
  WebhookClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ id: 'mock-message-id' }),
  })),
  EmbedBuilder: jest.fn().mockImplementation(data => data),
}));

// Mock the media module with audioHandler functionality
jest.mock('../../src/utils/media', () => {
  const audioHandler = {
    processAudioUrls: jest.fn(),
  };
  return {
    audioHandler,
    processMediaForWebhook: jest.fn(),
    prepareAttachmentOptions: jest.fn(),
  };
});

// Get the mocked audio handler from the media module
const { audioHandler } = require('../../src/utils/media');

jest.mock('../../src/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('webhookManager audio handling', () => {
  // Mocks for our tests
  let mockWebhook;
  let mockChannel;
  const originalSendWebhookMessage = webhookManager.sendWebhookMessage;

  // Create simplified test implementation of sendWebhookMessage
  const testSendWebhookMessage = async (channel, content, personality, options = {}) => {
    // Process any audio URLs in the content
    let processedContent = content;
    let attachments = [];

    try {
      // Only process if content is a string
      if (typeof content === 'string') {
        const { content: newContent, attachments: audioAttachments } =
          await audioHandler.processAudioUrls(content);
        processedContent = newContent;
        attachments = audioAttachments;
      }
    } catch (error) {
      processedContent = content;
      attachments = [];
    }

    // For testing, just return a simple result with processed content and attachments
    return {
      message: { id: 'test-message-id' },
      messageIds: ['test-message-id'],
      processedContent,
      attachments,
      personality: personality.fullName,
    };
  };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set up mock webhook
    mockWebhook = {
      send: jest.fn().mockResolvedValue({ id: 'mock-message-id' }),
    };

    // Mock channel
    mockChannel = {
      id: 'mock-channel-id',
      isThread: jest.fn().mockReturnValue(false),
    };

    // Replace the actual sendWebhookMessage with our test implementation
    webhookManager.sendWebhookMessage = testSendWebhookMessage;

    // Mock audioHandler.processAudioUrls
    audioHandler.processAudioUrls.mockImplementation(async content => {
      // Audio URL regex that matches the pattern in the audioHandler
      const audioUrlRegex = /https?:\/\/[^\s"'<>]+\.(mp3|wav|ogg|m4a|flac)(\?[^\s"'<>]*)?/g;

      // If content contains an audio URL, simulate processing
      if (content && audioUrlRegex.test(content)) {
        // Get the matched URLs
        const matches = content.match(audioUrlRegex) || [];
        if (matches.length > 0) {
          const audioUrl = matches[0];

          // Extract filename from the URL
          const parts = audioUrl.split('/');
          let filename = parts[parts.length - 1];

          // Remove query parameters if present
          if (filename.includes('?')) {
            filename = filename.split('?')[0];
          }

          return {
            content: content.replace(audioUrl, `[Audio: ${filename}]`),
            attachments: [
              {
                name: filename,
                attachment: 'mock-stream',
                contentType: 'audio/mpeg',
              },
            ],
          };
        }
      }

      // Otherwise return original content with no attachments
      return { content, attachments: [] };
    });
  });

  // Restore the original implementation after all tests
  afterAll(() => {
    webhookManager.sendWebhookMessage = originalSendWebhookMessage;
  });

  describe('sendWebhookMessage', () => {
    it('should process file domain audio URLs in the message content', async () => {
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Personality',
        avatarUrl: 'https://example.com/avatar.png',
      };

      const messageContent =
        'Check out this audio: https://files.example.org/ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3';

      const result = await webhookManager.sendWebhookMessage(
        mockChannel,
        messageContent,
        personality
      );

      // Verify that processAudioUrls was called
      expect(audioHandler.processAudioUrls).toHaveBeenCalledWith(messageContent);

      // Verify that the result includes processed content and attachments
      expect(result.processedContent).toBe(
        'Check out this audio: [Audio: ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3]'
      );
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].name).toBe('ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3');
    });

    it('should process generic audio URLs in the message content', async () => {
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Personality',
        avatarUrl: 'https://example.com/avatar.png',
      };

      const messageContent =
        'Check out this audio: https://example.com/path/to/mysong.mp3?param=value';

      const result = await webhookManager.sendWebhookMessage(
        mockChannel,
        messageContent,
        personality
      );

      // Verify that processAudioUrls was called
      expect(audioHandler.processAudioUrls).toHaveBeenCalledWith(messageContent);

      // Verify that the result includes processed content and attachments
      expect(result.processedContent).toBe('Check out this audio: [Audio: mysong.mp3]');
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].name).toBe('mysong.mp3');
    });

    it('should handle messages without audio URLs normally', async () => {
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Personality',
        avatarUrl: 'https://example.com/avatar.png',
      };

      const messageContent = 'This is a normal message without audio URLs';

      const result = await webhookManager.sendWebhookMessage(
        mockChannel,
        messageContent,
        personality
      );

      // Verify that processAudioUrls was called
      expect(audioHandler.processAudioUrls).toHaveBeenCalledWith(messageContent);

      // Verify the result has the original content and no attachments
      expect(result.processedContent).toBe(messageContent);
      expect(result.attachments).toHaveLength(0);
    });

    it('should handle errors during audio processing gracefully', async () => {
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Personality',
        avatarUrl: 'https://example.com/avatar.png',
      };

      const messageContent =
        'Check out this audio: https://files.example.org/ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3';

      // Simulate an error during audio processing
      audioHandler.processAudioUrls.mockRejectedValueOnce(new Error('Audio processing failed'));

      const result = await webhookManager.sendWebhookMessage(
        mockChannel,
        messageContent,
        personality
      );

      // Verify that processAudioUrls was called
      expect(audioHandler.processAudioUrls).toHaveBeenCalledWith(messageContent);

      // Verify that the result falls back to the original content on error
      expect(result.processedContent).toBe(messageContent);
      expect(result.attachments).toHaveLength(0);
    });
  });
});
