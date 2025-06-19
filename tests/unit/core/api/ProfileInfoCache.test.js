/**
 * Tests for ProfileInfoCache - Cache expiration logic
 *
 * This file focuses on testing the cache expiration functionality
 * that was missing from existing test coverage.
 */

jest.mock('../../../../src/logger');

const ProfileInfoCache = require('../../../../src/core/api/ProfileInfoCache');
const logger = require('../../../../src/logger');

describe('ProfileInfoCache', () => {
  let cache;
  let originalDateNow;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock console methods to keep test output clean
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'debug').mockImplementation();

    // Mock logger
    logger.debug = jest.fn();
    logger.info = jest.fn();

    // Save original Date.now for manipulation
    originalDateNow = Date.now;

    // Create cache instance with short duration for testing
    cache = new ProfileInfoCache({
      cacheDuration: 60000, // 1 minute for easy testing
      logPrefix: '[TestCache]',
      enableCleanup: false, // Disable cleanup interval in tests
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    Date.now = originalDateNow;
  });

  describe('cache expiration logic', () => {
    it('should return cached data when not expired', () => {
      // Arrange
      const mockTime = 1000000;
      Date.now = jest.fn().mockReturnValue(mockTime);
      const profileName = 'test-profile';
      const profileData = { id: '123456789012345678', name: 'Test User' };

      // Set data in cache
      cache.set(profileName, profileData);

      // Act - get data immediately (should not be expired)
      const result = cache.get(profileName);

      // Assert
      expect(result).toEqual(profileData);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Cache hit for: test-profile')
      );
    });

    it('should return null and remove expired data', () => {
      // Arrange
      const mockTime = 1000000;
      Date.now = jest.fn().mockReturnValue(mockTime);
      const profileName = 'test-profile';
      const profileData = { id: '123456789012345678', name: 'Test User' };

      // Set data in cache
      cache.set(profileName, profileData);

      // Move time forward past expiration (1 minute + 1 second)
      Date.now = jest.fn().mockReturnValue(mockTime + 61000);

      // Act - try to get expired data
      const result = cache.get(profileName);

      // Assert - With LRUCache TTL, expired entries return undefined/null
      expect(result).toBeNull();
      // Note: LRUCache handles expiration internally, so we won't see the "expired" log
      expect(cache.has(profileName)).toBe(false); // Should be removed from cache
    });

    it('should return null for non-existent entries', () => {
      // Act
      const result = cache.get('non-existent-profile');

      // Assert
      expect(result).toBeNull();
      expect(logger.debug).not.toHaveBeenCalled(); // No logging for cache miss
    });

    it('should store data with current timestamp', () => {
      // Arrange
      const mockTime = 2000000;
      Date.now = jest.fn().mockReturnValue(mockTime);
      const profileName = 'test-profile';
      const profileData = { id: '123456789012345678', name: 'Test User' };

      // Act
      cache.set(profileName, profileData);

      // Assert - Verify data was stored and can be retrieved
      const result = cache.get(profileName);
      expect(result).toEqual(profileData);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Cached data for: test-profile')
      );
    });

    it('should clear all cached data', () => {
      // Arrange
      cache.set('profile1', { id: '123456789012345001', name: 'User 1' });
      cache.set('profile2', { id: '123456789012345002', name: 'User 2' });
      expect(cache.size).toBe(2);

      // Act
      cache.clear();

      // Assert
      expect(cache.size).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Cache cleared'));
    });

    it('should report correct cache size', () => {
      // Arrange - Start with empty cache
      expect(cache.size).toBe(0);

      // Act - Add multiple entries
      cache.set('profile1', { id: '123456789012345001', name: 'User 1' });
      cache.set('profile2', { id: '123456789012345002', name: 'User 2' });
      cache.set('profile3', { id: '123456789012345003', name: 'User 3' });

      // Assert
      expect(cache.size).toBe(3);
    });

    it('should use custom cache duration when provided', () => {
      // Arrange
      const customCache = new ProfileInfoCache({
        cacheDuration: 5000, // 5 seconds
        logPrefix: '[CustomCache]',
        enableCleanup: false, // Disable cleanup interval in tests
      });

      const mockTime = 1000000;
      Date.now = jest.fn().mockReturnValue(mockTime);
      const profileName = 'test-profile';
      const profileData = { id: '123456789012345678', name: 'Test User' };

      // Set data in cache
      customCache.set(profileName, profileData);

      // Move time forward 3 seconds (should still be valid)
      Date.now = jest.fn().mockReturnValue(mockTime + 3000);
      expect(customCache.get(profileName)).toEqual(profileData);

      // Move time forward 6 seconds total (should be expired)
      Date.now = jest.fn().mockReturnValue(mockTime + 6000);
      expect(customCache.get(profileName)).toBeNull();
    });

    it('should use custom log prefix when provided', () => {
      // Arrange
      const customCache = new ProfileInfoCache({
        logPrefix: '[CustomPrefix]',
      });
      const profileData = { id: '123456789012345678', name: 'Test User' };

      // Act
      customCache.set('test-profile', profileData);

      // Assert
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[CustomPrefix] Cached data for: test-profile')
      );
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used profiles when reaching max size', () => {
      // Create cache with small size for testing
      const smallCache = new ProfileInfoCache({
        maxSize: 3,
        enableCleanup: false,
      });

      // Add profiles to fill cache
      smallCache.set('profile1', { id: '123456789012345001', name: 'User 1' });
      smallCache.set('profile2', { id: '123456789012345002', name: 'User 2' });
      smallCache.set('profile3', { id: '123456789012345003', name: 'User 3' });

      expect(smallCache.size).toBe(3);

      // Add one more profile - should evict profile1 (least recently used)
      smallCache.set('profile4', { id: '123456789012345004', name: 'User 4' });

      expect(smallCache.size).toBe(3);
      expect(smallCache.has('profile1')).toBe(false); // Evicted
      expect(smallCache.has('profile2')).toBe(true);
      expect(smallCache.has('profile3')).toBe(true);
      expect(smallCache.has('profile4')).toBe(true);
    });

    it('should update LRU order when accessing profiles', () => {
      // Create cache with small size for testing
      const smallCache = new ProfileInfoCache({
        maxSize: 3,
        enableCleanup: false,
      });

      // Add profiles with time gaps to ensure proper ordering
      smallCache.set('profile1', { id: '123456789012345001', name: 'User 1' });
      jest.advanceTimersByTime(100);
      smallCache.set('profile2', { id: '123456789012345002', name: 'User 2' });
      jest.advanceTimersByTime(100);
      smallCache.set('profile3', { id: '123456789012345003', name: 'User 3' });
      jest.advanceTimersByTime(100);

      // Access profile1 to make it recently used
      smallCache.get('profile1');
      jest.advanceTimersByTime(100);

      // Add new profile - should evict profile2 (now least recently used)
      smallCache.set('profile4', { id: '123456789012345004', name: 'User 4' });

      expect(smallCache.has('profile1')).toBe(true); // Still there (was accessed)
      expect(smallCache.has('profile2')).toBe(false); // Evicted
      expect(smallCache.has('profile3')).toBe(true);
      expect(smallCache.has('profile4')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle cache operations with null/undefined data', () => {
      // Test setting null data
      cache.set('null-profile', null);
      expect(cache.get('null-profile')).toBeNull();

      // Test setting undefined data
      cache.set('undefined-profile', undefined);
      // Our get() method returns null for non-existent/undefined values
      expect(cache.get('undefined-profile')).toBeNull();
    });

    it('should handle empty string profile names', () => {
      // Arrange
      const profileData = { id: '123456789012345678', name: 'Test User' };

      // Act
      cache.set('', profileData);
      const result = cache.get('');

      // Assert
      expect(result).toEqual(profileData);
      expect(cache.has('')).toBe(true);
    });
  });
});
