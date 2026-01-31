/**
 * @jest-environment node
 * @testType index
 *
 * AI Domain Index Test
 * - Tests exports of the AI domain module
 * - Verifies API surface and basic functionality
 * - Pure tests with no external dependencies
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Module under test - NOT mocked!
const aiDomain = require('../../../../src/domain/ai/index');

describe('AI Domain Index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('exports', () => {
    it('should export all aggregates', () => {
      expect(aiDomain.AIRequest).toBeDefined();
      expect(typeof aiDomain.AIRequest).toBe('function');
    });

    it('should export all value objects', () => {
      expect(aiDomain.AIRequestId).toBeDefined();
      expect(typeof aiDomain.AIRequestId).toBe('function');

      expect(aiDomain.AIContent).toBeDefined();
      expect(typeof aiDomain.AIContent).toBe('function');

      expect(aiDomain.AIModel).toBeDefined();
      expect(typeof aiDomain.AIModel).toBe('function');
    });

    it('should export all services', () => {
      expect(aiDomain.AIService).toBeDefined();
      expect(typeof aiDomain.AIService).toBe('function');

      expect(aiDomain.AIRequestDeduplicator).toBeDefined();
      expect(typeof aiDomain.AIRequestDeduplicator).toBe('function');
    });

    it('should export all repositories', () => {
      expect(aiDomain.AIRequestRepository).toBeDefined();
      expect(typeof aiDomain.AIRequestRepository).toBe('function');
    });

    it('should export all events', () => {
      expect(aiDomain.AIRequestCreated).toBeDefined();
      expect(typeof aiDomain.AIRequestCreated).toBe('function');

      expect(aiDomain.AIRequestSent).toBeDefined();
      expect(typeof aiDomain.AIRequestSent).toBe('function');

      expect(aiDomain.AIResponseReceived).toBeDefined();
      expect(typeof aiDomain.AIResponseReceived).toBe('function');

      expect(aiDomain.AIRequestFailed).toBeDefined();
      expect(typeof aiDomain.AIRequestFailed).toBe('function');

      expect(aiDomain.AIRequestRetried).toBeDefined();
      expect(typeof aiDomain.AIRequestRetried).toBe('function');

      expect(aiDomain.AIRequestRateLimited).toBeDefined();
      expect(typeof aiDomain.AIRequestRateLimited).toBe('function');

      expect(aiDomain.AIContentSanitized).toBeDefined();
      expect(typeof aiDomain.AIContentSanitized).toBe('function');

      expect(aiDomain.AIErrorDetected).toBeDefined();
      expect(typeof aiDomain.AIErrorDetected).toBe('function');
    });
  });

  describe('functionality', () => {
    it('should allow creating AI requests', () => {
      const { UserId } = require('../../../../src/domain/personality/UserId');
      const { PersonalityId } = require('../../../../src/domain/personality/PersonalityId');

      const userId = new UserId('123456789012345678');
      const personalityId = new PersonalityId('test-personality');
      const content = aiDomain.AIContent.fromText('test');
      const model = aiDomain.AIModel.createDefault();

      const request = aiDomain.AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });

      expect(request).toBeInstanceOf(aiDomain.AIRequest);
    });

    it('should allow creating AI events', () => {
      const requestId = aiDomain.AIRequestId.create();

      const event = new aiDomain.AIRequestCreated('test-aggregate', {
        requestId: requestId.toString(),
        userId: '123456789012345678',
        personalityId: 'test-personality',
        content: { type: 'text', text: 'test' },
        model: { provider: 'test', name: 'test-model' },
        createdAt: new Date().toISOString(),
      });

      expect(event).toBeInstanceOf(aiDomain.AIRequestCreated);
    });
  });

  describe('domain boundary', () => {
    it('should not export internal implementation details', () => {
      // These should not be exported
      expect(aiDomain.AIRequestStatus).toBeUndefined();
      expect(aiDomain.AIProvider).toBeUndefined();
      expect(aiDomain.AIResponse).toBeUndefined();
    });

    it('should provide complete public API', () => {
      const exportedKeys = Object.keys(aiDomain);
      const expectedKeys = [
        'AIRequest',
        'AIRequestId',
        'AIContent',
        'AIModel',
        'AIService',
        'AIRequestDeduplicator',
        'AIRequestRepository',
        'AIRequestCreated',
        'AIRequestSent',
        'AIResponseReceived',
        'AIRequestFailed',
        'AIRequestRetried',
        'AIRequestRateLimited',
        'AIContentSanitized',
        'AIErrorDetected',
      ];

      for (const key of expectedKeys) {
        expect(exportedKeys).toContain(key);
      }

      expect(exportedKeys).toHaveLength(expectedKeys.length);
    });
  });
});
