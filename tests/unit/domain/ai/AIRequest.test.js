/**
 * @jest-environment node
 * @testType domain
 *
 * AIRequest Aggregate Test
 * - Pure domain test with no external dependencies
 * - Tests AI request aggregate with event sourcing
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const { AIRequest } = require('../../../../src/domain/ai/AIRequest');
const { AIRequestId } = require('../../../../src/domain/ai/AIRequestId');
const { AIContent } = require('../../../../src/domain/ai/AIContent');
const { AIModel } = require('../../../../src/domain/ai/AIModel');
const { PersonalityId } = require('../../../../src/domain/personality/PersonalityId');
const { UserId } = require('../../../../src/domain/personality/UserId');
const {
  AIRequestCreated,
  AIRequestSent,
  AIResponseReceived,
  AIRequestFailed,
  AIRequestRetried,
  AIRequestRateLimited,
} = require('../../../../src/domain/ai/AIEvents');

describe('AIRequest', () => {
  let requestId;
  let userId;
  let personalityId;
  let content;
  let model;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    requestId = AIRequestId.create();
    userId = new UserId('123456789012345678');
    personalityId = new PersonalityId('claude-3-opus');
    content = AIContent.fromText('Hello, AI!');
    model = AIModel.createDefault();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should require AIRequestId', () => {
      expect(() => new AIRequest('string-id')).toThrow(
        'AIRequest must be created with AIRequestId'
      );
    });

    it('should initialize with AIRequestId', () => {
      const request = new AIRequest(requestId);

      expect(request.id).toBe(requestId.toString());
      expect(request.requestId).toBe(requestId);
      expect(request.userId).toBeNull();
      expect(request.personalityId).toBeNull();
      expect(request.content).toBeNull();
      expect(request.referencedContent).toBeNull();
      expect(request.model).toBeNull();
      expect(request.response).toBeNull();
      expect(request.status).toBe('pending');
      expect(request.attempts).toBe(0);
      expect(request.error).toBeNull();
    });
  });

  describe('create', () => {
    it('should create new AI request', () => {
      const request = AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });

      expect(request).toBeInstanceOf(AIRequest);
      expect(request.userId).toEqual(userId);
      expect(request.personalityId).toEqual(personalityId);
      expect(request.content).toEqual(content);
      expect(request.model).toEqual(model);
      expect(request.status).toBe('pending');
      expect(request.attempts).toBe(0);
      expect(request.createdAt).toBeDefined();
    });

    it('should emit AIRequestCreated event', () => {
      const request = AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });

      const events = request.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(AIRequestCreated);
      expect(events[0].payload).toMatchObject({
        userId: userId.toString(),
        personalityId: personalityId.toString(),
        content: content.toJSON(),
        model: model.toJSON(),
      });
    });

    it('should accept referenced content', () => {
      const referencedContent = AIContent.fromText('Referenced message');

      const request = AIRequest.create({
        userId,
        personalityId,
        content,
        referencedContent,
        model,
      });

      expect(request.referencedContent).toEqual(referencedContent);
    });

    it('should use default model if not provided', () => {
      const request = AIRequest.create({
        userId,
        personalityId,
        content,
      });

      expect(request.model).toBeDefined();
      expect(request.model.name).toBe('default');
    });

    it('should validate UserId', () => {
      expect(() =>
        AIRequest.create({
          userId: 'invalid',
          personalityId,
          content,
          model,
        })
      ).toThrow('Invalid UserId');
    });

    it('should validate PersonalityId', () => {
      expect(() =>
        AIRequest.create({
          userId,
          personalityId: 'invalid',
          content,
          model,
        })
      ).toThrow('Invalid PersonalityId');
    });

    it('should validate AIContent', () => {
      expect(() =>
        AIRequest.create({
          userId,
          personalityId,
          content: 'invalid',
          model,
        })
      ).toThrow('Invalid AIContent');
    });

    it('should validate AIModel', () => {
      expect(() =>
        AIRequest.create({
          userId,
          personalityId,
          content,
          model: 'invalid',
        })
      ).toThrow('Invalid AIModel');
    });

    it('should validate content compatibility with model', () => {
      const audioContent = new AIContent([
        { type: 'text', text: 'Check this audio' },
        { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' } },
      ]);

      const textOnlyModel = new AIModel('text-only', 'gpt-3.5', {
        supportsImages: false,
        supportsAudio: false,
      });

      expect(() =>
        AIRequest.create({
          userId,
          personalityId,
          content: audioContent,
          model: textOnlyModel,
        })
      ).toThrow('Content not compatible with model capabilities');
    });
  });

  describe('markSent', () => {
    let request;

    beforeEach(() => {
      request = AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });
      request.markEventsAsCommitted();
    });

    it('should mark request as sent', () => {
      request.markSent();

      expect(request.status).toBe('sent');
      expect(request.sentAt).toBeDefined();
      expect(request.attempts).toBe(1);
    });

    it('should emit AIRequestSent event', () => {
      request.markSent();

      const events = request.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(AIRequestSent);
      expect(events[0].payload).toMatchObject({
        sentAt: '2024-01-01T00:00:00.000Z',
        attempt: 1,
      });
    });

    it('should allow sending from retrying status', () => {
      // Simulate failure and retry
      request.markSent();
      request.recordFailure(new Error('Temporary error'));
      request.scheduleRetry(5000);
      request.markEventsAsCommitted();

      request.markSent();

      expect(request.status).toBe('sent');
      expect(request.attempts).toBe(2);
    });

    it('should reject if already sent', () => {
      request.markSent();

      expect(() => request.markSent()).toThrow('Can only send pending or retrying requests');
    });

    it('should reject if completed', () => {
      request.markSent();
      request.recordResponse(AIContent.fromText('Response'));

      expect(() => request.markSent()).toThrow('Can only send pending or retrying requests');
    });
  });

  describe('recordResponse', () => {
    let request;

    beforeEach(() => {
      request = AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });
      request.markSent();
      request.markEventsAsCommitted();
    });

    it('should record successful response', () => {
      const responseContent = AIContent.fromText('AI response');

      request.recordResponse(responseContent);

      expect(request.response).toEqual(responseContent);
      expect(request.status).toBe('completed');
      expect(request.completedAt).toBeDefined();
    });

    it('should emit AIResponseReceived event', () => {
      const responseContent = AIContent.fromText('AI response');

      request.recordResponse(responseContent);

      const events = request.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(AIResponseReceived);
      expect(events[0].payload).toMatchObject({
        response: responseContent.toJSON(),
        completedAt: '2024-01-01T00:00:00.000Z',
      });
    });

    it('should validate response content', () => {
      expect(() => request.recordResponse('invalid')).toThrow('Invalid response content');
    });

    it('should require sent status', () => {
      const pendingRequest = AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });

      expect(() => pendingRequest.recordResponse(AIContent.fromText('Response'))).toThrow(
        'Can only record response for sent requests'
      );
    });
  });

  describe('recordFailure', () => {
    let request;

    beforeEach(() => {
      request = AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });
      request.markSent();
      request.markEventsAsCommitted();
    });

    it('should record request failure', () => {
      const error = new Error('API error');
      error.code = 'API_ERROR';

      request.recordFailure(error);

      expect(request.status).toBe('failed');
      expect(request.error).toMatchObject({
        message: 'API error',
        code: 'API_ERROR',
        canRetry: true,
      });
    });

    it('should emit AIRequestFailed event', () => {
      const error = new Error('API error');

      request.recordFailure(error);

      const events = request.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(AIRequestFailed);
      expect(events[0].payload.error).toMatchObject({
        message: 'API error',
        code: 'UNKNOWN',
        canRetry: true,
      });
    });

    it('should mark as non-retryable', () => {
      const error = new Error('Invalid API key');

      request.recordFailure(error, false);

      expect(request.error.canRetry).toBe(false);
    });

    it('should reject if already completed', () => {
      request.recordResponse(AIContent.fromText('Response'));

      expect(() => request.recordFailure(new Error('Late error'))).toThrow(
        'Cannot fail completed or failed request'
      );
    });

    it('should reject if already failed', () => {
      request.recordFailure(new Error('First error'));

      expect(() => request.recordFailure(new Error('Second error'))).toThrow(
        'Cannot fail completed or failed request'
      );
    });
  });

  describe('scheduleRetry', () => {
    let request;

    beforeEach(() => {
      request = AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });
      request.markSent();
      request.recordFailure(new Error('Temporary error'));
      request.markEventsAsCommitted();
    });

    it('should schedule retry', () => {
      request.scheduleRetry(5000);

      expect(request.status).toBe('retrying');
    });

    it('should emit AIRequestRetried event', () => {
      request.scheduleRetry(5000);

      const events = request.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(AIRequestRetried);
      expect(events[0].payload).toMatchObject({
        retryAt: '2024-01-01T00:00:05.000Z',
        attempt: 1,
      });
    });

    it('should require failed status', () => {
      const sentRequest = AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });
      sentRequest.markSent();

      expect(() => sentRequest.scheduleRetry(5000)).toThrow('Can only retry failed requests');
    });

    it('should enforce maximum retry attempts', () => {
      // Already at attempt 1 from beforeEach
      // Retry twice more (attempts 2 and 3)
      for (let i = 0; i < 2; i++) {
        request.scheduleRetry(5000);
        request.markSent();
        request.recordFailure(new Error(`Attempt ${i + 2} failed`));
        request.markEventsAsCommitted();
      }

      // Now at 3 attempts, next retry should fail
      expect(() => request.scheduleRetry(5000)).toThrow('Maximum retry attempts exceeded');
    });
  });

  describe('recordRateLimit', () => {
    let request;

    beforeEach(() => {
      request = AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });
      request.markEventsAsCommitted();
    });

    it('should record rate limit', () => {
      request.recordRateLimit(60000);

      expect(request.status).toBe('rate_limited');
    });

    it('should emit AIRequestRateLimited event', () => {
      request.recordRateLimit(60000);

      const events = request.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(AIRequestRateLimited);
      expect(events[0].payload).toMatchObject({
        rateLimitedAt: '2024-01-01T00:00:00.000Z',
        retryAfter: 60000,
      });
    });
  });

  describe('canRetry', () => {
    let request;

    beforeEach(() => {
      request = AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });
    });

    it('should return true for retryable failure', () => {
      request.markSent();
      request.recordFailure(new Error('Temporary error'));

      expect(request.canRetry()).toBe(true);
    });

    it('should return false for non-retryable failure', () => {
      request.markSent();
      request.recordFailure(new Error('Invalid API key'), false);

      expect(request.canRetry()).toBe(false);
    });

    it('should return false after max attempts', () => {
      // Fail and retry 3 times
      for (let i = 0; i < 3; i++) {
        request.markSent();
        request.recordFailure(new Error(`Attempt ${i + 1} failed`));
        if (i < 2) {
          request.scheduleRetry(5000);
        }
      }

      expect(request.canRetry()).toBe(false);
    });

    it('should return false for non-failed status', () => {
      expect(request.canRetry()).toBe(false); // pending

      request.markSent();
      expect(request.canRetry()).toBe(false); // sent

      request.recordResponse(AIContent.fromText('Response'));
      expect(request.canRetry()).toBe(false); // completed
    });
  });

  describe('getResponseTime', () => {
    let request;

    beforeEach(() => {
      request = AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });
    });

    it('should return response time in milliseconds', () => {
      request.markSent();

      jest.advanceTimersByTime(1500); // 1.5 seconds

      request.recordResponse(AIContent.fromText('Response'));

      expect(request.getResponseTime()).toBe(1500);
    });

    it('should return null if not sent', () => {
      expect(request.getResponseTime()).toBeNull();
    });

    it('should return null if not completed', () => {
      request.markSent();

      expect(request.getResponseTime()).toBeNull();
    });
  });

  describe('event sourcing', () => {
    it('should rebuild state from events', () => {
      const requestId = AIRequestId.create();
      const events = [
        new AIRequestCreated(requestId.toString(), {
          requestId: requestId.toString(),
          userId: userId.toString(),
          personalityId: personalityId.toString(),
          content: content.toJSON(),
          referencedContent: null,
          model: model.toJSON(),
          createdAt: '2024-01-01T00:00:00.000Z',
        }),
        new AIRequestSent(requestId.toString(), {
          sentAt: '2024-01-01T00:00:01.000Z',
          attempt: 1,
        }),
        new AIResponseReceived(requestId.toString(), {
          response: AIContent.fromText('AI response').toJSON(),
          completedAt: '2024-01-01T00:00:02.000Z',
        }),
      ];

      const request = new AIRequest(requestId);
      request.loadFromHistory(events);

      expect(request.status).toBe('completed');
      expect(request.attempts).toBe(1);
      expect(request.response.getText()).toBe('AI response');
      expect(request.version).toBe(3);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const request = AIRequest.create({
        userId,
        personalityId,
        content,
        model,
      });
      request.markSent();
      request.recordResponse(AIContent.fromText('Response'));

      const json = request.toJSON();

      expect(json).toMatchObject({
        userId: userId.toString(),
        personalityId: personalityId.toString(),
        content: content.toJSON(),
        model: model.toJSON(),
        status: 'completed',
        attempts: 1,
        version: 3,
      });
      expect(json.createdAt).toBeDefined();
      expect(json.sentAt).toBeDefined();
      expect(json.completedAt).toBeDefined();
      expect(json.response).toBeDefined();
    });

    it('should handle null values', () => {
      const request = new AIRequest(requestId);

      const json = request.toJSON();

      expect(json.response).toBeNull();
      expect(json.referencedContent).toBeNull();
      expect(json.error).toBeNull();
    });
  });
});
