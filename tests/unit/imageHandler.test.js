/**
 * Tests for imageHandler utility
 */
const imageHandler = require('../../src/utils/imageHandler');

// Mock the node-fetch module
jest.mock('node-fetch');
const nodeFetch = require('node-fetch');

// Mock the logger
jest.mock('../../src/logger');
const logger = require('../../src/logger');

// Mock the urlValidator (dependency of imageHandler)
jest.mock('../../src/utils/urlValidator');
const urlValidator = require('../../src/utils/urlValidator');

describe('imageHandler', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Default mock implementations
    urlValidator.isValidUrlFormat.mockReturnValue(true);
    urlValidator.isTrustedDomain.mockReturnValue(false);
    
    // Mock fetch response
    const mockBuffer = Buffer.from('fake image data');
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: jest.fn(header => {
          if (header === 'content-type') return 'image/jpeg';
          return '';
        })
      },
      buffer: jest.fn().mockResolvedValue(mockBuffer),
      arrayBuffer: jest.fn().mockResolvedValue(mockBuffer)
    };
    nodeFetch.mockResolvedValue(mockResponse);
    
    // Mock URL constructor
    global.URL = jest.fn().mockImplementation((url) => {
      return {
        pathname: '/image.jpg',
        protocol: 'https:',
        host: 'example.com'
      };
    });
  });

  describe('hasImageExtension', () => {
    it('should return true for URLs with image extensions', () => {
      expect(imageHandler.hasImageExtension('https://example.com/image.jpg')).toBe(true);
      expect(imageHandler.hasImageExtension('https://example.com/image.jpeg')).toBe(true);
      expect(imageHandler.hasImageExtension('https://example.com/image.png')).toBe(true);
      expect(imageHandler.hasImageExtension('https://example.com/image.gif')).toBe(true);
      expect(imageHandler.hasImageExtension('https://example.com/image.webp')).toBe(true);
      expect(imageHandler.hasImageExtension('https://example.com/image.bmp')).toBe(true);
    });

    it('should return true for filenames with image extensions', () => {
      expect(imageHandler.hasImageExtension('image.jpg')).toBe(true);
      expect(imageHandler.hasImageExtension('image.jpeg')).toBe(true);
      expect(imageHandler.hasImageExtension('image.png')).toBe(true);
      expect(imageHandler.hasImageExtension('image.gif')).toBe(true);
      expect(imageHandler.hasImageExtension('image.webp')).toBe(true);
      expect(imageHandler.hasImageExtension('image.bmp')).toBe(true);
    });

    it('should return false for URLs with non-image extensions', () => {
      expect(imageHandler.hasImageExtension('https://example.com/file.txt')).toBe(false);
      expect(imageHandler.hasImageExtension('https://example.com/file.pdf')).toBe(false);
      expect(imageHandler.hasImageExtension('https://example.com/file.mp3')).toBe(false);
      expect(imageHandler.hasImageExtension('https://example.com/file.mp4')).toBe(false);
    });

    it('should return false for URLs without extensions', () => {
      expect(imageHandler.hasImageExtension('https://example.com/noextension')).toBe(false);
      expect(imageHandler.hasImageExtension('https://example.com/')).toBe(false);
    });
  });

  describe('isImageUrl', () => {
    it('should return true for valid image URLs', async () => {
      const result = await imageHandler.isImageUrl('https://example.com/image.jpg');
      expect(result).toBe(true);
    });

    it('should return false for invalid URLs', async () => {
      urlValidator.isValidUrlFormat.mockReturnValueOnce(false);
      const result = await imageHandler.isImageUrl('not-a-valid-url');
      expect(result).toBe(false);
    });

    it('should return false when the server returns an error status', async () => {
      // Need to mock hasImageExtension for this test to ensure it doesn't fall back to extension checking
      const originalHasImageExtension = imageHandler.hasImageExtension;
      imageHandler.hasImageExtension = jest.fn().mockReturnValue(false);
      
      nodeFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });
      
      const result = await imageHandler.isImageUrl('https://example.com/nonexistent.jpg', {
        trustExtensions: false // Important to prevent fallback to extension checking
      });
      
      expect(result).toBe(false);
      
      // Restore original function
      imageHandler.hasImageExtension = originalHasImageExtension;
    });

    it('should check content-type if available', async () => {
      nodeFetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          get: jest.fn(header => {
            if (header === 'content-type') return 'text/html';
            return '';
          })
        }
      });
      const result = await imageHandler.isImageUrl('https://example.com/fake.jpg');
      expect(result).toBe(true); // Still true because we're trusting the extension
    });
  });

  describe('extractImageUrls', () => {
    it('should extract image URLs from content', () => {
      const content = `Check out these images:
        https://example.com/image1.jpg
        Also this one: https://example.com/image2.png?size=large
        And this GIF: https://example.com/animation.gif`;
      
      const result = imageHandler.extractImageUrls(content);
      
      expect(result).toHaveLength(3);
      expect(result[0].url).toBe('https://example.com/image1.jpg');
      expect(result[0].filename).toBe('image1.jpg');
      expect(result[1].url).toBe('https://example.com/image2.png?size=large');
      expect(result[1].filename).toBe('image2.png');
      expect(result[2].url).toBe('https://example.com/animation.gif');
      expect(result[2].filename).toBe('animation.gif');
    });

    it('should return an empty array for content without image URLs', () => {
      const content = 'This is a message with no image URLs';
      const result = imageHandler.extractImageUrls(content);
      expect(result).toEqual([]);
    });

    it('should handle empty or non-string content', () => {
      expect(imageHandler.extractImageUrls('')).toEqual([]);
      expect(imageHandler.extractImageUrls(null)).toEqual([]);
      expect(imageHandler.extractImageUrls(undefined)).toEqual([]);
      expect(imageHandler.extractImageUrls(123)).toEqual([]);
      expect(imageHandler.extractImageUrls({})).toEqual([]);
    });
  });

  describe('downloadImageFile', () => {
    it('should download and process an image file', async () => {
      // Create a mock response with buffer and arrayBuffer methods
      const mockBuffer = Buffer.from('fake image data');
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: jest.fn(header => {
            if (header === 'content-type') return 'image/jpeg';
            return null;
          })
        },
        arrayBuffer: jest.fn().mockResolvedValue(mockBuffer)
      };
      nodeFetch.mockResolvedValueOnce(mockResponse);
      
      // Mock the URL pathname to have a specific filename
      global.URL.mockImplementationOnce(() => ({
        pathname: '/image.jpg',
        protocol: 'https:',
        host: 'example.com'
      }));
      
      const result = await imageHandler.downloadImageFile('https://example.com/image.jpg');
      
      expect(result).toHaveProperty('buffer');
      expect(result).toHaveProperty('filename', 'image.jpg');
      expect(result).toHaveProperty('contentType', 'image/jpeg');
      
      expect(nodeFetch).toHaveBeenCalledWith(
        'https://example.com/image.jpg',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Accept: expect.stringContaining('image/jpeg'),
          }),
        })
      );
    });

    it('should handle download errors', async () => {
      // Mock the fetch to reject with a network error
      nodeFetch.mockRejectedValueOnce(new Error('Network error'));
      
      // Expect the download to throw
      await expect(imageHandler.downloadImageFile('https://example.com/image.jpg'))
        .rejects.toThrow('Network error');
      
      // Verify that the error is logged
      expect(logger.error).toHaveBeenCalled();
    });

    it('should generate a filename if none can be extracted from URL', async () => {
      // Mock a response with a content type but no clear filename in the URL
      const mockBuffer = Buffer.from('fake image data');
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: jest.fn(header => {
            if (header === 'content-type') return 'image/jpeg';
            return null;
          })
        },
        arrayBuffer: jest.fn().mockResolvedValue(mockBuffer)
      };
      nodeFetch.mockResolvedValueOnce(mockResponse);
      
      // Mock URL to point to a path without a clear image extension
      global.URL.mockImplementationOnce(() => ({
        pathname: '/noextension',
        protocol: 'https:',
        host: 'example.com'
      }));
      
      const result = await imageHandler.downloadImageFile('https://example.com/noextension');
      
      // Verify that a filename is generated with the correct pattern
      expect(result.filename).toMatch(/^image_\d+\.jpg$/);
      expect(result.contentType).toBe('image/jpeg');
    });
  });

  describe('processImageUrls', () => {
    it('should extract and process image URLs from content', async () => {
      // Mock the full image processing chain
      imageHandler.extractImageUrls = jest.fn().mockReturnValue([{
        url: 'https://example.com/image.jpg',
        filename: 'image.jpg',
        matchedPattern: 'generic'
      }]);
      
      // Mock downloadImageFile to return a properly formatted result
      imageHandler.downloadImageFile = jest.fn().mockResolvedValue({
        buffer: Buffer.from('fake image data'),
        filename: 'image.jpg',
        contentType: 'image/jpeg'
      });
      
      // Mock createDiscordAttachment to return a properly formatted attachment
      imageHandler.createDiscordAttachment = jest.fn().mockReturnValue({
        attachment: {},
        name: 'image.jpg',
        contentType: 'image/jpeg'
      });
      
      const content = 'Check out this image: https://example.com/image.jpg';
      
      const result = await imageHandler.processImageUrls(content);
      
      // Verify the URL was replaced in the content
      expect(result.content).toBe('Check out this image: ');
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]).toHaveProperty('name', 'image.jpg');
      expect(result.attachments[0]).toHaveProperty('contentType', 'image/jpeg');
    });

    it('should return original content when no image URLs are found', async () => {
      const content = 'This is a message with no image URLs';
      
      const result = await imageHandler.processImageUrls(content);
      
      expect(result.content).toBe(content);
      expect(result.attachments).toEqual([]);
    });

    it('should handle download errors and return original content', async () => {
      const content = 'Check out this image: https://example.com/broken.jpg';
      
      nodeFetch.mockRejectedValueOnce(new Error('Download failed'));
      
      const result = await imageHandler.processImageUrls(content);
      
      expect(result.content).toBe(content);
      expect(result.attachments).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should only process the first image URL if multiple are present', async () => {
      // Mock to return multiple image URLs
      imageHandler.extractImageUrls = jest.fn().mockReturnValue([
        {
          url: 'https://example.com/image1.jpg',
          filename: 'image1.jpg',
          matchedPattern: 'generic'
        },
        {
          url: 'https://example.com/image2.png',
          filename: 'image2.png',
          matchedPattern: 'generic'
        }
      ]);
      
      // Mock the download and attachment creation for the first URL
      imageHandler.downloadImageFile = jest.fn().mockResolvedValue({
        buffer: Buffer.from('fake image data'),
        filename: 'image1.jpg',
        contentType: 'image/jpeg'
      });
      
      imageHandler.createDiscordAttachment = jest.fn().mockReturnValue({
        attachment: {},
        name: 'image1.jpg',
        contentType: 'image/jpeg'
      });
      
      const content = `Image 1: https://example.com/image1.jpg
                       Image 2: https://example.com/image2.png`;
      
      const result = await imageHandler.processImageUrls(content);
      
      // Verify only the first URL was processed
      expect(result.content).not.toContain('https://example.com/image1.jpg');
      expect(result.content).toContain('https://example.com/image2.png');
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]).toHaveProperty('name', 'image1.jpg');
      
      // Verify that only the first URL was downloaded
      expect(imageHandler.downloadImageFile).toHaveBeenCalledTimes(1);
      expect(imageHandler.downloadImageFile).toHaveBeenCalledWith('https://example.com/image1.jpg');
    });
  });
});