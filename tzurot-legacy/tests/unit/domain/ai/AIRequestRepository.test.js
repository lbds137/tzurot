/**
 * @jest-environment node
 * @testType domain
 *
 * AIRequestRepository Interface Test
 * - Tests repository interface contract
 * - Includes mock implementation example
 * - Pure domain test with no external dependencies
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const { AIRequestRepository } = require('../../../../src/domain/ai/AIRequestRepository');
const { AIRequest } = require('../../../../src/domain/ai/AIRequest');
const { AIRequestId } = require('../../../../src/domain/ai/AIRequestId');
const { AIContent } = require('../../../../src/domain/ai/AIContent');
const { AIModel } = require('../../../../src/domain/ai/AIModel');
const { UserId } = require('../../../../src/domain/personality/UserId');
const { PersonalityId } = require('../../../../src/domain/personality/PersonalityId');

describe('AIRequestRepository', () => {
  let repository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new AIRequestRepository();
  });

  describe('interface methods', () => {
    it('should define save method', () => {
      expect(repository.save).toBeDefined();
      expect(typeof repository.save).toBe('function');
    });

    it('should define findById method', () => {
      expect(repository.findById).toBeDefined();
      expect(typeof repository.findById).toBe('function');
    });

    it('should define findByUser method', () => {
      expect(repository.findByUser).toBeDefined();
      expect(typeof repository.findByUser).toBe('function');
    });

    it('should define findByPersonality method', () => {
      expect(repository.findByPersonality).toBeDefined();
      expect(typeof repository.findByPersonality).toBe('function');
    });

    it('should define findPending method', () => {
      expect(repository.findPending).toBeDefined();
      expect(typeof repository.findPending).toBe('function');
    });

    it('should define findRetryable method', () => {
      expect(repository.findRetryable).toBeDefined();
      expect(typeof repository.findRetryable).toBe('function');
    });

    it('should define getStatistics method', () => {
      expect(repository.getStatistics).toBeDefined();
      expect(typeof repository.getStatistics).toBe('function');
    });

    it('should define cleanup method', () => {
      expect(repository.cleanup).toBeDefined();
      expect(typeof repository.cleanup).toBe('function');
    });
  });

  describe('unimplemented methods', () => {
    it('should throw error for save', async () => {
      const request = new AIRequest(AIRequestId.create());

      await expect(repository.save(request)).rejects.toThrow(
        'AIRequestRepository.save() must be implemented'
      );
    });

    it('should throw error for findById', async () => {
      const requestId = AIRequestId.create();

      await expect(repository.findById(requestId)).rejects.toThrow(
        'AIRequestRepository.findById() must be implemented'
      );
    });

    it('should throw error for findByUser', async () => {
      const userId = new UserId('123456789012345678');

      await expect(repository.findByUser(userId)).rejects.toThrow(
        'AIRequestRepository.findByUser() must be implemented'
      );
    });

    it('should throw error for findByPersonality', async () => {
      const personalityId = new PersonalityId('test-personality');

      await expect(repository.findByPersonality(personalityId)).rejects.toThrow(
        'AIRequestRepository.findByPersonality() must be implemented'
      );
    });

    it('should throw error for findPending', async () => {
      await expect(repository.findPending()).rejects.toThrow(
        'AIRequestRepository.findPending() must be implemented'
      );
    });

    it('should throw error for findRetryable', async () => {
      await expect(repository.findRetryable()).rejects.toThrow(
        'AIRequestRepository.findRetryable() must be implemented'
      );
    });

    it('should throw error for getStatistics', async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      await expect(repository.getStatistics(since)).rejects.toThrow(
        'AIRequestRepository.getStatistics() must be implemented'
      );
    });

    it('should throw error for cleanup', async () => {
      const before = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      await expect(repository.cleanup(before)).rejects.toThrow(
        'AIRequestRepository.cleanup() must be implemented'
      );
    });
  });

  describe('mock implementation', () => {
    class MockAIRequestRepository extends AIRequestRepository {
      constructor() {
        super();
        this.requests = new Map();
      }

      async save(request) {
        this.requests.set(request.id, request);
      }

      async findById(requestId) {
        return this.requests.get(requestId.toString()) || null;
      }

      async findByUser(userId, options = {}) {
        const results = Array.from(this.requests.values()).filter(
          r => r.userId && r.userId.equals(userId)
        );

        if (options.limit) {
          return results.slice(0, options.limit);
        }

        return results;
      }

      async findByPersonality(personalityId, options = {}) {
        const results = Array.from(this.requests.values()).filter(
          r => r.personalityId && r.personalityId.equals(personalityId)
        );

        if (options.limit) {
          return results.slice(0, options.limit);
        }

        return results;
      }

      async findPending() {
        return Array.from(this.requests.values()).filter(r => r.status === 'pending');
      }

      async findRetryable() {
        return Array.from(this.requests.values()).filter(
          r => r.status === 'failed' && r.canRetry()
        );
      }

      async getStatistics(since) {
        const requests = Array.from(this.requests.values()).filter(
          r => r.createdAt && new Date(r.createdAt) >= since
        );

        return {
          total: requests.length,
          completed: requests.filter(r => r.status === 'completed').length,
          failed: requests.filter(r => r.status === 'failed').length,
          pending: requests.filter(r => r.status === 'pending').length,
          averageResponseTime: this._calculateAverageResponseTime(requests),
        };
      }

      async cleanup(before) {
        let deletedCount = 0;
        const toDelete = [];

        for (const [id, request] of this.requests) {
          if (request.createdAt && new Date(request.createdAt) < before) {
            toDelete.push(id);
          }
        }

        for (const id of toDelete) {
          this.requests.delete(id);
          deletedCount++;
        }

        return deletedCount;
      }

      _calculateAverageResponseTime(requests) {
        const completed = requests.filter(r => r.status === 'completed');
        if (completed.length === 0) return 0;

        const totalTime = completed.reduce((sum, r) => {
          const responseTime = r.getResponseTime();
          return sum + (responseTime || 0);
        }, 0);

        return Math.round(totalTime / completed.length);
      }
    }

    it('should allow implementation of interface', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const mockRepo = new MockAIRequestRepository();
      const userId = new UserId('123456789012345678');
      const personalityId = new PersonalityId('test-personality');

      const request = AIRequest.create({
        userId,
        personalityId,
        content: AIContent.fromText('Test request'),
        model: AIModel.createDefault(),
      });

      // Test save
      await mockRepo.save(request);

      // Test findById
      const found = await mockRepo.findById(request.requestId);
      expect(found).toBe(request);

      // Test findByUser
      const byUser = await mockRepo.findByUser(userId);
      expect(byUser).toContain(request);

      // Test findByPersonality
      const byPersonality = await mockRepo.findByPersonality(personalityId);
      expect(byPersonality).toContain(request);

      // Test findPending
      const pending = await mockRepo.findPending();
      expect(pending).toContain(request);

      // Mark as sent and complete
      request.markSent();
      jest.advanceTimersByTime(1000);
      request.recordResponse(AIContent.fromText('Response'));
      await mockRepo.save(request);

      // Test statistics
      const stats = await mockRepo.getStatistics(new Date('2023-12-31T00:00:00Z'));
      expect(stats).toEqual({
        total: 1,
        completed: 1,
        failed: 0,
        pending: 0,
        averageResponseTime: 1000,
      });

      // Test cleanup
      jest.advanceTimersByTime(31 * 24 * 60 * 60 * 1000); // 31 days
      const deleted = await mockRepo.cleanup(new Date('2024-01-30T00:00:00Z'));
      expect(deleted).toBe(1);

      const afterCleanup = await mockRepo.findById(request.requestId);
      expect(afterCleanup).toBeNull();

      jest.useRealTimers();
    });

    it('should handle retryable requests', async () => {
      const mockRepo = new MockAIRequestRepository();
      const request = AIRequest.create({
        userId: new UserId('123456789012345678'),
        personalityId: new PersonalityId('test-personality'),
        content: AIContent.fromText('Test'),
        model: AIModel.createDefault(),
      });

      // No retryable initially
      let retryable = await mockRepo.findRetryable();
      expect(retryable).toHaveLength(0);

      // Make request fail
      request.markSent();
      request.recordFailure(new Error('Temporary error'));
      await mockRepo.save(request);

      // Should be retryable
      retryable = await mockRepo.findRetryable();
      expect(retryable).toHaveLength(1);
      expect(retryable[0]).toBe(request);
    });
  });

  describe('interface contract', () => {
    it('should be extendable', () => {
      class CustomRepo extends AIRequestRepository {}
      const customRepo = new CustomRepo();

      expect(customRepo).toBeInstanceOf(AIRequestRepository);
    });

    it('should maintain method signatures', () => {
      // save(request) -> Promise<void>
      expect(repository.save.length).toBe(1);

      // findById(requestId) -> Promise<AIRequest|null>
      expect(repository.findById.length).toBe(1);

      // findByUser(userId, options) -> Promise<AIRequest[]>
      // Note: default parameters don't count in function.length
      expect(repository.findByUser.length).toBe(1);

      // findByPersonality(personalityId, options) -> Promise<AIRequest[]>
      // Note: default parameters don't count in function.length
      expect(repository.findByPersonality.length).toBe(1);

      // findPending() -> Promise<AIRequest[]>
      expect(repository.findPending.length).toBe(0);

      // findRetryable() -> Promise<AIRequest[]>
      expect(repository.findRetryable.length).toBe(0);

      // getStatistics(since) -> Promise<Object>
      expect(repository.getStatistics.length).toBe(1);

      // cleanup(before) -> Promise<number>
      expect(repository.cleanup.length).toBe(1);
    });
  });
});
