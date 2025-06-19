// Unmock HttpAIServiceAdapter since it's mocked globally in setup.js
jest.unmock('../../../../src/adapters/ai/HttpAIServiceAdapter');

// Mock the deduplicator to avoid timer issues
jest.mock('../../../../src/domain/ai/AIRequestDeduplicator', () => {
  return {
    AIRequestDeduplicator: jest.fn().mockImplementation(() => ({
      checkDuplicate: jest.fn().mockResolvedValue(null),
      registerPending: jest.fn(),
      markFailed: jest.fn(),
      _cleanupTimer: null,
    })),
  };
});

// Mock node-fetch
jest.mock('node-fetch');
const nodeFetch = require('node-fetch');

// Mock logger
jest.mock('../../../../src/logger');
const logger = require('../../../../src/logger');

const { HttpAIServiceAdapter } = require('../../../../src/adapters/ai/HttpAIServiceAdapter');
const { AIRequest, AIContent, AIModel } = require('../../../../src/domain/ai');
const { PersonalityId } = require('../../../../src/domain/personality');
const { UserId } = require('../../../../src/domain/personality');

describe('HttpAIServiceAdapter', () => {
  let adapter;
  let mockFetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ advanceTimers: true });

    // Setup mock fetch response
    mockFetch = jest.fn();
    nodeFetch.mockImplementation(mockFetch);

    // Create adapter with test config
    adapter = new HttpAIServiceAdapter({
      baseUrl: 'https://api.example.com',
      headers: { 'X-API-Key': 'test-key' },
      timeout: 5000,
      maxRetries: 2,
      retryDelay: 100,
      fetch: mockFetch,
      delay: () => Promise.resolve(), // Instant delay for tests
    });

    // Mock logger methods
    logger.debug.mockImplementation(() => {});
    logger.info.mockImplementation(() => {});
    logger.warn.mockImplementation(() => {});
    logger.error.mockImplementation(() => {});
  });

  afterEach(() => {
    // Clean up the deduplicator's interval
    if (adapter && adapter.deduplicator && adapter.deduplicator._cleanupTimer) {
      clearInterval(adapter.deduplicator._cleanupTimer);
    }
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      // Test behavior through getStats method instead of accessing private properties
      const stats = adapter.getStats();
      expect(stats.baseUrl).toBe('https://api.example.com');
      expect(stats.timeout).toBe(5000);
      expect(stats.maxRetries).toBe(2);
    });

    it('should throw error when no base URL provided', () => {
      // Ensure no environment variable
      delete process.env.SERVICE_API_BASE_URL;

      expect(() => new HttpAIServiceAdapter()).toThrow('AI service base URL is required');
    });

    it('should use environment variable for base URL', () => {
      // Set environment variable for test
      process.env.SERVICE_API_BASE_URL = 'https://default.example.com';

      const defaultAdapter = new HttpAIServiceAdapter();
      const stats = defaultAdapter.getStats();
      expect(stats.baseUrl).toBe('https://default.example.com');
      expect(stats.timeout).toBe(30000);
      expect(stats.maxRetries).toBe(3);

      // Clean up
      delete process.env.SERVICE_API_BASE_URL;
    });
  });

  describe('checkHealth', () => {
    it('should return true when health check succeeds', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      });

      const result = await adapter.checkHealth();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/health',
        expect.objectContaining({
          method: 'GET',
          headers: { 'X-API-Key': 'test-key' },
        })
      );
    });

    it('should return false when health check fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await adapter.checkHealth();

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should handle timeout with AbortController', async () => {
      // Mock fetch to reject with abort error
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const result = await adapter.checkHealth();

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Health check failed'),
        expect.stringContaining('aborted')
      );
    });
  });

  describe('sendRequest', () => {
    let mockRequest;

    beforeEach(() => {
      // Create a valid AIRequest with valid Discord IDs (numeric strings)
      const userId = UserId.fromString('123456789012345678');
      const personalityId = PersonalityId.fromString('987654321098765432');
      const content = AIContent.fromText('Hello AI');
      const model = new AIModel('test-model', '/models/test', {
        supportsImages: true,
        supportsAudio: false,
        maxTokens: 2048,
        temperature: 0.8,
      });

      mockRequest = AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });
    });

    it('should successfully generate content', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          content: 'Hello from AI!',
          metadata: { responseTime: 123 },
        }),
      };

      mockFetch.mockResolvedValue(mockResponse);

      const result = await adapter.sendRequest(mockRequest);

      expect(result).toBeInstanceOf(AIContent);
      expect(result.getText()).toBe('Hello from AI!');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-API-Key': 'test-key',
          }),
          body: expect.stringContaining('"Hello AI"'),
        })
      );
    });

    it('should validate AIRequest input', async () => {
      await expect(adapter.sendRequest('not-a-request')).rejects.toThrow(
        'Request must be an instance of AIRequest'
      );

      await expect(adapter.sendRequest(null)).rejects.toThrow(
        'Request must be an instance of AIRequest'
      );
    });

    it('should handle network errors with retry', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: 'Success after retry' }),
      });

      const resultPromise = adapter.sendRequest(mockRequest);

      // No need to advance timers with instant delay

      const result = await resultPromise;

      expect(result).toBeInstanceOf(AIContent);
      expect(result.getText()).toBe('Success after retry');

      // Verify retry was attempted
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('retrying'));
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on client errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid request format',
      });

      await expect(adapter.sendRequest(mockRequest)).rejects.toThrow(
        'Invalid request to AI service'
      );

      // Should only call once (no retry)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStats', () => {
    it('should return adapter statistics', () => {
      // Set some stats
      adapter._requestCount = 5;
      adapter._errorCount = 2;
      adapter._lastHealthCheck = true;

      const stats = adapter.getStats();

      expect(stats).toEqual({
        baseUrl: 'https://api.example.com',
        timeout: 5000,
        maxRetries: 2,
        healthy: true,
        requestCount: 5,
        errorCount: 2,
        errorRate: 0.4, // 2/5
      });
    });
  });

  describe('error handling', () => {
    let mockRequest;

    beforeEach(() => {
      // Create a valid AIRequest with valid Discord IDs (numeric strings)
      const userId = UserId.fromString('123456789012345678');
      const personalityId = PersonalityId.fromString('987654321098765432');
      const content = AIContent.fromText('Hello AI');
      const model = new AIModel('test-model', '/models/test', {
        supportsImages: true,
        supportsAudio: false,
        maxTokens: 2048,
        temperature: 0.8,
      });

      mockRequest = AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });
    });

    it('should handle authentication errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid API key',
      });

      await expect(adapter.sendRequest(mockRequest)).rejects.toThrow(
        'AI service authentication failed'
      );
    });

    it('should handle rate limit errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limit exceeded',
      });

      await expect(adapter.sendRequest(mockRequest)).rejects.toThrow(
        'AI service rate limit exceeded'
      );
    });

    it('should handle timeout errors', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      await expect(adapter.sendRequest(mockRequest)).rejects.toThrow(
        'AI service request timed out'
      );
    });

    it('should handle generic errors', async () => {
      const error = new Error('Unknown error');
      mockFetch.mockRejectedValue(error);

      await expect(adapter.sendRequest(mockRequest)).rejects.toThrow('Unknown error');
    });
  });
});
