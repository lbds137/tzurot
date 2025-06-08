/**
 * @jest-environment node
 */

const {
  AIRequestCreated,
  AIRequestSent,
  AIResponseReceived,
  AIRequestFailed,
  AIRequestRetried,
  AIRequestRateLimited,
} = require('../../../../src/domain/ai/AIEvents');

describe('AI Events', () => {
  const aggregateId = 'air_123_test';
  
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