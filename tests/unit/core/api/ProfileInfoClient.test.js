const ProfileInfoClient = require('../../../../src/core/api/ProfileInfoClient');

// Mock dependencies
jest.mock('node-fetch');
jest.mock('../../../../src/logger');

const nodeFetch = require('node-fetch');
const logger = require('../../../../src/logger');

describe('ProfileInfoClient', () => {
  let client;
  let mockFetch;
  let mockScheduler;
  let mockClearScheduler;
  let mockAbortController;
  let mockAbort;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock AbortController
    mockAbort = jest.fn();
    mockAbortController = {
      abort: mockAbort,
      signal: 'mock-signal',
    };
    global.AbortController = jest.fn(() => mockAbortController);

    // Mock scheduler functions
    mockScheduler = jest.fn((callback, delay) => setTimeout(callback, delay));
    mockClearScheduler = jest.fn(id => clearTimeout(id));

    // Mock fetch implementation
    mockFetch = jest.fn();

    // Create client with mocked dependencies
    client = new ProfileInfoClient({
      timeout: 5000,
      fetchImplementation: mockFetch,
      scheduler: mockScheduler,
      clearScheduler: mockClearScheduler,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.AbortController;
  });

  describe('constructor', () => {
    it('should use default values when no options provided', () => {
      const defaultClient = new ProfileInfoClient();

      expect(defaultClient.timeout).toBe(30000);
      expect(defaultClient.logPrefix).toBe('[ProfileInfoClient]');
      expect(defaultClient.fetchImplementation).toBe(nodeFetch);
      expect(defaultClient.scheduler).toBe(setTimeout);
      expect(defaultClient.clearScheduler).toBe(clearTimeout);
    });

    it('should use provided options', () => {
      const customFetch = jest.fn();
      const customScheduler = jest.fn();
      const customClearScheduler = jest.fn();

      const customClient = new ProfileInfoClient({
        timeout: 10000,
        logPrefix: '[CustomClient]',
        fetchImplementation: customFetch,
        scheduler: customScheduler,
        clearScheduler: customClearScheduler,
      });

      expect(customClient.timeout).toBe(10000);
      expect(customClient.logPrefix).toBe('[CustomClient]');
      expect(customClient.fetchImplementation).toBe(customFetch);
      expect(customClient.scheduler).toBe(customScheduler);
      expect(customClient.clearScheduler).toBe(customClearScheduler);
    });
  });

  describe('fetch', () => {
    it('should fetch data successfully', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: jest.fn().mockResolvedValue({ id: '123', name: 'Test Profile' }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await client.fetch('https://api.example.com/profile');

      expect(result).toEqual({
        success: true,
        status: 200,
        data: { id: '123', name: 'Test Profile' },
      });

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/profile', {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          Referer: 'https://discord.com/',
        },
        signal: 'mock-signal',
      });

      expect(mockScheduler).toHaveBeenCalledWith(expect.any(Function), 5000);
      expect(mockClearScheduler).toHaveBeenCalled();
    });

    it('should merge custom headers with defaults', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: '123' }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await client.fetch('https://api.example.com/profile', {
        'X-Custom-Header': 'custom-value',
        Authorization: 'Bearer token',
      });

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/profile', {
        headers: expect.objectContaining({
          'X-Custom-Header': 'custom-value',
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        }),
        signal: 'mock-signal',
      });
    });

    it('should handle non-ok response', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: { get: jest.fn() },
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await client.fetch('https://api.example.com/profile');

      expect(result).toEqual({
        success: false,
        status: 404,
        statusText: 'Not Found',
        headers: mockResponse.headers,
        data: null,
      });

      expect(logger.error).toHaveBeenCalledWith(
        '[ProfileInfoClient] API response error: 404 Not Found'
      );
    });

    it('should handle timeout', async () => {
      // Create an error that looks like an abort error
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      // Mock fetch to reject with abort error
      mockFetch.mockRejectedValue(abortError);

      // Also verify the abort was called via the scheduler
      let scheduledCallback;
      mockScheduler.mockImplementation((callback, delay) => {
        scheduledCallback = callback;
        return 123; // Return a fake timer ID
      });

      const resultPromise = client.fetch('https://api.example.com/profile');

      // Verify scheduler was called with timeout
      expect(mockScheduler).toHaveBeenCalledWith(expect.any(Function), 5000);

      // Execute the scheduled timeout callback
      scheduledCallback();

      const result = await resultPromise;

      expect(result).toEqual({
        success: false,
        error: 'timeout',
        message: 'The operation was aborted',
        data: null,
      });

      expect(logger.warn).toHaveBeenCalledWith(
        '[ProfileInfoClient] Request timed out after 5000ms'
      );
      expect(mockAbort).toHaveBeenCalled();
    });

    it('should handle abort error with type property', async () => {
      const abortError = new Error('Aborted');
      abortError.type = 'aborted';
      mockFetch.mockRejectedValue(abortError);

      const result = await client.fetch('https://api.example.com/profile');

      expect(result).toEqual({
        success: false,
        error: 'timeout',
        message: 'Aborted',
        data: null,
      });
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network failure');
      mockFetch.mockRejectedValue(networkError);

      const result = await client.fetch('https://api.example.com/profile');

      expect(result).toEqual({
        success: false,
        error: 'network',
        message: 'Network failure',
        data: null,
      });

      expect(logger.error).toHaveBeenCalledWith(
        '[ProfileInfoClient] Network error: Network failure'
      );
    });

    it('should handle JSON parsing errors', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await client.fetch('https://api.example.com/profile');

      expect(result).toEqual({
        success: false,
        error: 'network',
        message: 'Invalid JSON',
        data: null,
      });
    });

    it('should clear timeout even on error', async () => {
      const networkError = new Error('Network failure');
      mockFetch.mockRejectedValue(networkError);

      await client.fetch('https://api.example.com/profile');

      expect(mockClearScheduler).toHaveBeenCalled();
    });

    it('should log debug messages', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: '123', name: 'Test' }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await client.fetch('https://api.example.com/profile');

      expect(logger.debug).toHaveBeenCalledWith(
        '[ProfileInfoClient] Fetching from: https://api.example.com/profile'
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[ProfileInfoClient] Received data:')
      );
    });
  });

  describe('validateProfileData', () => {
    it('should return false for null data', () => {
      const result = client.validateProfileData(null, 'TestProfile');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        '[ProfileInfoClient] Received empty data for: TestProfile'
      );
    });

    it('should return false for undefined data', () => {
      const result = client.validateProfileData(undefined, 'TestProfile');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        '[ProfileInfoClient] Received empty data for: TestProfile'
      );
    });

    it('should return true and warn for missing name field', () => {
      const result = client.validateProfileData({ id: '123' }, 'TestProfile');

      expect(result).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        "[ProfileInfoClient] Profile data missing 'name' field for: TestProfile"
      );
    });

    it('should return true and warn for missing id field', () => {
      const result = client.validateProfileData({ name: 'Test' }, 'TestProfile');

      expect(result).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        "[ProfileInfoClient] Profile data missing 'id' field for: TestProfile"
      );
    });

    it('should return true for valid data with both fields', () => {
      const result = client.validateProfileData({ id: '123', name: 'Test' }, 'TestProfile');

      expect(result).toBe(true);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should return true for data with extra fields', () => {
      const result = client.validateProfileData(
        { id: '123', name: 'Test', avatar: 'url', extra: 'data' },
        'TestProfile'
      );

      expect(result).toBe(true);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should warn for both missing fields', () => {
      const result = client.validateProfileData({ other: 'field' }, 'TestProfile');

      expect(result).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        "[ProfileInfoClient] Profile data missing 'name' field for: TestProfile"
      );
      expect(logger.warn).toHaveBeenCalledWith(
        "[ProfileInfoClient] Profile data missing 'id' field for: TestProfile"
      );
    });
  });
});
