/**
 * Tests for the media handler module
 */

const mediaHandler = require('../../../src/handlers/mediaHandler');
const logger = require('../../../src/logger');
const utilsMediaHandler = require('../../../src/utils/media/mediaHandler');

// Mock dependencies
jest.mock('../../../src/logger');
jest.mock('../../../src/utils/media/mediaHandler', () => ({
  processMediaUrls: jest.fn(),
  prepareAttachmentOptions: jest.fn()
}));

describe('Media Handler Module', () => {
  // Mock Discord message
  const createMockMessage = (options = {}) => ({
    content: options.content || '',
    attachments: new Map(options.attachments || []), 
    embeds: options.embeds || [],
    ...options
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detectMedia', () => {
    it('should extract audio URLs from message content', async () => {
      const mockMessage = createMockMessage({
        content: 'Please listen to this [Audio: https://example.com/audio.mp3]'
      });
      
      const result = await mediaHandler.detectMedia(mockMessage, mockMessage.content);
      
      expect(result.hasFoundAudio).toBe(true);
      expect(result.audioUrl).toBe('https://example.com/audio.mp3');
      expect(result.hasFoundImage).toBe(false);
      expect(result.imageUrl).toBe(null);
      
      // Check that the content was cleaned
      const textContent = Array.isArray(result.messageContent) 
        ? result.messageContent.find(item => item.type === 'text')?.text 
        : result.messageContent;
      
      expect(textContent).toBe('Please listen to this');
      
      // Check that the result has the audio URL
      if (Array.isArray(result.messageContent)) {
        const audioItem = result.messageContent.find(item => item.type === 'audio_url');
        expect(audioItem).toBeDefined();
        expect(audioItem.audio_url.url).toBe('https://example.com/audio.mp3');
      }
    });
    
    it('should extract image URLs from message content', async () => {
      const mockMessage = createMockMessage({
        content: 'What do you see in this [Image: https://example.com/image.jpg]'
      });
      
      const result = await mediaHandler.detectMedia(mockMessage, mockMessage.content);
      
      expect(result.hasFoundAudio).toBe(false);
      expect(result.audioUrl).toBe(null);
      expect(result.hasFoundImage).toBe(true);
      expect(result.imageUrl).toBe('https://example.com/image.jpg');
      
      // Check that the content was cleaned
      const textContent = Array.isArray(result.messageContent) 
        ? result.messageContent.find(item => item.type === 'text')?.text 
        : result.messageContent;
      
      expect(textContent).toBe('What do you see in this');
      
      // Check that the result has the image URL
      if (Array.isArray(result.messageContent)) {
        const imageItem = result.messageContent.find(item => item.type === 'image_url');
        expect(imageItem).toBeDefined();
        expect(imageItem.image_url.url).toBe('https://example.com/image.jpg');
      }
    });
    
    it('should detect audio attachments in the message', async () => {
      const mockAttachments = [
        ['audio', { 
          contentType: 'audio/mp3', 
          url: 'https://example.com/attachment.mp3' 
        }]
      ];
      
      const mockMessage = createMockMessage({
        content: 'Check this audio',
        attachments: mockAttachments
      });
      
      const result = await mediaHandler.detectMedia(mockMessage, mockMessage.content);
      
      expect(result.hasFoundAudio).toBe(true);
      expect(result.audioUrl).toBe('https://example.com/attachment.mp3');
      expect(result.hasFoundImage).toBe(false);
    });
    
    it('should detect image attachments in the message', async () => {
      const mockAttachments = [
        ['image', { 
          contentType: 'image/jpeg', 
          url: 'https://example.com/attachment.jpg' 
        }]
      ];
      
      const mockMessage = createMockMessage({
        content: 'Check this image',
        attachments: mockAttachments
      });
      
      const result = await mediaHandler.detectMedia(mockMessage, mockMessage.content);
      
      expect(result.hasFoundAudio).toBe(false);
      expect(result.hasFoundImage).toBe(true);
      expect(result.imageUrl).toBe('https://example.com/attachment.jpg');
    });
    
    it('should detect audio in message embeds', async () => {
      const mockEmbeds = [
        {
          description: 'Check out this audio: https://example.com/embed-audio.mp3',
          fields: []
        }
      ];
      
      const mockMessage = createMockMessage({
        content: 'Message with embed',
        embeds: mockEmbeds
      });
      
      const result = await mediaHandler.detectMedia(mockMessage, mockMessage.content);
      
      expect(result.hasFoundAudio).toBe(true);
      expect(result.audioUrl).toBe('https://example.com/embed-audio.mp3');
      expect(result.hasFoundImage).toBe(false);
    });
    
    it('should detect images in message embeds', async () => {
      const mockEmbeds = [
        {
          description: 'Check out this image',
          image: { url: 'https://example.com/embed-image.jpg' }
        }
      ];
      
      const mockMessage = createMockMessage({
        content: 'Message with embed',
        embeds: mockEmbeds
      });
      
      const result = await mediaHandler.detectMedia(mockMessage, mockMessage.content);
      
      expect(result.hasFoundAudio).toBe(false);
      expect(result.hasFoundImage).toBe(true);
      expect(result.imageUrl).toBe('https://example.com/embed-image.jpg');
    });
    
    it('should prioritize audio over images', async () => {
      const mockMessage = createMockMessage({
        content: 'Check this [Audio: https://example.com/audio.mp3] and [Image: https://example.com/image.jpg]'
      });
      
      const result = await mediaHandler.detectMedia(mockMessage, mockMessage.content);
      
      expect(result.hasFoundAudio).toBe(true);
      expect(result.audioUrl).toBe('https://example.com/audio.mp3');
      expect(result.hasFoundImage).toBe(true); // Image is detected but not used in the output
      expect(result.imageUrl).toBe('https://example.com/image.jpg');
      
      // Check that the result only has the audio URL
      if (Array.isArray(result.messageContent)) {
        const audioItem = result.messageContent.find(item => item.type === 'audio_url');
        expect(audioItem).toBeDefined();
        
        // No image item should be included since audio takes precedence
        const imageItem = result.messageContent.find(item => item.type === 'image_url');
        expect(imageItem).toBeUndefined();
      }
    });
    
    it('should use referenced media when no media found in the message', async () => {
      const mockMessage = createMockMessage({
        content: 'What do you think about this?'
      });
      
      const options = {
        referencedAudioUrl: 'https://example.com/referenced-audio.mp3'
      };
      
      const result = await mediaHandler.detectMedia(mockMessage, mockMessage.content, options);
      
      expect(result.hasFoundAudio).toBe(true);
      expect(result.audioUrl).toBe('https://example.com/referenced-audio.mp3');
      expect(result.useReferencedMedia).toBe(true);
      
      // Check that the default prompt is used for referenced audio
      if (Array.isArray(result.messageContent)) {
        const textItem = result.messageContent.find(item => item.type === 'text');
        expect(textItem.text).toContain('from the referenced message');
      }
    });
    
    it('should handle multimodal content arrays', async () => {
      const multimodalContent = [
        { type: 'text', text: 'What do you think about this?' }
      ];
      
      const mockMessage = createMockMessage();
      const options = {
        referencedImageUrl: 'https://example.com/referenced-image.jpg'
      };
      
      const result = await mediaHandler.detectMedia(mockMessage, multimodalContent, options);
      
      expect(result.hasFoundImage).toBe(true);
      expect(result.imageUrl).toBe('https://example.com/referenced-image.jpg');
      expect(result.useReferencedMedia).toBe(true);
      
      // Check that the original text is preserved
      if (Array.isArray(result.messageContent)) {
        const textItem = result.messageContent.find(item => item.type === 'text');
        expect(textItem.text).toBe('What do you think about this?');
        
        const imageItem = result.messageContent.find(item => item.type === 'image_url');
        expect(imageItem).toBeDefined();
        expect(imageItem.image_url.url).toBe('https://example.com/referenced-image.jpg');
      }
    });
  });
  
  describe('processMediaForWebhook', () => {
    it('should delegate to utils/mediaHandler.processMediaUrls', async () => {
      const mockContent = 'Test content with [Image: https://example.com/image.jpg]';
      const mockResult = { 
        content: 'Test content', 
        attachments: [{ attachment: 'https://example.com/image.jpg' }] 
      };
      
      utilsMediaHandler.processMediaUrls.mockResolvedValue(mockResult);
      
      const result = await mediaHandler.processMediaForWebhook(mockContent);
      
      expect(utilsMediaHandler.processMediaUrls).toHaveBeenCalledWith(mockContent);
      expect(result).toEqual(mockResult);
    });
  });
  
  describe('prepareAttachmentOptions', () => {
    it('should delegate to utils/mediaHandler.prepareAttachmentOptions', () => {
      const mockAttachments = [
        { attachment: 'https://example.com/file.jpg', name: 'file.jpg', contentType: 'image/jpeg' }
      ];
      const mockResult = { files: mockAttachments };
      
      utilsMediaHandler.prepareAttachmentOptions.mockReturnValue(mockResult);
      
      const result = mediaHandler.prepareAttachmentOptions(mockAttachments);
      
      expect(utilsMediaHandler.prepareAttachmentOptions).toHaveBeenCalledWith(mockAttachments);
      expect(result).toEqual(mockResult);
    });
  });
});