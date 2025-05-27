/**
 * Tests for the new ProfileInfoFetcher architecture
 * These tests verify the actual behavior without mocking the core functionality
 */

// Mock modules before imports
jest.mock('../../../../config');
jest.mock('node-fetch');
jest.mock('../../../../src/logger');

const { ProfileInfoFetcher } = require('../../../../src/core/api');
const config = require('../../../../config');
const nodeFetch = require('node-fetch');
const logger = require('../../../../src/logger');

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

  beforeEach(() => {
    // Use fake timers to speed up tests
    jest.useFakeTimers();
    
    // Reset modules
    jest.resetModules();
    jest.clearAllMocks();

    // Mock logger to avoid console output
    logger.info = jest.fn();
    logger.debug = jest.fn();
    logger.warn = jest.fn();
    logger.error = jest.fn();

    // Configure mocks
    config.getProfileInfoEndpoint = jest.fn((profileName) => 
      `https://api.example.com/profiles/${profileName}`);

    // Create mock fetch
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue(mockProfileData),
      headers: new Map()
    });
    nodeFetch.mockImplementation(mockFetch);

    // Create fetcher with test-friendly options
    fetcher = new ProfileInfoFetcher({
      rateLimiter: {
        minRequestSpacing: 0, // No delay for tests
        maxRetries: 2, // Fewer retries for faster tests
        cooldownPeriod: 1000, // Shorter cooldown
      }
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Basic functionality', () => {
    test('should fetch profile info successfully', async () => {
      const result = await fetcher.fetchProfileInfo(mockProfileName);
      
      expect(result).toEqual(mockProfileData);
      expect(mockFetch).toHaveBeenCalled();
      
      // Check the call details
      const callArgs = mockFetch.mock.calls[0];
      if (callArgs[0] === undefined) {
        console.log('Debug - config.getProfileInfoEndpoint calls:', config.getProfileInfoEndpoint.mock.calls);
        console.log('Debug - config.getProfileInfoEndpoint return:', config.getProfileInfoEndpoint(mockProfileName));
      }
      
      expect(mockFetch).toHaveBeenCalledWith(
        mockEndpoint,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
    });

    test('should cache results', async () => {
      // First call
      const result1 = await fetcher.fetchProfileInfo(mockProfileName);

      // Second call should use cache
      mockFetch.mockClear();
      const result2 = await fetcher.fetchProfileInfo(mockProfileName);

      expect(result2).toEqual(result1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Map()
      });

      const result = await fetcher.fetchProfileInfo(mockProfileName);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('API response error: 500')
      );
    });
  });

  describe('Rate limiting behavior', () => {
    test('should handle 429 rate limit responses with retry', async () => {
      // First call returns 429
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: {
          get: jest.fn().mockReturnValue('5')
        }
      });

      // Second call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockProfileData),
        headers: new Map()
      });

      const result = await fetcher.fetchProfileInfo(mockProfileName);

      expect(result).toEqual(mockProfileData);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Rate limited')
      );
    });

    test('should return null after max retries exceeded', async () => {
      // All calls return 429
      for (let i = 0; i < 3; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: {
            get: jest.fn().mockReturnValue('1')
          }
        });
      }

      const result = await fetcher.fetchProfileInfo(mockProfileName);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Max retries reached')
      );
    });
  });

  describe('Timeout handling', () => {
    test('should retry on timeout', async () => {
      const timeoutError = new Error('The operation was aborted');
      timeoutError.name = 'AbortError';

      // First call times out
      mockFetch.mockRejectedValueOnce(timeoutError);

      // Second call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockProfileData),
        headers: new Map()
      });

      const result = await fetcher.fetchProfileInfo(mockProfileName);

      expect(result).toEqual(mockProfileData);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Request timed out')
      );
    });

    test('should return null after max timeout retries', async () => {
      const timeoutError = new Error('The operation was aborted');
      timeoutError.name = 'AbortError';

      // All calls timeout
      for (let i = 0; i < 3; i++) {
        mockFetch.mockRejectedValueOnce(timeoutError);
      }

      const result = await fetcher.fetchProfileInfo(mockProfileName);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Max retries reached')
      );
    });
  });

  describe('Concurrent requests', () => {
    test('should handle multiple concurrent requests', async () => {
      const profiles = [
        { name: 'profile1', id: '1' },
        { name: 'profile2', id: '2' },
        { name: 'profile3', id: '3' }
      ];

      profiles.forEach(profile => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(profile),
          headers: new Map()
        });
      });

      // Make concurrent requests
      const promises = profiles.map(p => fetcher.fetchProfileInfo(p.name));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result).toEqual(profiles[index]);
      });
    });

    test('should deduplicate identical concurrent requests', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockProfileData),
        headers: new Map()
      });

      // Make multiple requests for the same profile
      const promises = [
        fetcher.fetchProfileInfo(mockProfileName),
        fetcher.fetchProfileInfo(mockProfileName),
        fetcher.fetchProfileInfo(mockProfileName)
      ];
      
      const results = await Promise.all(promises);

      // All should return the same data
      results.forEach(result => {
        expect(result).toEqual(mockProfileData);
      });

      // But fetch should only be called once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});