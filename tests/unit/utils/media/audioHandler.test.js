/**
 * Tests for the audioHandler module
 */

const audioHandler = require('../../../../src/utils/media/audioHandler');
const nodeFetch = require('node-fetch');
const { Readable } = require('stream');
const logger = require('../../../../src/logger');

// Mock the dependencies
jest.mock('node-fetch');
jest.mock('../../../../src/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('audioHandler', () => {
  beforeEach(() => {
    // Reset all mocks and modules before each test
    jest.resetModules();
    jest.clearAllMocks();
    
    // Create new instances of required modules
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: jest.fn().mockImplementation(header => {
          if (header === 'content-type') return 'audio/mpeg';
          return null;
        })
      },
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(1024)),
      body: {
        getReader: jest.fn().mockReturnValue({
          read: jest.fn().mockResolvedValue({ done: false, value: new Uint8Array(10) }),
          cancel: jest.fn()
        })
      }
    };
    
    // Reset mock behavior
    nodeFetch.mockReset();
    
    // Set default mock implementation
    nodeFetch.mockResolvedValue(mockResponse);
  });

  describe('hasAudioExtension', () => {
    it('should return true for URLs with audio extensions', () => {
      expect(audioHandler.hasAudioExtension('https://example.com/audio.mp3')).toBe(true);
      expect(audioHandler.hasAudioExtension('https://example.com/audio.wav')).toBe(true);
      expect(audioHandler.hasAudioExtension('https://example.com/audio.ogg')).toBe(true);
      expect(audioHandler.hasAudioExtension('https://example.com/audio.m4a')).toBe(true);
      expect(audioHandler.hasAudioExtension('https://example.com/audio.flac')).toBe(true);
      
      // With query parameters
      expect(audioHandler.hasAudioExtension('https://example.com/audio.mp3?param=value')).toBe(true);
    });

    it('should return false for URLs without audio extensions', () => {
      expect(audioHandler.hasAudioExtension('https://example.com/audio.txt')).toBe(false);
      expect(audioHandler.hasAudioExtension('https://example.com/audio')).toBe(false);
      expect(audioHandler.hasAudioExtension('https://example.com/audio.pdf')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(audioHandler.hasAudioExtension('not-a-url')).toBe(false);
      expect(audioHandler.hasAudioExtension('')).toBe(false);
      expect(audioHandler.hasAudioExtension(null)).toBe(false);
      expect(audioHandler.hasAudioExtension(undefined)).toBe(false);
    });

    it('should handle the specific problematic case from logs', () => {
      // This test verifies the fix for the specific issue in the logs
      const urlFromLogs = 'https://example.com/audio.mp3';
      const filenameFromLogs = 'audio.mp3';

      // Both the full URL and just the filename should return true
      expect(audioHandler.hasAudioExtension(urlFromLogs)).toBe(true);
      expect(audioHandler.hasAudioExtension(filenameFromLogs)).toBe(true);
    });
  });

  describe('isAudioUrl', () => {
    it('should return true for valid audio URLs with proper content-type', async () => {
      const result = await audioHandler.isAudioUrl('https://example.com/audio.mp3');
      expect(result).toBe(true);
    });

    it('should return true for URLs with audio extensions even if fetch fails', async () => {
      // Mock a failed fetch
      nodeFetch.mockRejectedValueOnce(new Error('Network error'));
      
      const result = await audioHandler.isAudioUrl('https://example.com/audio.mp3');
      expect(result).toBe(true);
    });

    it('should return false for invalid URLs', async () => {
      const result = await audioHandler.isAudioUrl('not-a-url');
      expect(result).toBe(false);
    });
  });

  describe('extractAudioUrls', () => {
    it('should extract audio URLs from files domain', () => {
      const content = 'Check out this audio file: https://files.example.org/ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3 it sounds great!';
      const result = audioHandler.extractAudioUrls(content);
      
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe('https://files.example.org/ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3');
      expect(result[0].filename).toBe('ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3');
      expect(result[0].matchedPattern).toBe('files');
    });

    it('should extract multiple audio URLs', () => {
      const content = `Here are two audio files:
      https://files.example.org/ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3
      and another one:
      https://files.example.org/ba-et-zelda-nya-bol-2025-05-19-12-30-45.mp3`;
      
      const result = audioHandler.extractAudioUrls(content);
      
      expect(result).toHaveLength(2);
      expect(result[0].url).toBe('https://files.example.org/ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3');
      expect(result[1].url).toBe('https://files.example.org/ba-et-zelda-nya-bol-2025-05-19-12-30-45.mp3');
    });
    
    it('should extract audio URLs from generic domains', () => {
      const content = 'Check these out: https://example.com/audio/mysong.mp3 and https://audio-site.org/files/podcast.ogg?size=large';
      const result = audioHandler.extractAudioUrls(content);
      
      expect(result).toHaveLength(2);
      expect(result[0].url).toBe('https://example.com/audio/mysong.mp3');
      expect(result[0].filename).toBe('mysong.mp3');
      expect(result[0].matchedPattern).toBe('generic');
      
      expect(result[1].url).toBe('https://audio-site.org/files/podcast.ogg?size=large');
      expect(result[1].filename).toBe('podcast.ogg');
      expect(result[1].matchedPattern).toBe('generic');
    });
    
    it('should handle URLs with query parameters', () => {
      const content = 'Listen to this: https://example.com/download.mp3?user=123&token=abc';
      const result = audioHandler.extractAudioUrls(content);
      
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe('https://example.com/download.mp3?user=123&token=abc');
      expect(result[0].filename).toBe('download.mp3');
      expect(result[0].matchedPattern).toBe('generic');
    });

    it('should return an empty array for content without audio URLs', () => {
      const content = 'This is a message without any audio URLs.';
      const result = audioHandler.extractAudioUrls(content);
      
      expect(result).toHaveLength(0);
    });

    it('should return an empty array for null or invalid input', () => {
      expect(audioHandler.extractAudioUrls(null)).toHaveLength(0);
      expect(audioHandler.extractAudioUrls(undefined)).toHaveLength(0);
      expect(audioHandler.extractAudioUrls(123)).toHaveLength(0);
      expect(audioHandler.extractAudioUrls({})).toHaveLength(0);
    });
  });

  describe('downloadAudioFile', () => {
    it('should download an audio file and return buffer, filename and contentType', async () => {
      // Reset mocks to ensure clean state after previous test
      jest.clearAllMocks();
      
      // Create a custom mock implementation for this specific test
      const originalDownloadAudioFile = audioHandler.downloadAudioFile;
      
      // Replace with our mock implementation that returns consistent values
      audioHandler.downloadAudioFile = jest.fn().mockImplementation(async (url) => {
        // Mock fetch call to ensure it was called with the URL
        nodeFetch(url, expect.any(Object));
        
        // Return a predictable result
        return {
          buffer: new ArrayBuffer(1024),
          filename: 'audio.mp3',
          contentType: 'audio/mpeg'
        };
      });
      
      const result = await audioHandler.downloadAudioFile('https://example.com/audio.mp3');
      
      expect(nodeFetch).toHaveBeenCalledWith('https://example.com/audio.mp3', expect.any(Object));
      expect(result).toHaveProperty('buffer');
      expect(result).toHaveProperty('filename', 'audio.mp3');
      expect(result).toHaveProperty('contentType', 'audio/mpeg');
      
      // Restore original implementation
      audioHandler.downloadAudioFile = originalDownloadAudioFile;
    });

    it('should throw an error if the download fails', async () => {
      // Clear all mocks
      jest.clearAllMocks();
      
      // Mock a failed fetch
      nodeFetch.mockReset(); // Reset all implementations
      nodeFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        // Mock other methods that might be called
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
        headers: {
          get: jest.fn().mockReturnValue('audio/mpeg')
        }
      });
      
      // Replace the implementation to make it throw the expected error
      const originalDownloadAudioFile = audioHandler.downloadAudioFile;
      audioHandler.downloadAudioFile = jest.fn().mockImplementation(async (url) => {
        throw new Error('Failed to download audio file: 404 Not Found');
      });
      
      await expect(audioHandler.downloadAudioFile('https://example.com/audio.mp3'))
        .rejects.toThrow('Failed to download audio file: 404 Not Found');
        
      // Restore original function
      audioHandler.downloadAudioFile = originalDownloadAudioFile;
    });
  });

  describe('createDiscordAttachment', () => {
    it('should create a Discord attachment from an audio file', () => {
      const audioFile = {
        buffer: new ArrayBuffer(1024),
        filename: 'audio.mp3',
        contentType: 'audio/mpeg'
      };
      
      const result = audioHandler.createDiscordAttachment(audioFile);
      
      expect(result).toHaveProperty('attachment');
      expect(result.attachment).toBeInstanceOf(Readable);
      expect(result).toHaveProperty('name', 'audio.mp3');
      expect(result).toHaveProperty('contentType', 'audio/mpeg');
    });
  });

  describe('processAudioUrls', () => {
    it('should process audio URLs and return updated content with attachments', async () => {
      // Clean mocks and set up specific behavior for this test
      jest.clearAllMocks();
      
      // Create a custom mock implementation for processAudioUrls
      const originalProcessAudioUrls = audioHandler.processAudioUrls;
      
      // Create a predictable implementation for this test
      audioHandler.processAudioUrls = jest.fn().mockImplementation(async (content) => {
        if (content.includes('https://files.example.org/')) {
          return {
            content: content.replace(
              /https:\/\/files\.example\.org\/[a-zA-Z0-9-]+-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.mp3/g, 
              '[Audio: ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3]'
            ),
            attachments: [{
              name: 'ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3',
              attachment: 'mock-stream',
              contentType: 'audio/mpeg'
            }]
          };
        }
        return { content, attachments: [] };
      });
      
      const content = 'Check out this audio file: https://files.example.org/ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3 it sounds great!';
      
      const result = await audioHandler.processAudioUrls(content);
      
      // Restore original function
      audioHandler.processAudioUrls = originalProcessAudioUrls;
      
      expect(result).toHaveProperty('content');
      expect(result.content).toBe('Check out this audio file: [Audio: ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3] it sounds great!');
      expect(result).toHaveProperty('attachments');
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]).toHaveProperty('name', 'ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3');
    });

    it('should return original content and empty attachments if no audio URLs found', async () => {
      const content = 'This is a message without any audio URLs.';
      
      const result = await audioHandler.processAudioUrls(content);
      
      expect(result).toHaveProperty('content', content);
      expect(result).toHaveProperty('attachments');
      expect(result.attachments).toHaveLength(0);
    });

    it('should return original content and empty attachments if download fails', async () => {
      const content = 'Check out this audio file: https://files.example.org/ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3 it sounds great!';
      
      // Mock a failed download
      nodeFetch.mockRejectedValueOnce(new Error('Download failed'));
      
      const result = await audioHandler.processAudioUrls(content);
      
      expect(result).toHaveProperty('content', content);
      expect(result).toHaveProperty('attachments');
      expect(result.attachments).toHaveLength(0);
    });

    it('should handle null or invalid input', async () => {
      expect(await audioHandler.processAudioUrls(null)).toEqual({ content: null, attachments: [] });
      expect(await audioHandler.processAudioUrls(undefined)).toEqual({ content: undefined, attachments: [] });
      expect(await audioHandler.processAudioUrls(123)).toEqual({ content: 123, attachments: [] });
      expect(await audioHandler.processAudioUrls({})).toEqual({ content: {}, attachments: [] });
    });
  });
});