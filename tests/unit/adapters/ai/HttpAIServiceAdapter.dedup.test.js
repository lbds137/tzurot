/**
 * @jest-environment node
 */

const { HttpAIServiceAdapter } = require('../../../../src/adapters/ai/HttpAIServiceAdapter');
const { AIRequest, AIRequestId, AIContent, AIModel } = require('../../../../src/domain/ai');
const { PersonalityId, UserId } = require('../../../../src/domain/personality');
const logger = require('../../../../src/logger');

// Mock dependencies
jest.mock('../../../../src/logger');
jest.mock('node-fetch');
const fetch = require('node-fetch');

describe('HttpAIServiceAdapter - Deduplication', () => {
  let adapter;
  let mockDeduplicator;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Mock deduplicator
    mockDeduplicator = {
      createSignature: jest.fn().mockReturnValue({ toString: () => 'test-signature' }),
      isInBlackout: jest.fn().mockReturnValue(false),
      getPendingRequest: jest.fn().mockReturnValue(null),
      trackPendingRequest: jest.fn(),
      addToBlackout: jest.fn(),
      stop: jest.fn(),
      getStats: jest.fn().mockReturnValue({
        pendingRequests: 0,
        blackoutEntries: 0
      })
    };
    
    // Create adapter with mocked deduplicator
    adapter = new HttpAIServiceAdapter({
      baseUrl: 'https://api.test.com',
      deduplicator: mockDeduplicator,
      fetch: fetch,
      maxRetries: 0,  // No retries for tests
      delay: ms => Promise.resolve()  // Instant delays
    });
    
    // Mock fetch response - use format expected by default transform
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ 
        text: 'AI response'  // Simple format supported by _defaultResponseTransform
      })
    });
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });
  
  describe('deduplication behavior', () => {
    let request;
    
    beforeEach(() => {
      // Create a valid AI request
      request = AIRequest.create({
        userId: new UserId('123456789012345678'),
        personalityId: new PersonalityId('bot123'),
        content: new AIContent([{ type: 'text', text: 'Hello AI' }]),
        model: AIModel.createDefault()
      });
      
      // Add necessary fields for deduplication
      request.personality = 'TestBot';
      request.userId = '123456789012345678';
      request.channelId = '987654321098765432';
      request.prompt = 'Hello AI';
    });
    
    it('should check for blackout before processing', async () => {
      mockDeduplicator.isInBlackout.mockReturnValue(true);
      
      await expect(adapter.sendRequest(request))
        .rejects.toThrow('Request blocked due to recent errors');
      
      expect(mockDeduplicator.isInBlackout).toHaveBeenCalledWith('TestBot', '123456789012345678');
      expect(fetch).not.toHaveBeenCalled();
    });
    
    it('should return cached promise for duplicate request', async () => {
      const cachedPromise = Promise.resolve(new AIContent([{ type: 'text', text: 'Cached response' }]));
      mockDeduplicator.getPendingRequest.mockReturnValue(cachedPromise);
      
      const result = await adapter.sendRequest(request);
      
      expect(result.getText()).toBe('Cached response');
      expect(mockDeduplicator.getPendingRequest).toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Returning cached promise for duplicate request')
      );
    });
    
    it('should track new requests to prevent duplicates', async () => {
      await adapter.sendRequest(request);
      
      expect(mockDeduplicator.trackPendingRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Promise)
      );
    });
    
    it('should add to blackout on rate limit error', async () => {
      fetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => '{"error": "Rate limited"}',
        json: async () => ({ error: 'Rate limited' })
      });
      
      await expect(adapter.sendRequest(request)).rejects.toThrow();
      
      // The promise catch handler should have been called synchronously
      // since we're using mockDeduplicator.trackPendingRequest
      // Let's check what was passed to trackPendingRequest
      expect(mockDeduplicator.trackPendingRequest).toHaveBeenCalled();
      
      // Get the promise that was passed to trackPendingRequest
      const trackedPromise = mockDeduplicator.trackPendingRequest.mock.calls[0][1];
      
      // Wait for the tracked promise to reject and its catch handler to run
      try {
        await trackedPromise;
      } catch (e) {
        // Expected rejection
      }
      
      expect(mockDeduplicator.addToBlackout).toHaveBeenCalledWith('TestBot', '123456789012345678');
    });
    
    it('should add to blackout on service error', async () => {
      fetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => '{"error": "Service down"}',
        json: async () => ({ error: 'Service down' })
      });
      
      await expect(adapter.sendRequest(request)).rejects.toThrow();
      
      expect(mockDeduplicator.trackPendingRequest).toHaveBeenCalled();
      const trackedPromise = mockDeduplicator.trackPendingRequest.mock.calls[0][1];
      
      try {
        await trackedPromise;
      } catch (e) {
        // Expected rejection
      }
      
      expect(mockDeduplicator.addToBlackout).toHaveBeenCalledWith('TestBot', '123456789012345678');
    });
    
    it('should not add to blackout on client errors', async () => {
      fetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => '{"error": "Invalid request"}',
        json: async () => ({ error: 'Invalid request' })
      });
      
      await expect(adapter.sendRequest(request)).rejects.toThrow();
      
      expect(mockDeduplicator.trackPendingRequest).toHaveBeenCalled();
      const trackedPromise = mockDeduplicator.trackPendingRequest.mock.calls[0][1];
      
      try {
        await trackedPromise;
      } catch (e) {
        // Expected rejection
      }
      
      expect(mockDeduplicator.addToBlackout).not.toHaveBeenCalled();
    });
    
    it('should handle missing personality gracefully', async () => {
      request.personality = undefined;
      
      await adapter.sendRequest(request);
      
      expect(mockDeduplicator.createSignature).toHaveBeenCalledWith({
        personalityName: 'default',
        userId: '123456789012345678',
        channelId: '987654321098765432',
        content: 'Hello AI'
      });
    });
    
    it('should handle missing user ID gracefully', async () => {
      request.userId = undefined;
      
      await adapter.sendRequest(request);
      
      expect(mockDeduplicator.createSignature).toHaveBeenCalledWith({
        personalityName: 'TestBot',
        userId: 'system',
        channelId: '987654321098765432',
        content: 'Hello AI'
      });
    });
  });
  
  describe('statistics', () => {
    it('should include deduplication stats', () => {
      mockDeduplicator.getStats.mockReturnValue({
        pendingRequests: 5,
        blackoutEntries: 3,
        memoryUsage: { pending: 500, blackouts: 150 }
      });
      
      const stats = adapter.getStats();
      
      expect(stats.deduplication).toEqual({
        pendingRequests: 5,
        blackoutEntries: 3,
        memoryUsage: { pending: 500, blackouts: 150 }
      });
    });
  });
  
  describe('cleanup', () => {
    it('should stop deduplicator on cleanup', async () => {
      await adapter.cleanup();
      
      expect(mockDeduplicator.stop).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[HttpAIServiceAdapter] Cleaning up resources');
    });
  });
});