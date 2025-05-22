/**
 * Tests for the media handling system
 */

jest.mock('../../../../src/logger');
jest.mock('node-fetch');

// Mock the audio and image handlers
jest.mock('../../../../src/utils/media/audioHandler', () => ({
  processAudioUrls: jest.fn(),
  hasAudioExtension: jest.fn()
}));

jest.mock('../../../../src/utils/media/imageHandler', () => ({
  processImageUrls: jest.fn(),
  hasImageExtension: jest.fn()
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
      attachments: [{ name: 'audio.mp3' }]
    });
    
    // Set up image handler mock
    imageHandler.processImageUrls.mockResolvedValue({
      content: 'processed image content',
      attachments: [{ name: 'image.jpg' }]
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
        attachments: [{ name: 'audio.mp3' }]
      });
      
      const result = await mediaHandler.processMediaUrls('content with audio and image');
      
      // Should call audio handler
      expect(audioHandler.processAudioUrls).toHaveBeenCalled();
      
      // Should not call image handler since audio was found
      expect(imageHandler.processImageUrls).not.toHaveBeenCalled();
      
      // Should return processed content from audio handler
      expect(result).toEqual({
        content: 'processed audio content',
        attachments: [{ name: 'audio.mp3' }]
      });
    });
    
    it('should process images if no audio found', async () => {
      // Set up audio handler to return no attachments
      audioHandler.processAudioUrls.mockResolvedValue({
        content: 'content with image',
        attachments: []
      });
      
      const result = await mediaHandler.processMediaUrls('content with image');
      
      // Should call audio handler first
      expect(audioHandler.processAudioUrls).toHaveBeenCalled();
      
      // Should call image handler since no audio was found
      expect(imageHandler.processImageUrls).toHaveBeenCalled();
      
      // Should return processed content from image handler
      expect(result).toEqual({
        content: 'processed image content',
        attachments: [{ name: 'image.jpg' }]
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
        { attachment: 'buffer2', name: 'file2.jpg', contentType: 'image/jpeg' }
      ];
      
      const result = mediaHandler.prepareAttachmentOptions(attachments);
      
      expect(result).toEqual({
        files: [
          { attachment: 'buffer1', name: 'file1.mp3', contentType: 'audio/mpeg' },
          { attachment: 'buffer2', name: 'file2.jpg', contentType: 'image/jpeg' }
        ]
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
  
  // Minimal test for detectMedia - this function is complex and would need more extensive testing
  describe('detectMedia', () => {
    it('should return original content when message is invalid', async () => {
      // Create a minimal mock message to prevent null reference errors
      const mockMessage = {
        id: '123',
        channel: { id: 'channel1' },
        attachments: { size: 0, values: () => [] },
        embeds: []
      };
      
      const result = await mediaHandler.detectMedia(mockMessage, 'content', {});
      
      expect(result).toEqual({
        messageContent: 'content',
        hasFoundAudio: false,
        hasFoundImage: false,
        audioUrl: null,
        imageUrl: null,
        useReferencedMedia: false
      });
    });
    
    it('should detect audio URL in content', async () => {
      const mockMessage = {
        id: '123',
        channel: { id: 'channel1' },
        attachments: { size: 0, values: () => [] },
        embeds: []
      };
      const content = 'Check out this audio [Audio: https://example.com/audio.mp3]';
      
      const result = await mediaHandler.detectMedia(mockMessage, content, {});
      
      expect(result.hasFoundAudio).toBe(true);
      expect(result.audioUrl).toBe('https://example.com/audio.mp3');
      expect(Array.isArray(result.messageContent)).toBe(true);
    });
  });
});