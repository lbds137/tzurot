/**
 * Tests for profileInfoFetcher (Legacy Wrapper)
 *
 * This file tests the legacy profileInfoFetcher.js wrapper that provides
 * backward compatibility for the old API while using the new core system.
 *
 * Focus areas:
 * - URL validation and avatar handling (avatar vs avatar_url)
 * - Display name fallback logic
 * - Error handling and logging
 * - Wrapper logic without getting into implementation details
 */

// Mock external dependencies BEFORE any imports
jest.mock('../../src/logger');
jest.mock('../../src/utils/urlValidator');

// Create a mock ProfileInfoFetcher
const mockFetchProfileInfo = jest.fn();
const mockClearCache = jest.fn();
const mockGetCache = jest.fn().mockReturnValue(new Map());

jest.mock('../../src/core/api', () => ({
  ProfileInfoFetcher: jest.fn().mockImplementation(() => ({
    fetchProfileInfo: mockFetchProfileInfo,
    clearCache: mockClearCache,
    getCache: mockGetCache,
    client: { fetchImplementation: jest.fn() },
    rateLimiter: { enqueue: jest.fn() },
  })),
}));

// Import after mocks are set up
const logger = require('../../src/logger');
const urlValidator = require('../../src/utils/urlValidator');

// Test data
const mockProfileName = 'test-profile';

