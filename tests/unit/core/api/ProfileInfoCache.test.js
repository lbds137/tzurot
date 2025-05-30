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
      logPrefix: '[TestCache]'
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
      const profileData = { id: '123', name: 'Test User' };
      
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
      const profileData = { id: '123', name: 'Test User' };
      
      // Set data in cache
      cache.set(profileName, profileData);
      
      // Move time forward past expiration (1 minute + 1 second)
      Date.now = jest.fn().mockReturnValue(mockTime + 61000);
      
      // Act - try to get expired data
      const result = cache.get(profileName);
      
      // Assert
      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Cache expired for: test-profile')
      );
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
      const profileData = { id: '123', name: 'Test User' };
      
      // Act
      cache.set(profileName, profileData);
      
      // Assert
      expect(cache.has(profileName)).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Cached data for: test-profile')
      );
      
      // Verify we can retrieve the data
      const result = cache.get(profileName);
      expect(result).toEqual(profileData);
    });
    
    it('should clear all cached data', () => {
      // Arrange
      cache.set('profile1', { id: '1', name: 'User 1' });
      cache.set('profile2', { id: '2', name: 'User 2' });
      expect(cache.size).toBe(2);
      
      // Act
      cache.clear();
      
      // Assert
      expect(cache.size).toBe(0);
      expect(cache.has('profile1')).toBe(false);
      expect(cache.has('profile2')).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Cache cleared')
      );
    });
    
    it('should report correct cache size', () => {
      // Arrange
      expect(cache.size).toBe(0);
      
      // Act
      cache.set('profile1', { id: '1', name: 'User 1' });
      cache.set('profile2', { id: '2', name: 'User 2' });
      
      // Assert
      expect(cache.size).toBe(2);
      
      // Test removing individual entries
      cache.clear();
      expect(cache.size).toBe(0);
      
      // Test size after adding entries
      cache.set('profile1', { id: '1', name: 'User 1' });
      cache.set('profile2', { id: '2', name: 'User 2' });
      cache.set('profile3', { id: '3', name: 'User 3' });
      expect(cache.size).toBe(3);
    });
    
    it('should use custom cache duration when provided', () => {
      // Arrange
      const customCache = new ProfileInfoCache({
        cacheDuration: 5000, // 5 seconds
        logPrefix: '[CustomCache]'
      });
      
      const mockTime = 1000000;
      Date.now = jest.fn().mockReturnValue(mockTime);
      const profileName = 'test-profile';
      const profileData = { id: '123', name: 'Test User' };
      
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
        logPrefix: '[CustomPrefix]'
      });
      const profileData = { id: '123', name: 'Test User' };
      
      // Act
      customCache.set('test-profile', profileData);
      
      // Assert
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[CustomPrefix] Cached data for: test-profile')
      );
    });
  });

  describe('edge cases', () => {
    it('should handle cache operations with null/undefined data', () => {
      // Test setting null data
      cache.set('null-profile', null);
      expect(cache.get('null-profile')).toBeNull();
      
      // Test setting undefined data
      cache.set('undefined-profile', undefined);
      expect(cache.get('undefined-profile')).toBeUndefined();
    });
    
    it('should handle empty string profile names', () => {
      // Arrange
      const profileData = { id: '123', name: 'Test User' };
      
      // Act
      cache.set('', profileData);
      const result = cache.get('');
      
      // Assert
      expect(result).toEqual(profileData);
      expect(cache.has('')).toBe(true);
    });
  });
});