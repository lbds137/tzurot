/**
 * @jest-environment node
 * @testType domain
 *
 * AIService Interface Test
 * - Tests service interface contract
 * - Includes mock implementation example
 * - Pure domain test with no external dependencies
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain service under test - NOT mocked!
const { AIService } = require('../../../../src/domain/ai/AIService');

describe('AIService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AIService();
  });

  describe('interface methods', () => {
    it('should define sendRequest method', () => {
      expect(service.sendRequest).toBeDefined();
      expect(typeof service.sendRequest).toBe('function');
    });

    it('should define checkHealth method', () => {
      expect(service.checkHealth).toBeDefined();
      expect(typeof service.checkHealth).toBe('function');
    });

    it('should define getMetrics method', () => {
      expect(service.getMetrics).toBeDefined();
      expect(typeof service.getMetrics).toBe('function');
    });
  });

  describe('unimplemented methods', () => {
    it('should throw error for sendRequest', async () => {
      const request = {
        model: 'claude-3-opus',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
      };

      await expect(service.sendRequest(request)).rejects.toThrow(
        'AIService.sendRequest() must be implemented'
      );
    });

    it('should throw error for checkHealth', async () => {
      await expect(service.checkHealth()).rejects.toThrow(
        'AIService.checkHealth() must be implemented'
      );
    });

    it('should throw error for getMetrics', async () => {
      await expect(service.getMetrics()).rejects.toThrow(
        'AIService.getMetrics() must be implemented'
      );
    });
  });

  describe('mock implementation', () => {
    class MockAIService extends AIService {
      constructor() {
        super();
        this.requestCount = 0;
        this.totalTokens = 0;
        this.isHealthy = true;
        this.requestLog = [];
      }

      async sendRequest(request) {
        if (!this.isHealthy) {
          throw new Error('Service unavailable');
        }

        this.requestCount++;
        const tokens = request.max_tokens || 1000;
        this.totalTokens += tokens;

        const response = {
          id: `resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          model: request.model,
          created: Date.now(),
          choices: [
            {
              message: {
                role: 'assistant',
                content: `Mock response to: ${request.messages[request.messages.length - 1].content}`,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 50,
            completion_tokens: tokens,
            total_tokens: 50 + tokens,
          },
        };

        this.requestLog.push({
          timestamp: new Date(),
          request,
          response,
        });

        return response;
      }

      async checkHealth() {
        return this.isHealthy;
      }

      async getMetrics() {
        return {
          requestCount: this.requestCount,
          totalTokens: this.totalTokens,
          averageTokensPerRequest:
            this.requestCount > 0 ? Math.round(this.totalTokens / this.requestCount) : 0,
          isHealthy: this.isHealthy,
          uptime: 99.9,
        };
      }

      setHealthy(healthy) {
        this.isHealthy = healthy;
      }
    }

    it('should allow implementation of interface', async () => {
      const mockService = new MockAIService();

      // Test checkHealth
      const health = await mockService.checkHealth();
      expect(health).toBe(true);

      // Test sendRequest
      const request = {
        model: 'claude-3-opus',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello, how are you?' },
        ],
        max_tokens: 100,
      };

      const response = await mockService.sendRequest(request);

      expect(response).toMatchObject({
        id: expect.stringMatching(/^resp_\d+_[a-z0-9]+$/),
        model: 'claude-3-opus',
        choices: expect.arrayContaining([
          expect.objectContaining({
            message: expect.objectContaining({
              role: 'assistant',
              content: expect.stringContaining('Mock response to: Hello, how are you?'),
            }),
          }),
        ]),
        usage: {
          prompt_tokens: 50,
          completion_tokens: 100,
          total_tokens: 150,
        },
      });

      // Test getMetrics
      const metrics = await mockService.getMetrics();
      expect(metrics).toEqual({
        requestCount: 1,
        totalTokens: 100,
        averageTokensPerRequest: 100,
        isHealthy: true,
        uptime: 99.9,
      });

      // Test unhealthy state
      mockService.setHealthy(false);
      await expect(mockService.sendRequest(request)).rejects.toThrow('Service unavailable');

      const healthAfter = await mockService.checkHealth();
      expect(healthAfter).toBe(false);
    });

    it('should track multiple requests', async () => {
      const mockService = new MockAIService();

      // Send multiple requests
      for (let i = 0; i < 5; i++) {
        await mockService.sendRequest({
          model: 'claude-3-opus',
          messages: [{ role: 'user', content: `Message ${i}` }],
          max_tokens: 200,
        });
      }

      const metrics = await mockService.getMetrics();
      expect(metrics).toEqual({
        requestCount: 5,
        totalTokens: 1000,
        averageTokensPerRequest: 200,
        isHealthy: true,
        uptime: 99.9,
      });
    });
  });

  describe('interface contract', () => {
    it('should be extendable', () => {
      class CustomService extends AIService {}
      const customService = new CustomService();

      expect(customService).toBeInstanceOf(AIService);
    });

    it('should maintain method signatures', () => {
      // sendRequest(request) -> Promise<Object>
      expect(service.sendRequest.length).toBe(1);

      // checkHealth() -> Promise<boolean>
      expect(service.checkHealth.length).toBe(0);

      // getMetrics() -> Promise<Object>
      expect(service.getMetrics.length).toBe(0);
    });
  });
});