describe('profileInfoFetcher (Legacy Wrapper)', () => {
  let profileInfoFetcher;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock console methods to keep tests clean
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'debug').mockImplementation();

    // Mock logger methods
    logger.info = jest.fn();
    logger.debug = jest.fn();
    logger.warn = jest.fn();
    logger.error = jest.fn();

    // Mock urlValidator with default valid response
    urlValidator.isValidUrlFormat = jest.fn().mockReturnValue(true);

    // Set default mock behavior
    mockFetchProfileInfo.mockResolvedValue(null);

    // Import the module under test after mocks are set up
    delete require.cache[require.resolve('../../src/profileInfoFetcher')];
    profileInfoFetcher = require('../../src/profileInfoFetcher');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('module structure', () => {
    it('should export expected functions', () => {
      expect(typeof profileInfoFetcher.fetchProfileInfo).toBe('function');
      expect(typeof profileInfoFetcher.getProfileAvatarUrl).toBe('function');
      expect(typeof profileInfoFetcher.getProfileDisplayName).toBe('function');
      expect(typeof profileInfoFetcher._testing).toBe('object');
    });

    it('should export testing utilities', () => {
      expect(typeof profileInfoFetcher._testing.clearCache).toBe('function');
      expect(typeof profileInfoFetcher._testing.getCache).toBe('function');
      expect(typeof profileInfoFetcher._testing.setFetchImplementation).toBe('function');
      expect(typeof profileInfoFetcher._testing.getRateLimiter).toBe('function');
      expect(typeof profileInfoFetcher._testing.getFetcher).toBe('function');
      expect(typeof profileInfoFetcher._testing.resetFetcher).toBe('function');
    });
  });

  describe('getProfileAvatarUrl - URL processing logic', () => {
    it('should return avatar field when available and valid', async () => {
      // Arrange
      const profileWithAvatar = {
        id: '123',
        name: 'Test',
        avatar: 'https://new-api.com/avatar.png',
      };
      mockFetchProfileInfo.mockResolvedValue(profileWithAvatar);
      urlValidator.isValidUrlFormat.mockReturnValue(true);

      // Act
      const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);

      // Assert
      expect(result).toBe(profileWithAvatar.avatar);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using avatar directly from API response')
      );
    });

    it('should return avatar_url field when avatar not available', async () => {
      // Arrange
      const profileWithAvatarUrl = {
        id: '123',
        name: 'Test',
        avatar_url: 'https://old-api.com/avatar.png',
      };
      mockFetchProfileInfo.mockResolvedValue(profileWithAvatarUrl);
      urlValidator.isValidUrlFormat.mockReturnValue(true);

      // Act
      const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);

      // Assert
      expect(result).toBe(profileWithAvatarUrl.avatar_url);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using avatar_url directly from API response')
      );
    });

    it('should prioritize avatar over avatar_url when both present', async () => {
      // Arrange
      const profileWithBoth = {
        id: '123',
        name: 'Test',
        avatar: 'https://new-api.com/avatar.png',
        avatar_url: 'https://old-api.com/avatar.png',
      };
      mockFetchProfileInfo.mockResolvedValue(profileWithBoth);
      urlValidator.isValidUrlFormat.mockReturnValue(true);

      // Act
      const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);

      // Assert
      expect(result).toBe(profileWithBoth.avatar);
      expect(result).not.toBe(profileWithBoth.avatar_url);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using avatar directly from API response')
      );
    });

    it('should validate avatar URL format and reject invalid URLs', async () => {
      // Arrange
      const profileWithInvalidAvatar = {
        id: '123',
        name: 'Test',
        avatar: 'invalid-url',
      };
      mockFetchProfileInfo.mockResolvedValue(profileWithInvalidAvatar);
      urlValidator.isValidUrlFormat.mockReturnValue(false);

      // Act
      const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);

      // Assert
      expect(urlValidator.isValidUrlFormat).toHaveBeenCalledWith('invalid-url');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Received invalid avatar from API')
      );
      expect(result).toBeNull();
    });

    it('should validate avatar_url format and reject invalid URLs', async () => {
      // Arrange
      const profileWithInvalidAvatarUrl = {
        id: '123',
        name: 'Test',
        avatar_url: 'invalid-url',
      };
      mockFetchProfileInfo.mockResolvedValue(profileWithInvalidAvatarUrl);
      urlValidator.isValidUrlFormat.mockReturnValue(false);

      // Act
      const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);

      // Assert
      expect(urlValidator.isValidUrlFormat).toHaveBeenCalledWith('invalid-url');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Received invalid avatar_url from API')
      );
      expect(result).toBeNull();
    });

    it('should return null when no avatar fields present', async () => {
      // Arrange
      const profileWithoutAvatar = { id: '123', name: 'Test' };
      mockFetchProfileInfo.mockResolvedValue(profileWithoutAvatar);

      // Act
      const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);

      // Assert
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No avatar or avatar_url found for profile')
      );
    });

    it('should return null when profile fetch fails', async () => {
      // Arrange
      mockFetchProfileInfo.mockResolvedValue(null);

      // Act
      const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);

      // Assert
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No profile info found for avatar')
      );
    });

    it('should handle errors gracefully and log them', async () => {
      // Arrange
      mockFetchProfileInfo.mockRejectedValue(new Error('Network error'));

      // Act
      const result = await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);

      // Assert
      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error generating avatar URL')
      );
    });
  });

  describe('getProfileDisplayName - fallback logic', () => {
    it('should return profile name when available', async () => {
      // Arrange
      const mockProfileData = { id: '123', name: 'Test Display Name' };
      mockFetchProfileInfo.mockResolvedValue(mockProfileData);

      // Act
      const result = await profileInfoFetcher.getProfileDisplayName(mockProfileName);

      // Assert
      expect(result).toBe(mockProfileData.name);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          `Found display name for ${mockProfileName}: ${mockProfileData.name}`
        )
      );
    });

    it('should return fallback (profileName) when profile fetch fails', async () => {
      // Arrange
      mockFetchProfileInfo.mockResolvedValue(null);

      // Act
      const result = await profileInfoFetcher.getProfileDisplayName(mockProfileName);

      // Assert
      expect(result).toBe(mockProfileName);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No profile info found for display name')
      );
    });

    it('should return null when name field missing (indicating failure)', async () => {
      // Arrange
      const profileWithoutName = { id: '123' };
      mockFetchProfileInfo.mockResolvedValue(profileWithoutName);

      // Act
      const result = await profileInfoFetcher.getProfileDisplayName(mockProfileName);

      // Assert
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No name field in profile info')
      );
    });
  });

  describe('logging behavior', () => {
    it('should log info when getting avatar URL', async () => {
      // Arrange
      mockFetchProfileInfo.mockResolvedValue(null);

      // Act
      await profileInfoFetcher.getProfileAvatarUrl(mockProfileName);

      // Assert
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(`Getting avatar URL for: ${mockProfileName}`)
      );
    });

    it('should log info when getting display name', async () => {
      // Arrange
      mockFetchProfileInfo.mockResolvedValue(null);

      // Act
      await profileInfoFetcher.getProfileDisplayName(mockProfileName);

      // Assert
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(`Getting display name for: ${mockProfileName}`)
      );
    });
  });

  describe('testing utilities', () => {
    it('should expose clearCache function that works', () => {
      expect(() => profileInfoFetcher._testing.clearCache()).not.toThrow();
      expect(mockClearCache).toHaveBeenCalled();
    });

    it('should expose getCache function that returns cache object', () => {
      const cache = profileInfoFetcher._testing.getCache();
      expect(cache).toBeDefined();
      expect(typeof cache).toBe('object');
    });

    it('should expose setFetchImplementation function', () => {
      const mockImpl = jest.fn();
      expect(() => profileInfoFetcher._testing.setFetchImplementation(mockImpl)).not.toThrow();
    });

    it('should expose getRateLimiter function', () => {
      const rateLimiter = profileInfoFetcher._testing.getRateLimiter();
      expect(rateLimiter).toBeDefined();
      expect(typeof rateLimiter).toBe('object');
    });

    it('should expose getFetcher function that returns core fetcher', () => {
      const fetcher = profileInfoFetcher._testing.getFetcher();
      expect(fetcher).toBeDefined();
      expect(typeof fetcher.fetchProfileInfo).toBe('function');
    });

    it('should expose resetFetcher function that works', () => {
      expect(() => profileInfoFetcher._testing.resetFetcher()).not.toThrow();
    });
  });
});
