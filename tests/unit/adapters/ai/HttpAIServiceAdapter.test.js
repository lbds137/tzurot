const { HttpAIServiceAdapter } = require('../../../../src/adapters/ai/HttpAIServiceAdapter');
const { 
  AIRequest,
  AIContent,
  AIModel
} = require('../../../../src/domain/ai');
const { PersonalityId } = require('../../../../src/domain/personality');
const { UserId } = require('../../../../src/domain/personality');

// Mock node-fetch
jest.mock('node-fetch');
const nodeFetch = require('node-fetch');

// Mock logger
jest.mock('../../../../src/logger');
const logger = require('../../../../src/logger');

describe('HttpAIServiceAdapter', () => {
  let adapter;
  let mockFetch;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
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
      delay: (_ms) => Promise.resolve() // Instant delay for tests
    });
    
    // Mock logger methods
    logger.debug.mockImplementation(() => {});
    logger.info.mockImplementation(() => {});
    logger.warn.mockImplementation(() => {});
    logger.error.mockImplementation(() => {});
  });
  
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      expect(adapter.baseUrl).toBe('https://api.example.com');
      expect(adapter.headers).toEqual({ 'X-API-Key': 'test-key' });
      expect(adapter.timeout).toBe(5000);
      expect(adapter.maxRetries).toBe(2);
      expect(adapter.retryDelay).toBe(100);
    });

    it('should throw error when no base URL provided', () => {
      // Ensure no environment variable
      delete process.env.AI_SERVICE_URL;
      
      expect(() => new HttpAIServiceAdapter()).toThrow('AI service base URL is required');
    });
    
    it('should use environment variable for base URL', () => {
      // Set environment variable for test
      process.env.AI_SERVICE_URL = 'https://default.example.com';
      
      const defaultAdapter = new HttpAIServiceAdapter();
      expect(defaultAdapter.baseUrl).toBe('https://default.example.com');
      expect(defaultAdapter.timeout).toBe(30000);
      expect(defaultAdapter.maxRetries).toBe(3);
      expect(defaultAdapter.retryDelay).toBe(1000);
      
      // Clean up
      delete process.env.AI_SERVICE_URL;
    });
  });

  describe('checkHealth', () => {
    it('should return true when health check succeeds', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' })
      });

      const result = await adapter.checkHealth();
      
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/health',
        expect.objectContaining({
          method: 'GET',
          headers: { 'X-API-Key': 'test-key' }
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
        temperature: 0.8
      });
      
      mockRequest = AIRequest.create({
        userId,
        personalityId,
        content,
        model
      });
    });

    it('should successfully generate content', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          content: 'Hello from AI!',
          metadata: { responseTime: 123 }
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);
      
      const result = await adapter.sendRequest(mockRequest);
      
      expect(result).toBeInstanceOf(AIContent);
      expect(result.getText()).toBe('Hello from AI!');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/generate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-API-Key': 'test-key'
          })
        })
      );
    });

    it('should validate AIRequest input', async () => {
      await expect(adapter.sendRequest('not-a-request'))
        .rejects.toThrow('Request must be an instance of AIRequest');
      
      await expect(adapter.sendRequest(null))
        .rejects.toThrow('Request must be an instance of AIRequest');
    });

    it('should handle network errors with retry', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ content: 'Success after retry' })
        });
      
      const resultPromise = adapter.sendRequest(mockRequest);
      
      // Advance timers to trigger retry
      await jest.advanceTimersByTimeAsync(100);
      
      const result = await resultPromise;
      
      expect(result).toBeInstanceOf(AIContent);
      expect(result.getText()).toBe('Success after retry');
      
      // Verify retry was attempted
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('retrying')
      );
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on client errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid request format'
      });
      
      await expect(adapter.sendRequest(mockRequest))
        .rejects.toThrow('Invalid request to AI service');
      
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
        errorCount: 2
      });
    });
  });

  describe('error transformation', () => {
    it('should transform 401 errors', () => {
      const error = new Error('Unauthorized');
      error.response = { status: 401 };
      
      const transformed = adapter._transformError(error);
      expect(transformed.message).toBe('Authentication required');
    });

    it('should transform 429 errors', () => {
      const error = new Error('Too Many Requests');
      error.response = { status: 429 };
      
      const transformed = adapter._transformError(error);
      expect(transformed.message).toBe('Rate limit exceeded');
    });

    it('should transform timeout errors', () => {
      const error = new Error('Timeout');
      error.code = 'ECONNABORTED';
      
      const transformed = adapter._transformError(error);
      expect(transformed.message).toBe('AI service request timeout');
    });

    it('should return original error if cannot transform', () => {
      const error = new Error('Unknown error');
      
      const transformed = adapter._transformError(error);
      expect(transformed).toBe(error);
    });
  });
});