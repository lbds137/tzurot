/**
 * Tests for ProfileInfoFetcher with proper timing and new mock system
 */

// Mock all dependencies before imports
jest.mock('../../../../config', () => ({
  getProfileInfoEndpoint: jest.fn(profileName => `https://api.example.com/profiles/${profileName}`),
  botConfig: {
    mentionChar: '@',
    isDevelopment: false,
    environment: 'production',
  },
}));
jest.mock('node-fetch');
jest.mock('../../../../src/logger');
jest.mock('../../../../src/utils/rateLimiter');
jest.mock('../../../../src/core/api/ProfileInfoCache');
jest.mock('../../../../src/core/api/ProfileInfoClient');

const { ProfileInfoFetcher } = require('../../../../src/core/api');
const nodeFetch = require('node-fetch');
const logger = require('../../../../src/logger');
const RateLimiter = require('../../../../src/utils/rateLimiter');
const ProfileInfoCache = require('../../../../src/core/api/ProfileInfoCache');
const ProfileInfoClient = require('../../../../src/core/api/ProfileInfoClient');

// Test data
const mockProfileData = {
  id: '12345',
  name: 'Test Display Name',
};
const mockEndpoint = 'https://api.example.com/profiles/test-profile';
const mockProfileName = 'test-profile';

describe('ProfileInfoFetcher (core/api)', () => {
  let fetcher;
  let mockFetch;
  let mockRateLimiter;
  let mockCache;
  let mockClient;

  beforeEach(() => {
    // Use fake timers for speed
    jest.useFakeTimers();
    jest.clearAllMocks();

    // Mock console to keep test output clean
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Mock logger
    logger.info = jest.fn();
    logger.debug = jest.fn();
    logger.warn = jest.fn();
    logger.error = jest.fn();

    // Mock fetch with immediate success
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue(mockProfileData),
      headers: new Map(),
    });
    nodeFetch.mockImplementation(mockFetch);

    // Mock cache - default to cache miss
    mockCache = {
      get: jest.fn().mockReturnValue(null),
      set: jest.fn(),
      has: jest.fn().mockReturnValue(false),
      clear: jest.fn(),
    };
    ProfileInfoCache.mockImplementation(() => mockCache);

    // Mock client
    mockClient = {
      fetch: jest.fn().mockResolvedValue({
        success: true,
        data: mockProfileData,
        status: 200,
      }),
      validateProfileData: jest.fn().mockReturnValue(true),
    };
    ProfileInfoClient.mockImplementation(() => mockClient);

    // Mock rate limiter - execute immediately without delays
    mockRateLimiter = {
      enqueue: jest.fn().mockImplementation(async fn => await fn()),
      handleRateLimit: jest.fn().mockResolvedValue(0),
      recordSuccess: jest.fn(),
      maxRetries: 0,
      minRequestSpacing: 0,
      cooldownPeriod: 0,
    };
    RateLimiter.mockImplementation(() => mockRateLimiter);

    // Create fetcher instance
    fetcher = new ProfileInfoFetcher({
      delay: jest.fn().mockResolvedValue(undefined), // Instant delays
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Basic functionality', () => {
    test('should fetch profile info successfully', async () => {
      const result = await fetcher.fetchProfileInfo(mockProfileName);

      expect(result).toEqual(mockProfileData);
      expect(mockClient.fetch).toHaveBeenCalledWith(
        'https://api.example.com/profiles/test-profile',
        {}
      );
      expect(mockClient.validateProfileData).toHaveBeenCalledWith(mockProfileData, mockProfileName);
    });

    test('should use cache on second call', async () => {
      // First call - cache miss, should fetch
      await fetcher.fetchProfileInfo(mockProfileName);

      // Setup cache hit for second call
      mockCache.get.mockReturnValue(mockProfileData);
      mockCache.has.mockReturnValue(true);
      mockClient.fetch.mockClear();

      // Second call should use cache
      const result = await fetcher.fetchProfileInfo(mockProfileName);

      expect(result).toEqual(mockProfileData);
      expect(mockClient.fetch).not.toHaveBeenCalled();
    });

    test('should handle API errors', async () => {
      mockClient.fetch.mockResolvedValue({
        success: false,
        status: 500,
        error: 'Internal server error',
      });

      const result = await fetcher.fetchProfileInfo(mockProfileName);

      expect(result).toBeNull();
    });
  });

  describe('Rate limiting behavior', () => {
    test('should use rate limiter for requests', async () => {
      await fetcher.fetchProfileInfo(mockProfileName);

      expect(mockRateLimiter.enqueue).toHaveBeenCalled();
    });

    test('should handle rate limit retries', async () => {
      // Setup rate limiter to indicate retry needed
      mockRateLimiter.handleRateLimit.mockResolvedValue(1);

      const result = await fetcher.fetchProfileInfo(mockProfileName);

      expect(result).toEqual(mockProfileData);
    });
  });

  describe('Error handling', () => {
    test('should handle client errors gracefully', async () => {
      const error = new Error('Client error');
      mockClient.fetch.mockRejectedValue(error);

      const result = await fetcher.fetchProfileInfo(mockProfileName);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error fetching profile'));
    });

    test('should handle rate limiter errors', async () => {
      const error = new Error('Rate limiter error');
      // Make the enqueue function call its callback which then throws
      mockRateLimiter.enqueue.mockImplementation(async fn => {
        await fn(); // This will cause the error inside the callback
      });
      mockClient.fetch.mockRejectedValue(error);

      const result = await fetcher.fetchProfileInfo(mockProfileName);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error fetching profile'));
    });
  });

  describe('Concurrent requests', () => {
    test('should handle multiple concurrent requests', async () => {
      const profiles = ['profile1', 'profile2', 'profile3'];

      // Make concurrent requests
      const promises = profiles.map(name => fetcher.fetchProfileInfo(name));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(mockRateLimiter.enqueue).toHaveBeenCalledTimes(3);
    });

    test('should deduplicate identical concurrent requests', async () => {
      // Make multiple requests for the same profile
      const promises = [
        fetcher.fetchProfileInfo(mockProfileName),
        fetcher.fetchProfileInfo(mockProfileName),
        fetcher.fetchProfileInfo(mockProfileName),
      ];

      const results = await Promise.all(promises);

      // All should return the same data
      results.forEach(result => {
        expect(result).toEqual(mockProfileData);
      });

      // Should only make one actual request due to deduplication
      expect(mockClient.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
