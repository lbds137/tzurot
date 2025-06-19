/**
 * Tests for the audioHandler module
 */

const audioHandler = require('../../../../src/utils/media/audioHandler');
const nodeFetch = require('node-fetch');
const logger = require('../../../../src/logger');
const urlValidator = require('../../../../src/utils/urlValidator');
const { Readable } = require('stream');

// Mock the dependencies
jest.mock('node-fetch');
jest.mock('../../../../src/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));
jest.mock('../../../../src/utils/urlValidator');

describe('audioHandler', () => {
  beforeEach(() => {
    // Reset all mocks and modules before each test
    jest.resetModules();
    jest.clearAllMocks();

    // Set default mock behavior for urlValidator
    urlValidator.isValidUrlFormat.mockReturnValue(true);

    // Create new instances of required modules
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: jest.fn().mockImplementation(header => {
          if (header === 'content-type') return 'audio/mpeg';
          return null;
        }),
      },
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(1024)),
      body: {
        on: jest.fn(),
        pipe: jest.fn(),
      },
    };

    // Setup node-fetch mock
    nodeFetch.mockResolvedValue(mockResponse);
  });

  describe('hasAudioExtension', () => {
    it('should return true for valid audio extensions', () => {
      expect(audioHandler.hasAudioExtension('song.mp3')).toBe(true);
      expect(audioHandler.hasAudioExtension('audio.wav')).toBe(true);
      expect(audioHandler.hasAudioExtension('track.ogg')).toBe(true);
      expect(audioHandler.hasAudioExtension('music.m4a')).toBe(true);
      expect(audioHandler.hasAudioExtension('audio.flac')).toBe(true);
      expect(audioHandler.hasAudioExtension('SONG.MP3')).toBe(true); // Case insensitive
    });

    it('should return true for URLs with audio extensions', () => {
      expect(audioHandler.hasAudioExtension('https://example.com/song.mp3')).toBe(true);
      expect(audioHandler.hasAudioExtension('http://example.com/path/to/audio.wav')).toBe(true);
      expect(audioHandler.hasAudioExtension('https://example.com/file.mp3?query=123')).toBe(true);
    });

    it('should return false for non-audio extensions', () => {
      expect(audioHandler.hasAudioExtension('document.pdf')).toBe(false);
      expect(audioHandler.hasAudioExtension('image.jpg')).toBe(false);
      expect(audioHandler.hasAudioExtension('video.mp4')).toBe(false);
      expect(audioHandler.hasAudioExtension('archive.zip')).toBe(false);
    });

    it('should return false for empty or invalid input', () => {
      expect(audioHandler.hasAudioExtension('')).toBe(false);
      expect(audioHandler.hasAudioExtension(null)).toBe(false);
      expect(audioHandler.hasAudioExtension(undefined)).toBe(false);
    });

    it('should return false for invalid URLs with audio extensions', () => {
      urlValidator.isValidUrlFormat.mockReturnValue(false);
      expect(audioHandler.hasAudioExtension('https://invalid url.mp3')).toBe(false);
    });
  });

  describe('isAudioUrl', () => {
    beforeEach(() => {
      urlValidator.isValidUrlFormat.mockReturnValue(true);
    });

    it('should return true for URLs with audio extensions when trustExtensions is true', async () => {
      const result = await audioHandler.isAudioUrl('https://example.com/song.mp3', {
        trustExtensions: true,
      });
      expect(result).toBe(true);
      expect(nodeFetch).not.toHaveBeenCalled(); // Should trust extension without fetching
    });

    it('should validate URL by fetching when trustExtensions is false', async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('audio/mpeg'),
        },
      };
      nodeFetch.mockResolvedValue(mockResponse);

      const result = await audioHandler.isAudioUrl('https://example.com/song.mp3', {
        trustExtensions: false,
      });

      expect(result).toBe(true);
      expect(nodeFetch).toHaveBeenCalledWith(
        'https://example.com/song.mp3',
        expect.objectContaining({
          method: 'HEAD',
        })
      );
    });

    it('should return false for invalid URL format', async () => {
      urlValidator.isValidUrlFormat.mockReturnValue(false);

      const result = await audioHandler.isAudioUrl('not a valid url');
      expect(result).toBe(false);
      expect(nodeFetch).not.toHaveBeenCalled();
    });

    it('should return false when server returns non-OK status', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
      };
      nodeFetch.mockResolvedValue(mockResponse);
      urlValidator.isValidUrlFormat.mockReturnValue(true);

      const result = await audioHandler.isAudioUrl('https://example.com/notfound.mp3', {
        trustExtensions: false,
      });
      expect(result).toBe(false);
    });

    it('should handle octet-stream content type', async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('application/octet-stream'),
        },
      };
      nodeFetch.mockResolvedValue(mockResponse);

      const result = await audioHandler.isAudioUrl('https://example.com/audio', {
        trustExtensions: false,
      });
      expect(result).toBe(true);
    });

    it('should return true for audio extension even with fetch error when trustExtensions is true', async () => {
      nodeFetch.mockRejectedValue(new Error('Network error'));

      const result = await audioHandler.isAudioUrl('https://example.com/song.mp3');
      expect(result).toBe(true); // Should trust extension despite error
    });

    it('should use injected timers for timeout', async () => {
      jest.useFakeTimers();
      const mockSetTimeout = jest.fn(globalThis.setTimeout);
      const mockClearTimeout = jest.fn(globalThis.clearTimeout);

      audioHandler.configureTimers({
        setTimeout: mockSetTimeout,
        clearTimeout: mockClearTimeout,
      });

      const mockResponse = {
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('audio/mpeg'),
        },
      };
      nodeFetch.mockResolvedValue(mockResponse);

      await audioHandler.isAudioUrl('https://example.com/test.mp3', { trustExtensions: false });

      expect(mockSetTimeout).toHaveBeenCalled();
      expect(mockClearTimeout).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('extractAudioUrls', () => {
    it('should extract audio URLs from text', () => {
      const content =
        'Check out this song: https://example.com/song.mp3 and this one https://example.com/track.wav';
      const result = audioHandler.extractAudioUrls(content);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        url: 'https://example.com/song.mp3',
        filename: 'song.mp3',
        matchedPattern: 'generic',
      });
      expect(result[1]).toEqual({
        url: 'https://example.com/track.wav',
        filename: 'track.wav',
        matchedPattern: 'generic',
      });
    });

    it('should handle URLs with query parameters', () => {
      const content = 'Listen to https://example.com/audio.mp3?id=123&token=abc';
      const result = audioHandler.extractAudioUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        url: 'https://example.com/audio.mp3?id=123&token=abc',
        filename: 'audio.mp3',
        matchedPattern: 'generic',
      });
    });

    it('should categorize Discord CDN URLs', () => {
      const content = 'Audio: https://cdn.discordapp.com/attachments/123/456/voice.mp3';
      const result = audioHandler.extractAudioUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0].matchedPattern).toBe('discord');
    });

    it('should categorize files domain URLs', () => {
      const content = 'Download: https://files.example.com/audio.mp3';
      const result = audioHandler.extractAudioUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0].matchedPattern).toBe('files');
    });

    it('should return empty array for no audio URLs', () => {
      const content = 'This text has no audio URLs, just some regular text.';
      const result = audioHandler.extractAudioUrls(content);

      expect(result).toHaveLength(0);
    });

    it('should handle empty or invalid input', () => {
      expect(audioHandler.extractAudioUrls('')).toEqual([]);
      expect(audioHandler.extractAudioUrls(null)).toEqual([]);
      expect(audioHandler.extractAudioUrls(undefined)).toEqual([]);
      expect(audioHandler.extractAudioUrls(123)).toEqual([]);
    });
  });

  describe('downloadAudioFile', () => {
    beforeEach(() => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: jest.fn().mockImplementation(header => {
            if (header === 'content-type') return 'audio/mpeg';
            return null;
          }),
        },
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(1024)),
      };
      nodeFetch.mockResolvedValue(mockResponse);
    });

    it('should download audio file successfully', async () => {
      const url = 'https://example.com/song.mp3';
      const result = await audioHandler.downloadAudioFile(url);

      expect(result).toHaveProperty('buffer');
      expect(result).toHaveProperty('filename', 'song.mp3');
      expect(result).toHaveProperty('contentType', 'audio/mpeg');
      expect(result.buffer).toBeInstanceOf(ArrayBuffer);

      expect(nodeFetch).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'User-Agent': expect.any(String),
            Accept: expect.stringContaining('audio/'),
          }),
        })
      );
    });

    it('should generate filename when URL has no extension', async () => {
      const url = 'https://example.com/audio';
      const result = await audioHandler.downloadAudioFile(url);

      expect(result.filename).toMatch(/^audio_\d+\.mp3$/);
    });

    it('should use appropriate extension based on content type', async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: jest.fn().mockImplementation(header => {
            if (header === 'content-type') return 'audio/ogg';
            return null;
          }),
        },
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(1024)),
      };
      nodeFetch.mockResolvedValue(mockResponse);

      const url = 'https://example.com/audio';
      const result = await audioHandler.downloadAudioFile(url);

      expect(result.filename).toMatch(/^audio_\d+\.ogg$/);
      expect(result.contentType).toBe('audio/ogg');
    });

    it('should handle download errors', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
      };
      nodeFetch.mockResolvedValue(mockResponse);

      await expect(
        audioHandler.downloadAudioFile('https://example.com/notfound.mp3')
      ).rejects.toThrow('Failed to download audio file: 404 Not Found');
    });

    it('should handle network errors', async () => {
      nodeFetch.mockRejectedValue(new Error('Network error'));

      await expect(audioHandler.downloadAudioFile('https://example.com/song.mp3')).rejects.toThrow(
        'Network error'
      );
    });

    it('should clean filename from query parameters', async () => {
      const url = 'https://example.com/song.mp3?token=abc123';
      const result = await audioHandler.downloadAudioFile(url);

      expect(result.filename).toBe('song.mp3');
    });

    it('should use injected timers for timeout', async () => {
      jest.useFakeTimers();
      const mockSetTimeout = jest.fn(globalThis.setTimeout);
      const mockClearTimeout = jest.fn(globalThis.clearTimeout);

      audioHandler.configureTimers({
        setTimeout: mockSetTimeout,
        clearTimeout: mockClearTimeout,
      });

      const mockResponse = {
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('audio/mpeg'),
        },
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(1024)),
      };
      nodeFetch.mockResolvedValue(mockResponse);

      await audioHandler.downloadAudioFile('https://example.com/test.mp3');

      expect(mockSetTimeout).toHaveBeenCalledWith(expect.any(Function), 30000);
      expect(mockClearTimeout).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('createDiscordAttachment', () => {
    it('should create a Discord attachment from an audio file', () => {
      const audioFile = {
        buffer: new ArrayBuffer(1024),
        filename: 'audio.mp3',
        contentType: 'audio/mpeg',
      };

      const result = audioHandler.createDiscordAttachment(audioFile);

      // createDiscordAttachment returns an object with stream, name, and contentType
      expect(result).toBeDefined();
      expect(result.attachment).toBeInstanceOf(Readable);
      expect(result.name).toBe('audio.mp3');
      expect(result.contentType).toBe('audio/mpeg');
    });

    it('should convert ArrayBuffer to Buffer correctly', () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      const audioFile = {
        buffer: testData.buffer,
        filename: 'test.mp3',
        contentType: 'audio/mpeg',
      };

      const result = audioHandler.createDiscordAttachment(audioFile);

      // Check that the stream contains the correct data
      const chunks = [];
      result.attachment.on('data', chunk => chunks.push(chunk));
      result.attachment.on('end', () => {
        const buffer = Buffer.concat(chunks);
        expect(buffer).toEqual(Buffer.from(testData));
      });
    });
  });

  describe('processAudioUrls', () => {
    beforeEach(() => {
      const mockResponse = {
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('audio/mpeg'),
        },
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(1024)),
      };
      nodeFetch.mockResolvedValue(mockResponse);
    });

    it('should process audio URLs and return updated content with attachments', async () => {
      const content =
        'Check out this audio file: https://cdn.discordapp.com/attachments/956701187273338941/1252372899048448020/ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3 it sounds great!';

      const result = await audioHandler.processAudioUrls(content);

      expect(result).toHaveProperty('content');
      // URL should be removed from content
      expect(result.content).toBe('Check out this audio file:  it sounds great!');
      expect(result).toHaveProperty('attachments');
      expect(result.attachments).toHaveLength(1);

      // Check attachment structure
      expect(result.attachments[0]).toHaveProperty('attachment');
      expect(result.attachments[0]).toHaveProperty(
        'name',
        'ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3'
      );
      expect(result.attachments[0]).toHaveProperty('contentType', 'audio/mpeg');

      // The attachment should be a Readable stream
      const attachment = result.attachments[0];
      expect(attachment.attachment).toBeInstanceOf(Readable);
      expect(attachment.name).toBe('ha-shem-keev-ima-rxk-2025-05-18-16-48-24.mp3');
      expect(attachment.contentType).toBe('audio/mpeg');
    });

    it('should return original content and empty attachments if no audio URLs found', async () => {
      const content = 'This is just plain text without any audio URLs.';

      const result = await audioHandler.processAudioUrls(content);

      expect(result.content).toBe(content);
      expect(result.attachments).toEqual([]);
    });

    it('should handle download errors gracefully', async () => {
      nodeFetch.mockRejectedValue(new Error('Download failed'));

      const content = 'Audio here: https://example.com/song.mp3';
      const result = await audioHandler.processAudioUrls(content);

      expect(result.content).toBe(content); // Original content preserved
      expect(result.attachments).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process audio URL')
      );
    });

    it('should process only the first audio URL', async () => {
      const content = 'First: https://example.com/song1.mp3 Second: https://example.com/song2.wav';

      const result = await audioHandler.processAudioUrls(content);

      expect(result.content).toBe('First:  Second: https://example.com/song2.wav');
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].name).toBe('song1.mp3');
    });

    it('should handle invalid input gracefully', async () => {
      expect(await audioHandler.processAudioUrls(null)).toEqual({ content: null, attachments: [] });
      expect(await audioHandler.processAudioUrls(undefined)).toEqual({
        content: undefined,
        attachments: [],
      });
      expect(await audioHandler.processAudioUrls('')).toEqual({ content: '', attachments: [] });
      expect(await audioHandler.processAudioUrls(123)).toEqual({ content: 123, attachments: [] });
    });
  });
});
