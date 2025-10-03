/**
 * Tests for the media handling system
 */

jest.mock('../../../../src/logger');
jest.mock('node-fetch');

// Mock the audio and image handlers
jest.mock('../../../../src/utils/media/audioHandler', () => ({
  processAudioUrls: jest.fn(),
  hasAudioExtension: jest.fn(),
}));

jest.mock('../../../../src/utils/media/imageHandler', () => ({
  processImageUrls: jest.fn(),
  hasImageExtension: jest.fn(),
}));

const { createMigrationHelper } = require('../../../utils/testEnhancements');
const mediaHandler = require('../../../../src/utils/media/mediaHandler');
const audioHandler = require('../../../../src/utils/media/audioHandler');
const imageHandler = require('../../../../src/utils/media/imageHandler');
const logger = require('../../../../src/logger');

describe('Media Handler', () => {
  let migrationHelper;

  beforeEach(() => {
    migrationHelper = createMigrationHelper('utility');
    jest.clearAllMocks();

    // Set up logger mock using enhanced utilities
    const mockEnv = migrationHelper.enhanced.createMocks();
    Object.assign(logger, mockEnv.logger);

    // Set up audio handler mock
    audioHandler.processAudioUrls.mockResolvedValue({
      content: 'processed audio content',
      attachments: [{ name: 'audio.mp3' }],
    });

    // Set up image handler mock
    imageHandler.processImageUrls.mockResolvedValue({
      content: 'processed image content',
      attachments: [{ name: 'image.jpg' }],
    });
  });

  describe('processMediaUrls', () => {
    it('should return original content when input is invalid', async () => {
      const result = await mediaHandler.processMediaUrls(null);
      expect(result).toEqual({ content: null, attachments: [] });

      const result2 = await mediaHandler.processMediaUrls(123);
      expect(result2).toEqual({ content: 123, attachments: [] });
    });

    it('should prioritize audio over image processing', async () => {
      // Set up audio handler to return attachments
      audioHandler.processAudioUrls.mockResolvedValue({
        content: 'processed audio content',
        attachments: [{ name: 'audio.mp3' }],
      });

      const result = await mediaHandler.processMediaUrls('content with audio and image');

      // Should call audio handler
      expect(audioHandler.processAudioUrls).toHaveBeenCalled();

      // Should not call image handler since audio was found
      expect(imageHandler.processImageUrls).not.toHaveBeenCalled();

      // Should return processed content from audio handler
      expect(result).toEqual({
        content: 'processed audio content',
        attachments: [{ name: 'audio.mp3' }],
      });
    });

    it('should process images if no audio found', async () => {
      // Set up audio handler to return no attachments
      audioHandler.processAudioUrls.mockResolvedValue({
        content: 'content with image',
        attachments: [],
      });

      const result = await mediaHandler.processMediaUrls('content with image');

      // Should call audio handler first
      expect(audioHandler.processAudioUrls).toHaveBeenCalled();

      // Should call image handler since no audio was found
      expect(imageHandler.processImageUrls).toHaveBeenCalled();

      // Should return processed content from image handler
      expect(result).toEqual({
        content: 'processed image content',
        attachments: [{ name: 'image.jpg' }],
      });
    });

    it('should return original content when no media found by handlers', async () => {
      // Set up both handlers to return no attachments
      audioHandler.processAudioUrls.mockResolvedValue({
        content: 'plain text content',
        attachments: [],
      });
      imageHandler.processImageUrls.mockResolvedValue({
        content: 'plain text content',
        attachments: [],
      });

      const result = await mediaHandler.processMediaUrls('plain text content');

      // Should call both handlers
      expect(audioHandler.processAudioUrls).toHaveBeenCalled();
      expect(imageHandler.processImageUrls).toHaveBeenCalled();

      // Should return original content with empty attachments
      expect(result).toEqual({
        content: 'plain text content',
        attachments: [],
      });
    });

    it('should handle errors gracefully', async () => {
      // Set up audio handler to throw error
      audioHandler.processAudioUrls.mockRejectedValue(new Error('Test error'));

      const content = 'test content';
      const result = await mediaHandler.processMediaUrls(content);

      // Should log error
      expect(logger.error).toHaveBeenCalled();

      // Should return original content
      expect(result).toEqual({ content, attachments: [] });
    });
  });

  describe('prepareAttachmentOptions', () => {
    it('should return empty object for empty attachments', () => {
      const result = mediaHandler.prepareAttachmentOptions([]);
      expect(result).toEqual({});

      const result2 = mediaHandler.prepareAttachmentOptions(null);
      expect(result2).toEqual({});
    });

    it('should convert attachments to Discord.js format', () => {
      const attachments = [
        { attachment: 'buffer1', name: 'file1.mp3', contentType: 'audio/mpeg' },
        { attachment: 'buffer2', name: 'file2.jpg', contentType: 'image/jpeg' },
      ];

      const result = mediaHandler.prepareAttachmentOptions(attachments);

      expect(result).toEqual({
        files: [
          { attachment: 'buffer1', name: 'file1.mp3', contentType: 'audio/mpeg' },
          { attachment: 'buffer2', name: 'file2.jpg', contentType: 'image/jpeg' },
        ],
      });
    });
  });

  // Basic smoke test for processMediaForWebhook (which just calls processMediaUrls)
  describe('processMediaForWebhook', () => {
    it('should call processMediaUrls with the same parameters', async () => {
      const content = 'test webhook content';
      await mediaHandler.processMediaForWebhook(content);

      expect(audioHandler.processAudioUrls).toHaveBeenCalledWith(content);
    });
  });

  describe('detectMedia', () => {
    // Helper to create a mock message
    const createMockMessage = (overrides = {}) => ({
      id: '123',
      channel: { id: 'channel1' },
      attachments: { size: 0, values: () => [] },
      embeds: [],
      ...overrides,
    });

    it('should return original content when no media found', async () => {
      const mockMessage = createMockMessage();
      const result = await mediaHandler.detectMedia(mockMessage, 'plain text content', {});

      expect(result).toEqual({
        messageContent: 'plain text content',
        hasFoundAudio: false,
        hasFoundImage: false,
        audioUrl: null,
        imageUrl: null,
        useReferencedMedia: false,
      });
    });

    // Tests for [Audio: url] pattern detection
    describe('[Audio: url] pattern detection', () => {
      it('should detect audio URL in content', async () => {
        const mockMessage = createMockMessage();
        const content = 'Check out this audio [Audio: https://example.com/audio.mp3]';

        const result = await mediaHandler.detectMedia(mockMessage, content, {});

        expect(result.hasFoundAudio).toBe(true);
        expect(result.audioUrl).toBe('https://example.com/audio.mp3');
        expect(result.hasFoundImage).toBe(false);
        expect(result.imageUrl).toBe(null);
        expect(result.messageContent).toEqual([
          { type: 'text', text: 'Check out this audio' },
          { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' } },
        ]);
      });

      it('should remove audio URL from message content', async () => {
        const mockMessage = createMockMessage();
        const content = 'Before [Audio: https://example.com/sound.mp3] After';

        const result = await mediaHandler.detectMedia(mockMessage, content, {});

        expect(result.messageContent[0].text).toBe('Before  After');
      });

      it('should add default prompt when audio URL with no text', async () => {
        const mockMessage = createMockMessage();
        const content = '[Audio: https://example.com/audio.mp3]';

        const result = await mediaHandler.detectMedia(mockMessage, content, {
          personalityName: 'TestBot',
          userName: 'TestUser',
        });

        expect(result.messageContent[0].text).toBe('Voice message from TestUser:');
      });
    });

    // Tests for [Image: url] pattern detection
    describe('[Image: url] pattern detection', () => {
      it('should detect image URL in content', async () => {
        const mockMessage = createMockMessage();
        const content = 'Look at this [Image: https://example.com/image.jpg]';

        const result = await mediaHandler.detectMedia(mockMessage, content, {});

        expect(result.hasFoundImage).toBe(true);
        expect(result.imageUrl).toBe('https://example.com/image.jpg');
        expect(result.hasFoundAudio).toBe(false);
        expect(result.audioUrl).toBe(null);
        expect(result.messageContent).toEqual([
          { type: 'text', text: 'Look at this' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
        ]);
      });

      it('should not detect image if audio already found', async () => {
        const mockMessage = createMockMessage();
        const content =
          '[Audio: https://example.com/audio.mp3] and [Image: https://example.com/image.jpg]';

        const result = await mediaHandler.detectMedia(mockMessage, content, {});

        expect(result.hasFoundAudio).toBe(true);
        expect(result.hasFoundImage).toBe(false);
        expect(result.audioUrl).toBe('https://example.com/audio.mp3');
        expect(result.imageUrl).toBe(null);
      });

      it('should add default prompt when image URL with no text', async () => {
        const mockMessage = createMockMessage();
        const content = '[Image: https://example.com/image.jpg]';

        const result = await mediaHandler.detectMedia(mockMessage, content, {});

        expect(result.messageContent[0].text).toBe("What's in this image?");
      });
    });

    // Tests for message attachments
    describe('Message attachments', () => {
      it('should detect audio attachment', async () => {
        const mockMessage = createMockMessage({
          attachments: {
            size: 1,
            values: () => [
              {
                contentType: 'audio/mpeg',
                url: 'https://cdn.discord.com/attachments/123/456/audio.mp3',
              },
            ],
          },
        });

        const result = await mediaHandler.detectMedia(mockMessage, 'Listen to this', {});

        expect(result.hasFoundAudio).toBe(true);
        expect(result.audioUrl).toBe('https://cdn.discord.com/attachments/123/456/audio.mp3');
        expect(result.messageContent).toEqual([
          { type: 'text', text: 'Listen to this' },
          {
            type: 'audio_url',
            audio_url: { url: 'https://cdn.discord.com/attachments/123/456/audio.mp3' },
          },
        ]);
      });

      it('should detect audio by file extension when contentType missing', async () => {
        const mockMessage = createMockMessage({
          attachments: {
            size: 1,
            values: () => [
              {
                url: 'https://cdn.discord.com/attachments/123/456/sound.wav',
              },
            ],
          },
        });

        const result = await mediaHandler.detectMedia(mockMessage, '', {});

        expect(result.hasFoundAudio).toBe(true);
        expect(result.audioUrl).toBe('https://cdn.discord.com/attachments/123/456/sound.wav');
      });

      it('should detect image attachment', async () => {
        const mockMessage = createMockMessage({
          attachments: {
            size: 1,
            values: () => [
              {
                contentType: 'image/png',
                url: 'https://cdn.discord.com/attachments/123/456/image.png',
              },
            ],
          },
        });

        const result = await mediaHandler.detectMedia(mockMessage, 'Check this out', {});

        expect(result.hasFoundImage).toBe(true);
        expect(result.imageUrl).toBe('https://cdn.discord.com/attachments/123/456/image.png');
      });

      it('should prioritize audio over image attachments', async () => {
        const mockMessage = createMockMessage({
          attachments: {
            size: 2,
            values: () => [
              {
                contentType: 'image/png',
                url: 'https://cdn.discord.com/attachments/123/456/image.png',
              },
              {
                contentType: 'audio/mpeg',
                url: 'https://cdn.discord.com/attachments/123/456/audio.mp3',
              },
            ],
          },
        });

        const result = await mediaHandler.detectMedia(mockMessage, 'Multiple attachments', {});

        expect(result.hasFoundAudio).toBe(true);
        expect(result.hasFoundImage).toBe(false);
        expect(result.audioUrl).toBe('https://cdn.discord.com/attachments/123/456/audio.mp3');
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Found audio attachment'));
      });
    });

    // Tests for embed media detection
    describe('Embed media detection', () => {
      it('should detect audio URL in embed description', async () => {
        const mockMessage = createMockMessage({
          embeds: [
            {
              description: 'Check out this cool track: https://example.com/song.mp3',
            },
          ],
        });

        const result = await mediaHandler.detectMedia(mockMessage, 'Embedded audio', {});

        expect(result.hasFoundAudio).toBe(true);
        expect(result.audioUrl).toBe('https://example.com/song.mp3');
      });

      it('should detect audio URL in embed fields', async () => {
        const mockMessage = createMockMessage({
          embeds: [
            {
              fields: [
                { name: 'Title', value: 'Test' },
                { name: 'Audio', value: 'Listen here: https://example.com/audio.wav' },
              ],
            },
          ],
        });

        const result = await mediaHandler.detectMedia(mockMessage, 'Field audio', {});

        expect(result.hasFoundAudio).toBe(true);
        expect(result.audioUrl).toBe('https://example.com/audio.wav');
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("embed field 'Audio'"));
      });

      it('should detect image in embed', async () => {
        const mockMessage = createMockMessage({
          embeds: [
            {
              image: { url: 'https://example.com/embed-image.jpg' },
            },
          ],
        });

        const result = await mediaHandler.detectMedia(mockMessage, 'Embedded image', {});

        expect(result.hasFoundImage).toBe(true);
        expect(result.imageUrl).toBe('https://example.com/embed-image.jpg');
      });

      it('should detect thumbnail in embed when no image', async () => {
        const mockMessage = createMockMessage({
          embeds: [
            {
              thumbnail: { url: 'https://example.com/thumb.png' },
            },
          ],
        });

        const result = await mediaHandler.detectMedia(mockMessage, 'Thumbnail', {});

        expect(result.hasFoundImage).toBe(true);
        expect(result.imageUrl).toBe('https://example.com/thumb.png');
      });

      it('should prioritize audio over images in embeds', async () => {
        const mockMessage = createMockMessage({
          embeds: [
            {
              description: 'Audio: https://example.com/song.ogg',
              image: { url: 'https://example.com/cover.jpg' },
            },
          ],
        });

        const result = await mediaHandler.detectMedia(mockMessage, 'Both media types', {});

        expect(result.hasFoundAudio).toBe(true);
        expect(result.hasFoundImage).toBe(false);
        expect(result.audioUrl).toBe('https://example.com/song.ogg');
      });
    });

    // Tests for multimodal content handling
    describe('Multimodal content handling', () => {
      it('should preserve existing multimodal array with text', async () => {
        const mockMessage = createMockMessage();
        const existingContent = [{ type: 'text', text: 'Existing text' }];
        const content = '[Audio: https://example.com/audio.mp3]';

        // First process the audio URL
        const preprocessed = await mediaHandler.detectMedia(mockMessage, content, {});

        // Then process with existing content
        const result = await mediaHandler.detectMedia(mockMessage, existingContent, {});

        expect(result.messageContent).toEqual(existingContent);
      });

      it('should handle empty multimodal array', async () => {
        const mockMessage = createMockMessage({
          attachments: {
            size: 1,
            values: () => [
              {
                contentType: 'audio/mpeg',
                url: 'https://example.com/audio.mp3',
              },
            ],
          },
        });

        const result = await mediaHandler.detectMedia(mockMessage, [], {
          personalityName: 'Bot',
          userName: 'User',
        });

        expect(result.messageContent[0].type).toBe('text');
        expect(result.messageContent[0].text).toBe('Voice message from User:');
      });

      it('should copy text elements from multimodal array', async () => {
        const mockMessage = createMockMessage({
          attachments: {
            size: 1,
            values: () => [
              {
                contentType: 'image/jpeg',
                url: 'https://example.com/image.jpg',
              },
            ],
          },
        });
        const multimodalContent = [
          { type: 'text', text: 'First text' },
          { type: 'other', data: 'ignored' },
          { type: 'text', text: 'Second text' },
        ];

        const result = await mediaHandler.detectMedia(mockMessage, multimodalContent, {});

        expect(result.messageContent).toEqual([
          { type: 'text', text: 'First text' },
          { type: 'text', text: 'Second text' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
        ]);
      });

      it('should add default prompt when no text in multimodal array', async () => {
        const mockMessage = createMockMessage({
          attachments: {
            size: 1,
            values: () => [
              {
                contentType: 'image/png',
                url: 'https://example.com/image.png',
              },
            ],
          },
        });
        const multimodalContent = [{ type: 'other', data: 'ignored' }];

        const result = await mediaHandler.detectMedia(mockMessage, multimodalContent, {});

        expect(result.messageContent[0].text).toBe('Please analyze this media');
      });
    });

    // Tests for edge cases and error scenarios
    describe('Edge cases', () => {
      it('should handle null/undefined message content', async () => {
        const mockMessage = createMockMessage();

        const result1 = await mediaHandler.detectMedia(mockMessage, null, {});
        expect(result1.messageContent).toBe(null);

        const result2 = await mediaHandler.detectMedia(mockMessage, undefined, {});
        expect(result2.messageContent).toBe(undefined);
      });

      it('should skip warning when audio found before image (normal flow)', async () => {
        // This tests the normal flow where audio is found first, preventing image detection
        const mockMessage = createMockMessage({
          attachments: {
            size: 1,
            values: () => [
              {
                contentType: 'audio/mpeg',
                url: 'https://example.com/audio.mp3',
              },
            ],
          },
          embeds: [
            {
              image: { url: 'https://example.com/embed-image.jpg' },
            },
          ],
        });

        const result = await mediaHandler.detectMedia(
          mockMessage,
          'Message with both media types',
          {}
        );

        expect(result.hasFoundAudio).toBe(true);
        expect(result.hasFoundImage).toBe(false);
        expect(result.audioUrl).toBe('https://example.com/audio.mp3');
        // The warning is NOT logged because we found audio first, which prevents image detection
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it('should handle malformed audio URL patterns', async () => {
        const mockMessage = createMockMessage();
        const content =
          '[Audio: not-a-url] and [Audio: ] and [Audio:https://example.com/audio.mp3]';

        const result = await mediaHandler.detectMedia(mockMessage, content, {});

        expect(result.hasFoundAudio).toBe(false);
        expect(result.audioUrl).toBe(null);
      });

      it('should handle referenced media options (always false)', async () => {
        const mockMessage = createMockMessage();

        const result = await mediaHandler.detectMedia(mockMessage, 'content', {
          referencedAudioUrl: 'https://example.com/ref-audio.mp3',
          referencedImageUrl: 'https://example.com/ref-image.jpg',
        });

        expect(result.useReferencedMedia).toBe(false);
      });

      it('should handle empty attachments collection', async () => {
        const mockMessage = createMockMessage({
          attachments: {
            size: 0,
            values: () => [],
          },
        });

        const result = await mediaHandler.detectMedia(mockMessage, 'text', {});

        expect(result.hasFoundAudio).toBe(false);
        expect(result.hasFoundImage).toBe(false);
      });

      it('should handle empty embeds array', async () => {
        const mockMessage = createMockMessage({
          embeds: [],
        });

        const result = await mediaHandler.detectMedia(mockMessage, 'text', {});

        expect(result.hasFoundAudio).toBe(false);
        expect(result.hasFoundImage).toBe(false);
      });

      it('should skip embeds with no relevant media fields', async () => {
        const mockMessage = createMockMessage({
          embeds: [
            {
              title: 'Just a title',
              author: { name: 'Author' },
            },
          ],
        });

        const result = await mediaHandler.detectMedia(mockMessage, 'text', {});

        expect(result.hasFoundAudio).toBe(false);
        expect(result.hasFoundImage).toBe(false);
      });
    });
  });
});
