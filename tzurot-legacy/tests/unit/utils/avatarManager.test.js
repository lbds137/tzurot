// Mock dependencies first before any imports
jest.mock('../../../src/logger');
jest.mock('../../../src/utils/errorTracker');
jest.mock('../../../src/utils/urlValidator');
jest.mock('node-fetch');
jest.mock('../../../src/profileInfoFetcher', () => ({
  getProfileAvatarUrl: jest.fn(),
}));

const avatarManager = require('../../../src/utils/avatarManager');
const logger = require('../../../src/logger');
const errorTracker = require('../../../src/utils/errorTracker');
const urlValidator = require('../../../src/utils/urlValidator');
const fetch = require('node-fetch');

describe('Avatar Manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    avatarManager.clearAvatarCache();
  });

  describe('validateAvatarUrl', () => {
    it('should return false for empty URL', async () => {
      const result = await avatarManager.validateAvatarUrl('');
      expect(result).toBe(false);
    });

    it('should return false for null URL', async () => {
      const result = await avatarManager.validateAvatarUrl(null);
      expect(result).toBe(false);
    });

    it('should return false for invalid URL format', async () => {
      urlValidator.isValidUrlFormat.mockReturnValue(false);

      const result = await avatarManager.validateAvatarUrl('not-a-url');

      expect(result).toBe(false);
      expect(urlValidator.isValidUrlFormat).toHaveBeenCalledWith('not-a-url');
    });

    it('should return true for Discord CDN URLs without validation', async () => {
      urlValidator.isValidUrlFormat.mockReturnValue(true);
      urlValidator.isTrustedDomain.mockReturnValue(true);

      const result = await avatarManager.validateAvatarUrl('https://cdn.discordapp.com/avatar.png');

      expect(result).toBe(true);
      expect(urlValidator.isImageUrl).not.toHaveBeenCalled();
    });

    it('should validate non-Discord URLs', async () => {
      urlValidator.isValidUrlFormat.mockReturnValue(true);
      urlValidator.isTrustedDomain.mockReturnValue(false);
      urlValidator.isImageUrl.mockResolvedValue(true);

      const result = await avatarManager.validateAvatarUrl('https://example.com/avatar.png');

      expect(result).toBe(true);
      expect(urlValidator.isImageUrl).toHaveBeenCalledWith('https://example.com/avatar.png', {
        timeout: 5000,
        trustExtensions: true,
      });
    });

    it('should track errors for invalid images', async () => {
      urlValidator.isValidUrlFormat.mockReturnValue(true);
      urlValidator.isTrustedDomain.mockReturnValue(false);
      urlValidator.isImageUrl.mockResolvedValue(false);

      const result = await avatarManager.validateAvatarUrl('https://example.com/not-image.txt');

      expect(result).toBe(false);
      expect(errorTracker.trackError).toHaveBeenCalled();
    });

    it('should trust URLs with image extensions on error', async () => {
      urlValidator.isValidUrlFormat.mockReturnValue(true);
      urlValidator.isTrustedDomain.mockReturnValue(false);
      urlValidator.isImageUrl.mockRejectedValue(new Error('Fetch failed'));
      urlValidator.hasImageExtension.mockReturnValue(true);

      const result = await avatarManager.validateAvatarUrl('https://example.com/avatar.png');

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        '[AvatarManager] URL appears to be an image based on extension, accepting despite errors: https://example.com/avatar.png'
      );
    });
  });

  describe('getValidAvatarUrl', () => {
    it('should return null for empty URL', async () => {
      const result = await avatarManager.getValidAvatarUrl('');
      expect(result).toBeNull();
    });

    it('should return URL if valid', async () => {
      // Mock the validateAvatarUrl to return true
      urlValidator.isValidUrlFormat.mockReturnValue(true);
      urlValidator.isTrustedDomain.mockReturnValue(false);
      urlValidator.isImageUrl.mockResolvedValue(true);

      const result = await avatarManager.getValidAvatarUrl('https://example.com/avatar.png');

      expect(result).toBe('https://example.com/avatar.png');
    });

    it('should return null if invalid', async () => {
      // Mock the validateAvatarUrl to return false
      urlValidator.isValidUrlFormat.mockReturnValue(true);
      urlValidator.isTrustedDomain.mockReturnValue(false);
      urlValidator.isImageUrl.mockResolvedValue(false);

      const result = await avatarManager.getValidAvatarUrl('https://example.com/invalid');

      expect(result).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        '[AvatarManager] Invalid avatar URL: https://example.com/invalid, returning null'
      );
    });
  });

  describe('warmupAvatarUrl', () => {
    it('should return null for empty URL', async () => {
      const result = await avatarManager.warmupAvatarUrl('');
      expect(result).toBeNull();
    });

    it('should return cached URL without fetching', async () => {
      const url = 'https://cdn.discordapp.com/avatar.png';
      // Pre-cache the URL by warming up a Discord CDN URL (which skips validation)
      await avatarManager.warmupAvatarUrl(url);
      jest.clearAllMocks();

      const result = await avatarManager.warmupAvatarUrl(url);

      expect(result).toBe(url);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should skip warmup for Discord CDN URLs', async () => {
      const url = 'https://cdn.discordapp.com/avatar.png';

      const result = await avatarManager.warmupAvatarUrl(url);

      expect(result).toBe(url);
      expect(fetch).not.toHaveBeenCalled();
      expect(avatarManager.isAvatarCached(url)).toBe(true);
    });

    it('should skip warmup for known domains with image extensions', async () => {
      const url = 'https://i.imgur.com/avatar.png';

      const result = await avatarManager.warmupAvatarUrl(url);

      expect(result).toBe(url);
      expect(fetch).not.toHaveBeenCalled();
      expect(avatarManager.isAvatarCached(url)).toBe(true);
    });

    it('should fetch and validate URL', async () => {
      // Setup validation mocks
      urlValidator.isValidUrlFormat.mockReturnValue(true);
      urlValidator.isTrustedDomain.mockReturnValue(false);
      urlValidator.isImageUrl.mockResolvedValue(true);

      const mockResponse = {
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('image/png'),
        },
        body: {
          getReader: jest.fn().mockReturnValue({
            read: jest.fn().mockResolvedValue({ done: false, value: new Uint8Array(100) }),
            cancel: jest.fn(),
          }),
        },
      };
      fetch.mockResolvedValue(mockResponse);

      const result = await avatarManager.warmupAvatarUrl('https://example.com/avatar.png');

      expect(result).toBe('https://example.com/avatar.png');
      expect(fetch).toHaveBeenCalled();
      expect(avatarManager.isAvatarCached('https://example.com/avatar.png')).toBe(true);
    });

    it('should handle non-OK response with image extension', async () => {
      jest
        .spyOn(avatarManager, 'getValidAvatarUrl')
        .mockResolvedValue('https://i.imgur.com/avatar.png');

      fetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      const result = await avatarManager.warmupAvatarUrl('https://i.imgur.com/avatar.png');

      expect(result).toBe('https://i.imgur.com/avatar.png');
      expect(avatarManager.isAvatarCached('https://i.imgur.com/avatar.png')).toBe(true);
    });

    it('should handle timeout errors gracefully', async () => {
      // Setup validation mocks
      urlValidator.isValidUrlFormat.mockReturnValue(true);
      urlValidator.isTrustedDomain.mockReturnValue(false);
      urlValidator.isImageUrl.mockResolvedValue(true);

      const timeoutError = new Error('Timeout');
      timeoutError.name = 'AbortError';
      fetch.mockRejectedValue(timeoutError);

      const result = await avatarManager.warmupAvatarUrl('https://example.com/avatar.png');

      expect(result).toBe('https://example.com/avatar.png');
      expect(logger.info).toHaveBeenCalledWith(
        '[AvatarManager] URL appears to be an image based on extension, accepting despite timeout: https://example.com/avatar.png'
      );
    });

    it('should retry on failure when URL becomes invalid', async () => {
      // Mock first to ensure it's in cache before test
      avatarManager.clearAvatarCache();

      // Setup URL validation mocks - valid first, then invalid after error, then valid again
      urlValidator.isValidUrlFormat.mockReturnValue(true);
      urlValidator.isTrustedDomain.mockReturnValue(false);
      urlValidator.hasImageExtension.mockReturnValue(false);
      urlValidator.isImageUrl
        .mockResolvedValueOnce(true) // Initial validation in getValidAvatarUrl
        .mockResolvedValueOnce(false) // After first fetch error
        .mockResolvedValueOnce(true); // On retry

      // First attempt fails, second succeeds
      fetch.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('image/png'),
        },
        body: {
          getReader: jest.fn().mockReturnValue({
            read: jest.fn().mockResolvedValue({ done: false, value: new Uint8Array(100) }),
            cancel: jest.fn(),
          }),
        },
      });

      const result = await avatarManager.warmupAvatarUrl('https://example.com/avatar', 1);

      expect(result).toBe('https://example.com/avatar');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should return null after retries exhausted', async () => {
      // Mock URL validation to return false
      urlValidator.isValidUrlFormat.mockReturnValue(true);
      urlValidator.isTrustedDomain.mockReturnValue(false);
      urlValidator.isImageUrl.mockResolvedValue(false);
      urlValidator.hasImageExtension.mockReturnValue(false);

      fetch.mockRejectedValue(new Error('Network error'));

      const result = await avatarManager.warmupAvatarUrl('https://example.com/avatar', 0);

      expect(result).toBeNull();
    });
  });

  describe('preloadPersonalityAvatar', () => {
    const { getProfileAvatarUrl } = require('../../../src/profileInfoFetcher');

    it('should handle null personality', async () => {
      await avatarManager.preloadPersonalityAvatar(null);

      expect(logger.error).toHaveBeenCalledWith(
        '[AvatarManager] Cannot preload avatar: personality object is null or undefined'
      );
    });

    it('should fetch avatar URL if not set', async () => {
      const personality = { fullName: 'TestUser', profile: {} };
      getProfileAvatarUrl.mockResolvedValue('https://example.com/fetched-avatar.png');

      // Mock warmup to succeed
      urlValidator.isValidUrlFormat.mockReturnValue(true);
      urlValidator.isTrustedDomain.mockReturnValue(false); // Not a trusted domain, so it will check isImageUrl
      urlValidator.hasImageExtension.mockReturnValue(true); // Has image extension
      urlValidator.isImageUrl.mockResolvedValue(true); // Valid image URL
      
      // Mock fetch for warmup
      fetch.mockResolvedValue({
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

      await avatarManager.preloadPersonalityAvatar(personality, 'user123');

      expect(getProfileAvatarUrl).toHaveBeenCalledWith('TestUser', 'user123');
      expect(personality.avatarUrl).toBe('https://example.com/fetched-avatar.png');
    });

    it('should handle fetch errors', async () => {
      const personality = { fullName: 'TestUser' };
      getProfileAvatarUrl.mockRejectedValue(new Error('Fetch failed'));

      await avatarManager.preloadPersonalityAvatar(personality);

      expect(personality.avatarUrl).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        '[AvatarManager] Error fetching avatar URL: Fetch failed'
      );
    });

    it('should warmup existing avatar URL', async () => {
      const personality = {
        fullName: 'TestUser',
        avatarUrl: 'https://example.com/avatar.png',
      };

      // Mock warmup to succeed
      urlValidator.isValidUrlFormat.mockReturnValue(true);
      urlValidator.isTrustedDomain.mockReturnValue(true);

      await avatarManager.preloadPersonalityAvatar(personality);

      expect(getProfileAvatarUrl).not.toHaveBeenCalled();
      expect(personality.avatarUrl).toBe('https://example.com/avatar.png');
    });

    it('should set avatar to null on warmup failure', async () => {
      const personality = {
        fullName: 'TestUser',
        avatarUrl: 'https://example.com/avatar.png',
      };

      // Mock warmup to fail
      urlValidator.isValidUrlFormat.mockReturnValue(true);
      urlValidator.isTrustedDomain.mockReturnValue(false);
      urlValidator.isImageUrl.mockResolvedValue(false);
      urlValidator.hasImageExtension.mockReturnValue(false);
      fetch.mockRejectedValue(new Error('Network error'));

      await avatarManager.preloadPersonalityAvatar(personality);

      expect(personality.avatarUrl).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        '[AvatarManager] Failed to pre-load avatar for TestUser'
      );
    });
  });

  describe('cache management', () => {
    it('should clear avatar cache', () => {
      // Directly test cache operations without warmup
      // Add some URLs to cache by warming up Discord CDN URLs (which skip validation)
      avatarManager.warmupAvatarUrl('https://cdn.discordapp.com/avatar1.png');
      avatarManager.warmupAvatarUrl('https://cdn.discordapp.com/avatar2.png');

      expect(avatarManager.getAvatarCacheSize()).toBe(2);

      avatarManager.clearAvatarCache();

      expect(avatarManager.getAvatarCacheSize()).toBe(0);
      expect(logger.info).toHaveBeenCalledWith('[AvatarManager] Avatar warmup cache cleared');
    });

    it('should check if avatar is cached', () => {
      const url = 'https://cdn.discordapp.com/avatar.png';

      expect(avatarManager.isAvatarCached(url)).toBe(false);

      // Warmup Discord CDN URL (skips validation)
      avatarManager.warmupAvatarUrl(url);

      expect(avatarManager.isAvatarCached(url)).toBe(true);
    });
  });
});
