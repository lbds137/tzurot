/**
 * @jest-environment node
 * @testType domain
 *
 * AI Events Test
 * - Pure domain test with no external dependencies
 * - Tests AI domain events
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const {
  AIRequestCreated,
  AIRequestSent,
  AIResponseReceived,
  AIRequestFailed,
  AIRequestRetried,
  AIRequestRateLimited,
  AIContentSanitized,
  AIErrorDetected,
} = require('../../../../src/domain/ai/AIEvents');

describe('AI Events', () => {
  const aggregateId = 'air_123_test';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('AIRequestCreated', () => {
    it('should create event with payload', () => {
      const payload = {
        requestId: 'air_123_test',
        userId: '123456789012345678',
        personalityId: 'claude-3-opus',
        content: [{ type: 'text', text: 'Hello' }],
        referencedContent: null,
        model: { name: 'default', path: 'claude-3-opus' },
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const event = new AIRequestCreated(aggregateId, payload);

      expect(event.aggregateId).toBe(aggregateId);
      expect(event.eventType).toBe('AIRequestCreated');
      expect(event.payload).toEqual(payload);
    });

    it('should set event metadata', () => {
      const payload = {
        requestId: 'air_123_test',
        userId: '123456789012345678',
        personalityId: 'claude-3-opus',
        content: [{ type: 'text', text: 'Hello' }],
        referencedContent: null,
        model: { name: 'default', path: 'claude-3-opus' },
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const event = new AIRequestCreated(aggregateId, payload);

      expect(event.eventId).toBeDefined();
      expect(event.occurredAt).toBeDefined();
      expect(event.eventType).toBe('AIRequestCreated');
    });

    it('should throw error when missing required fields', () => {
      const invalidPayloads = [
        { userId: '123', personalityId: 'test', content: [], model: {}, createdAt: '2024' }, // missing requestId
        { requestId: 'test', personalityId: 'test', content: [], model: {}, createdAt: '2024' }, // missing userId
        { requestId: 'test', userId: '123', content: [], model: {}, createdAt: '2024' }, // missing personalityId
        { requestId: 'test', userId: '123', personalityId: 'test', model: {}, createdAt: '2024' }, // missing content
        { requestId: 'test', userId: '123', personalityId: 'test', content: [], createdAt: '2024' }, // missing model
        { requestId: 'test', userId: '123', personalityId: 'test', content: [], model: {} }, // missing createdAt
      ];

      invalidPayloads.forEach(payload => {
        expect(() => new AIRequestCreated(aggregateId, payload)).toThrow(
          'AIRequestCreated requires complete request data'
        );
      });
    });
  });

  describe('AIRequestSent', () => {
    it('should create event with payload', () => {
      const payload = {
        sentAt: '2024-01-01T00:00:01.000Z',
        attempt: 1,
      };

      const event = new AIRequestSent(aggregateId, payload);

      expect(event.aggregateId).toBe(aggregateId);
      expect(event.eventType).toBe('AIRequestSent');
      expect(event.payload).toEqual(payload);
    });

    it('should throw error when missing required fields', () => {
      const invalidPayloads = [
        { attempt: 1 }, // missing sentAt
        { sentAt: '2024-01-01T00:00:01.000Z' }, // missing attempt
        {}, // missing both
      ];

      invalidPayloads.forEach(payload => {
        expect(() => new AIRequestSent(aggregateId, payload)).toThrow(
          'AIRequestSent requires sentAt and attempt'
        );
      });
    });
  });

  describe('AIResponseReceived', () => {
    it('should create event with payload', () => {
      const payload = {
        response: [{ type: 'text', text: 'AI response' }],
        completedAt: '2024-01-01T00:00:02.000Z',
      };

      const event = new AIResponseReceived(aggregateId, payload);

      expect(event.aggregateId).toBe(aggregateId);
      expect(event.eventType).toBe('AIResponseReceived');
      expect(event.payload).toEqual(payload);
    });

    it('should throw error when missing required fields', () => {
      const invalidPayloads = [
        { completedAt: '2024-01-01T00:00:02.000Z' }, // missing response
        { response: [{ type: 'text', text: 'AI response' }] }, // missing completedAt
        {}, // missing both
      ];

      invalidPayloads.forEach(payload => {
        expect(() => new AIResponseReceived(aggregateId, payload)).toThrow(
          'AIResponseReceived requires response and completedAt'
        );
      });
    });
  });

  describe('AIRequestFailed', () => {
    it('should create event with payload', () => {
      const payload = {
        error: {
          message: 'API error',
          code: 'API_ERROR',
          canRetry: true,
        },
        failedAt: '2024-01-01T00:00:02.000Z',
      };

      const event = new AIRequestFailed(aggregateId, payload);

      expect(event.aggregateId).toBe(aggregateId);
      expect(event.eventType).toBe('AIRequestFailed');
      expect(event.payload).toEqual(payload);
    });

    it('should throw error when missing required fields', () => {
      const invalidPayloads = [
        { failedAt: '2024-01-01T00:00:02.000Z' }, // missing error
        { error: { message: 'API error', code: 'API_ERROR', canRetry: true } }, // missing failedAt
        {}, // missing both
      ];

      invalidPayloads.forEach(payload => {
        expect(() => new AIRequestFailed(aggregateId, payload)).toThrow(
          'AIRequestFailed requires error and failedAt'
        );
      });
    });
  });

  describe('AIRequestRetried', () => {
    it('should create event with payload', () => {
      const payload = {
        retryAt: '2024-01-01T00:00:05.000Z',
        attempt: 2,
      };

      const event = new AIRequestRetried(aggregateId, payload);

      expect(event.aggregateId).toBe(aggregateId);
      expect(event.eventType).toBe('AIRequestRetried');
      expect(event.payload).toEqual(payload);
    });

    it('should throw error when missing required fields', () => {
      const invalidPayloads = [
        { attempt: 2 }, // missing retryAt
        { retryAt: '2024-01-01T00:00:05.000Z' }, // missing attempt
        { retryAt: '2024-01-01T00:00:05.000Z', attempt: undefined }, // attempt is undefined
        {}, // missing both
      ];

      invalidPayloads.forEach(payload => {
        expect(() => new AIRequestRetried(aggregateId, payload)).toThrow(
          'AIRequestRetried requires retryAt and attempt'
        );
      });
    });
  });

  describe('AIRequestRateLimited', () => {
    it('should create event with payload', () => {
      const payload = {
        rateLimitedAt: '2024-01-01T00:00:02.000Z',
        retryAfter: 60000,
      };

      const event = new AIRequestRateLimited(aggregateId, payload);

      expect(event.aggregateId).toBe(aggregateId);
      expect(event.eventType).toBe('AIRequestRateLimited');
      expect(event.payload).toEqual(payload);
    });

    it('should throw error when missing required fields', () => {
      const invalidPayloads = [
        { retryAfter: 60000 }, // missing rateLimitedAt
        { rateLimitedAt: '2024-01-01T00:00:02.000Z' }, // missing retryAfter
        { rateLimitedAt: '2024-01-01T00:00:02.000Z', retryAfter: undefined }, // retryAfter is undefined
        {}, // missing both
      ];

      invalidPayloads.forEach(payload => {
        expect(() => new AIRequestRateLimited(aggregateId, payload)).toThrow(
          'AIRequestRateLimited requires rateLimitedAt and retryAfter'
        );
      });
    });
  });

  describe('AIContentSanitized', () => {
    it('should create event with payload', () => {
      const payload = {
        originalLength: 1000,
        sanitizedLength: 950,
        sanitizedAt: '2024-01-01T00:00:03.000Z',
      };

      const event = new AIContentSanitized(aggregateId, payload);

      expect(event.aggregateId).toBe(aggregateId);
      expect(event.eventType).toBe('AIContentSanitized');
      expect(event.payload).toEqual(payload);
    });

    it('should throw error when missing required fields', () => {
      const invalidPayloads = [
        { sanitizedLength: 950, sanitizedAt: '2024-01-01T00:00:03.000Z' }, // missing originalLength
        { originalLength: 1000, sanitizedAt: '2024-01-01T00:00:03.000Z' }, // missing sanitizedLength
        { originalLength: 1000, sanitizedLength: 950 }, // missing sanitizedAt
        {}, // missing all
      ];

      invalidPayloads.forEach(payload => {
        expect(() => new AIContentSanitized(aggregateId, payload)).toThrow(
          'AIContentSanitized requires length data and sanitizedAt'
        );
      });
    });
  });

  describe('AIErrorDetected', () => {
    it('should create event with payload', () => {
      const payload = {
        errorType: 'RATE_LIMIT',
        detectedAt: '2024-01-01T00:00:04.000Z',
      };

      const event = new AIErrorDetected(aggregateId, payload);

      expect(event.aggregateId).toBe(aggregateId);
      expect(event.eventType).toBe('AIErrorDetected');
      expect(event.payload).toEqual(payload);
    });

    it('should throw error when missing required fields', () => {
      const invalidPayloads = [
        { detectedAt: '2024-01-01T00:00:04.000Z' }, // missing errorType
        { errorType: 'RATE_LIMIT' }, // missing detectedAt
        {}, // missing both
      ];

      invalidPayloads.forEach(payload => {
        expect(() => new AIErrorDetected(aggregateId, payload)).toThrow(
          'AIErrorDetected requires errorType and detectedAt'
        );
      });
    });
  });

  describe('Event serialization', () => {
    it('should serialize to JSON', () => {
      const payload = {
        requestId: aggregateId,
        userId: '123456789012345678',
        personalityId: 'claude-3-opus',
        content: [{ type: 'text', text: 'Hello' }],
        referencedContent: null,
        model: { name: 'default', path: 'claude-3-opus' },
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const event = new AIRequestCreated(aggregateId, payload);
      const json = event.toJSON();

      expect(json).toMatchObject({
        eventId: event.eventId,
        aggregateId: aggregateId,
        eventType: 'AIRequestCreated',
        payload: payload,
      });
      expect(json.occurredAt).toBeDefined();
    });
  });

  describe('Event reconstruction', () => {
    it('should reconstruct from JSON', () => {
      const payload = {
        requestId: aggregateId,
        userId: '123456789012345678',
        personalityId: 'claude-3-opus',
        content: [{ type: 'text', text: 'Hello' }],
        referencedContent: null,
        model: { name: 'default', path: 'claude-3-opus' },
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const originalEvent = new AIRequestCreated(aggregateId, payload);
      const json = originalEvent.toJSON();
      const reconstructed = AIRequestCreated.fromJSON(json);

      expect(reconstructed).toBeInstanceOf(AIRequestCreated);
      expect(reconstructed.aggregateId).toBe(originalEvent.aggregateId);
      expect(reconstructed.payload).toEqual(originalEvent.payload);
    });
  });
});
