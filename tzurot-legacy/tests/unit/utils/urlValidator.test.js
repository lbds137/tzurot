const {
  isValidUrlFormat,
  isTrustedDomain,
  hasImageExtension,
  isImageUrl,
  configureTimers,
} = require('../../../src/utils/urlValidator');
const logger = require('../../../src/logger');
const nodeFetch = require('node-fetch');

// Mock the logger
jest.mock('../../../src/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

// Mock node-fetch
jest.mock('node-fetch', () => jest.fn());

describe('urlValidator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Configure urlValidator to use fake timers
    configureTimers({
      setTimeout: jest.fn((callback, delay) => {
        return global.setTimeout(callback, delay);
      }),
      clearTimeout: jest.fn(id => {
        return global.clearTimeout(id);
      }),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('isValidUrlFormat', () => {
    it('should return true for valid URLs', () => {
      const validUrls = [
        'https://example.com',
        'http://example.com',
        'https://example.com/path',
        'https://example.com/path?query=value',
        'https://example.com:8080/path',
        'ftp://example.com/file.txt',
      ];

      validUrls.forEach(url => {
        expect(isValidUrlFormat(url)).toBe(true);
      });
    });

    it('should return false for invalid URLs', () => {
      const invalidUrls = [
        null,
        undefined,
        '',
        'not a url',
        'example.com',
        'https://',
        '//example.com',
      ];

      invalidUrls.forEach(url => {
        expect(isValidUrlFormat(url)).toBe(false);
      });
    });

    it('should return true for javascript URLs', () => {
      // JavaScript URLs are technically valid URLs according to the URL constructor
      expect(isValidUrlFormat('javascript:alert("test")')).toBe(true);
    });

    it('should log warnings for invalid URLs', () => {
      isValidUrlFormat('invalid url');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[UrlValidator] Invalid URL format: invalid url')
      );
    });
  });

  describe('isTrustedDomain', () => {
    it('should return true for URLs from trusted domains', () => {
      const trustedDomains = ['example.com', 'trusted.org'];

      expect(isTrustedDomain('https://example.com/image.png', trustedDomains)).toBe(true);
      expect(isTrustedDomain('https://subdomain.example.com/path', trustedDomains)).toBe(true);
      expect(isTrustedDomain('http://trusted.org', trustedDomains)).toBe(true);
    });

    it('should return false for URLs not from trusted domains', () => {
      const trustedDomains = ['example.com', 'trusted.org'];

      expect(isTrustedDomain('https://untrusted.com/image.png', trustedDomains)).toBe(false);
      expect(isTrustedDomain('https://evil.net', trustedDomains)).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      const trustedDomains = ['example.com'];

      expect(isTrustedDomain('not a url', trustedDomains)).toBe(false);
      expect(isTrustedDomain('', trustedDomains)).toBe(false);
      expect(isTrustedDomain(null, trustedDomains)).toBe(false);
    });

    it('should return false if trusted domains list is invalid', () => {
      expect(isTrustedDomain('https://example.com', null)).toBe(false);
      expect(isTrustedDomain('https://example.com', undefined)).toBe(false);
      expect(isTrustedDomain('https://example.com', [])).toBe(false);
      expect(isTrustedDomain('https://example.com', 'not an array')).toBe(false);
    });
  });

  describe('hasImageExtension', () => {
    it('should return true for URLs with image extensions', () => {
      const imageUrls = [
        'https://example.com/image.png',
        'https://example.com/image.jpg',
        'https://example.com/image.jpeg',
        'https://example.com/image.gif',
        'https://example.com/image.webp',
        'https://example.com/image.PNG',
        'https://example.com/image.jpg?query=value',
        'https://example.com/path/to/image.jpeg?size=large&version=2',
      ];

      imageUrls.forEach(url => {
        expect(hasImageExtension(url)).toBe(true);
      });
    });

    it('should return false for URLs without image extensions', () => {
      const nonImageUrls = [
        'https://example.com/document.pdf',
        'https://example.com/video.mp4',
        'https://example.com/page.html',
        'https://example.com/script.js',
        'https://example.com/',
        'https://example.com/image',
        'https://example.com/fake.jpg.txt',
      ];

      nonImageUrls.forEach(url => {
        expect(hasImageExtension(url)).toBe(false);
      });
    });

    it('should return false for invalid URLs', () => {
      expect(hasImageExtension('not a url')).toBe(false);
      expect(hasImageExtension('')).toBe(false);
      expect(hasImageExtension(null)).toBe(false);
    });
  });

  describe('isImageUrl', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return false for invalid URL format', async () => {
      const result = await isImageUrl('not a url');
      expect(result).toBe(false);
    });

    it('should trust URLs with image extensions when trustExtensions is true', async () => {
      const result = await isImageUrl('https://example.com/image.png');

      expect(result).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('URL has image extension, trusting without validation')
      );
      expect(nodeFetch).not.toHaveBeenCalled();
    });

    it('should not trust URLs with image extensions when trustExtensions is false', async () => {
      nodeFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('image/png'),
        },
        body: {
          getReader: jest.fn().mockReturnValue({
            read: jest.fn().mockResolvedValue({ done: false, value: new Uint8Array([1, 2, 3]) }),
            cancel: jest.fn(),
          }),
        },
      });

      const result = await isImageUrl('https://example.com/image.png', { trustExtensions: false });

      expect(result).toBe(true);
      expect(nodeFetch).toHaveBeenCalled();
    });

    it('should trust URLs from default trusted domains', async () => {
      const trustedUrls = [
        'https://cdn.discordapp.com/attachments/123/456/image',
        'https://discord.com/assets/image',
        'https://media.discordapp.net/attachments/789/012/photo',
      ];

      for (const url of trustedUrls) {
        jest.clearAllMocks();

        // Test with default options - these URLs will be trusted
        const result = await isImageUrl(url);

        expect(result).toBe(true);
      }

      expect(nodeFetch).not.toHaveBeenCalled();
    });

    it('should use custom trusted domains when provided', async () => {
      const result = await isImageUrl('https://custom-domain.com/image', {
        trustedDomains: ['custom-domain.com'],
      });

      expect(result).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('URL is from trusted domain, skipping validation')
      );
      expect(nodeFetch).not.toHaveBeenCalled();
    });

    it('should validate untrusted URLs by fetching', async () => {
      nodeFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('image/jpeg'),
        },
        body: {
          getReader: jest.fn().mockReturnValue({
            read: jest
              .fn()
              .mockResolvedValue({ done: false, value: new Uint8Array([255, 216, 255]) }),
            cancel: jest.fn(),
          }),
        },
      });

      const result = await isImageUrl('https://untrusted.com/image', { trustExtensions: false });

      expect(result).toBe(true);
      expect(nodeFetch).toHaveBeenCalledWith(
        'https://untrusted.com/image',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'User-Agent': expect.any(String),
            Accept: expect.stringContaining('image/'),
          }),
        })
      );
    });

    it('should handle timeout properly', async () => {
      // Create an AbortController that we can control
      const mockAbortController = {
        abort: jest.fn(),
        signal: {},
      };
      jest.spyOn(global, 'AbortController').mockImplementation(() => mockAbortController);

      // Mock fetch to never resolve
      nodeFetch.mockImplementation(() => {
        // Simulate abort error when controller.abort() is called
        return Promise.reject(new Error('The user aborted a request.'));
      });

      const promise = isImageUrl('https://slow-server.com/image', {
        timeout: 1000,
        trustExtensions: false,
      });

      // Advance timers to trigger the timeout
      jest.advanceTimersByTime(1000);

      const result = await promise;

      expect(result).toBe(false);
      expect(mockAbortController.abort).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Error validating URL'));

      global.AbortController.mockRestore();
    });

    it('should return false for non-OK HTTP responses', async () => {
      nodeFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await isImageUrl('https://example.com/not-found', { trustExtensions: false });

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('URL returned non-OK status: 404')
      );
    });

    it('should return false for URLs without content-type header', async () => {
      nodeFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue(null),
        },
      });

      const result = await isImageUrl('https://example.com/no-content-type', {
        trustExtensions: false,
      });

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('URL has no content-type header')
      );
    });

    it('should return false for non-image content types', async () => {
      nodeFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('text/html'),
        },
      });

      const result = await isImageUrl('https://example.com/page.html', { trustExtensions: false });

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('URL does not point to an image: text/html')
      );
    });

    it('should accept application/octet-stream content type', async () => {
      nodeFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('application/octet-stream'),
        },
        body: {
          getReader: jest.fn().mockReturnValue({
            read: jest.fn().mockResolvedValue({ done: false, value: new Uint8Array([1, 2, 3]) }),
            cancel: jest.fn(),
          }),
        },
      });

      const result = await isImageUrl('https://example.com/binary-image', {
        trustExtensions: false,
      });

      expect(result).toBe(true);
    });

    it('should return false for empty response body', async () => {
      nodeFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('image/png'),
        },
        body: {
          getReader: jest.fn().mockReturnValue({
            read: jest.fn().mockResolvedValue({ done: true }),
            cancel: jest.fn(),
          }),
        },
      });

      const result = await isImageUrl('https://example.com/empty', { trustExtensions: false });

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('URL returned an empty response')
      );
    });

    it('should handle read errors gracefully', async () => {
      nodeFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('image/png'),
        },
        body: {
          getReader: jest.fn().mockReturnValue({
            read: jest.fn().mockRejectedValue(new Error('Read failed')),
            cancel: jest.fn(),
          }),
        },
      });

      const result = await isImageUrl('https://example.com/read-error', { trustExtensions: false });

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error reading response body: Read failed')
      );
    });

    it('should trust image extensions on fetch errors', async () => {
      nodeFetch.mockRejectedValue(new Error('Network error'));

      const result = await isImageUrl('https://example.com/image.jpg', { trustExtensions: false });

      expect(result).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error validating URL: Network error')
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          'URL appears to be an image based on extension, accepting despite errors'
        )
      );
    });

    it('should return false on fetch errors for non-image extensions', async () => {
      nodeFetch.mockRejectedValue(new Error('Network error'));

      const result = await isImageUrl('https://example.com/document.pdf', {
        trustExtensions: false,
      });

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error validating URL: Network error')
      );
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('should clear timeout on successful fetch', async () => {
      // Get the mock clearTimeout from our configured timers
      const mockTimers = {
        setTimeout: jest.fn((callback, delay) => global.setTimeout(callback, delay)),
        clearTimeout: jest.fn(id => global.clearTimeout(id)),
      };
      configureTimers(mockTimers);

      nodeFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('image/png'),
        },
        body: {
          getReader: jest.fn().mockReturnValue({
            read: jest.fn().mockResolvedValue({ done: false, value: new Uint8Array([1, 2, 3]) }),
            cancel: jest.fn(),
          }),
        },
      });

      await isImageUrl('https://example.com/image', { trustExtensions: false, timeout: 5000 });

      expect(mockTimers.clearTimeout).toHaveBeenCalled();
    });
  });
});
