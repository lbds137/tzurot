/**
 * Tests for the media handler utility
 */

const mediaHandler = require('../../src/utils/mediaHandler');
const audioHandler = require('../../src/utils/audioHandler');
const imageHandler = require('../../src/utils/imageHandler');

// Mock dependencies
jest.mock('../../src/logger');
jest.mock('../../src/utils/audioHandler');
jest.mock('../../src/utils/imageHandler');

describe('Media Handler', () => {
  beforeEach(() => {
    // Reset mocks
    audioHandler.processAudioUrls.mockReset();
    imageHandler.processImageUrls.mockReset();

    // Default mock implementations - no media found
    audioHandler.processAudioUrls.mockResolvedValue({
      content: 'Original content',
      attachments: []
    });

    imageHandler.processImageUrls.mockResolvedValue({
      content: 'Original content',
      attachments: []
    });
  });

  it('should process audio URLs first', async () => {
    // Setup to find an audio URL
    const mockAudioAttachment = { 
      attachment: Buffer.from('test audio'), 
      name: 'audio.mp3',
      contentType: 'audio/mpeg'
    };

    audioHandler.processAudioUrls.mockResolvedValue({
      content: 'Content with audio removed',
      attachments: [mockAudioAttachment]
    });

    const result = await mediaHandler.processMediaUrls('Message with audio: https://example.com/audio.mp3');

    // Verify audio handler was called
    expect(audioHandler.processAudioUrls).toHaveBeenCalledWith(
      'Message with audio: https://example.com/audio.mp3'
    );

    // Verify image handler wasn't called since audio was found
    expect(imageHandler.processImageUrls).not.toHaveBeenCalled();

    // Verify result
    expect(result.content).toBe('Content with audio removed');
    expect(result.attachments).toEqual([mockAudioAttachment]);
  });

  it('should process image URLs if no audio URLs found', async () => {
    // Setup to find an image URL
    const mockImageAttachment = { 
      attachment: Buffer.from('test image'), 
      name: 'image.jpg',
      contentType: 'image/jpeg'
    };

    imageHandler.processImageUrls.mockResolvedValue({
      content: 'Content with image removed',
      attachments: [mockImageAttachment]
    });

    const result = await mediaHandler.processMediaUrls('Message with image: https://example.com/image.jpg');

    // Verify audio handler was called and found nothing
    expect(audioHandler.processAudioUrls).toHaveBeenCalledWith(
      'Message with image: https://example.com/image.jpg'
    );

    // Verify image handler was called
    expect(imageHandler.processImageUrls).toHaveBeenCalledWith(
      'Message with image: https://example.com/image.jpg'
    );

    // Verify result
    expect(result.content).toBe('Content with image removed');
    expect(result.attachments).toEqual([mockImageAttachment]);
  });

  it('should return original content if no media found', async () => {
    const result = await mediaHandler.processMediaUrls('Message with no media links');

    expect(audioHandler.processAudioUrls).toHaveBeenCalled();
    expect(imageHandler.processImageUrls).toHaveBeenCalled();
    
    expect(result.content).toBe('Message with no media links');
    expect(result.attachments).toEqual([]);
  });

  it('should handle errors in media processing', async () => {
    // Make audio handler throw an error
    audioHandler.processAudioUrls.mockRejectedValue(new Error('Audio processing failed'));

    const result = await mediaHandler.processMediaUrls('Message with audio: https://example.com/audio.mp3');

    // Verify result contains original content
    expect(result.content).toBe('Message with audio: https://example.com/audio.mp3');
    expect(result.attachments).toEqual([]);
  });

  it('should prepare attachment options correctly', () => {
    const attachments = [
      {
        attachment: Buffer.from('test1'),
        name: 'file1.mp3',
        contentType: 'audio/mpeg'
      },
      {
        attachment: Buffer.from('test2'),
        name: 'file2.jpg',
        contentType: 'image/jpeg'
      }
    ];

    const result = mediaHandler.prepareAttachmentOptions(attachments);

    expect(result).toEqual({
      files: [
        {
          attachment: Buffer.from('test1'),
          name: 'file1.mp3',
          contentType: 'audio/mpeg'
        },
        {
          attachment: Buffer.from('test2'),
          name: 'file2.jpg',
          contentType: 'image/jpeg'
        }
      ]
    });
  });

  it('should return empty object if no attachments provided', () => {
    expect(mediaHandler.prepareAttachmentOptions([])).toEqual({});
    expect(mediaHandler.prepareAttachmentOptions(null)).toEqual({});
    expect(mediaHandler.prepareAttachmentOptions(undefined)).toEqual({});
  });
});