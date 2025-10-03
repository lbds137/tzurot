/**
 * @jest-environment node
 * @testType domain
 *
 * DomainEvent Base Class Test
 * - Pure domain test with no external dependencies
 * - Tests base event functionality and serialization
 * - Uses fake timers for controlled time testing
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain model under test - NOT mocked!
const { DomainEvent } = require('../../../../src/domain/shared/DomainEvent');

// Test event implementation
class TestEvent extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);
  }
}

describe('DomainEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create event with required properties', () => {
      const aggregateId = 'test-123';
      const payload = { data: 'test' };
      const event = new TestEvent(aggregateId, payload);

      expect(event.aggregateId).toBe(aggregateId);
      expect(event.payload).toEqual(payload);
      expect(event.eventType).toBe('TestEvent');
      expect(event.occurredAt).toBeInstanceOf(Date);
      expect(event.eventId).toBeDefined();
    });

    it('should create event with empty payload if not provided', () => {
      const event = new TestEvent('test-123');

      expect(event.payload).toEqual({});
    });

    it('should generate unique event IDs', () => {
      const event1 = new TestEvent('test-123', {});
      const event2 = new TestEvent('test-123', {});

      expect(event1.eventId).not.toBe(event2.eventId);
    });

    it('should include aggregate ID in event ID', () => {
      const aggregateId = 'test-123';
      const event = new TestEvent(aggregateId, {});

      expect(event.eventId).toContain(aggregateId);
    });
  });

  describe('getEventType', () => {
    it('should return the class name as event type', () => {
      const event = new TestEvent('test-123', {});

      expect(event.getEventType()).toBe('TestEvent');
    });

    it('should work with different event classes', () => {
      class AnotherEvent extends DomainEvent {}
      const event = new AnotherEvent('test-123', {});

      expect(event.getEventType()).toBe('AnotherEvent');
    });
  });

  describe('toJSON', () => {
    it('should serialize event to JSON format', () => {
      const aggregateId = 'test-123';
      const payload = { data: 'test', value: 42 };
      const event = new TestEvent(aggregateId, payload);

      const json = event.toJSON();

      expect(json).toEqual({
        eventId: event.eventId,
        eventType: 'TestEvent',
        aggregateId: aggregateId,
        payload: payload,
        occurredAt: event.occurredAt.toISOString(),
      });
    });

    it('should handle complex payloads', () => {
      const payload = {
        nested: { deep: { value: 'test' } },
        array: [1, 2, 3],
        date: new Date('2024-01-01'),
      };
      const event = new TestEvent('test-123', payload);

      const json = event.toJSON();

      expect(json.payload).toEqual(payload);
    });
  });

  describe('fromJSON', () => {
    it('should recreate event from JSON data', () => {
      const originalEvent = new TestEvent('test-123', { data: 'test' });
      const json = originalEvent.toJSON();

      const recreatedEvent = TestEvent.fromJSON(json);

      expect(recreatedEvent).toBeInstanceOf(TestEvent);
      expect(recreatedEvent.eventId).toBe(originalEvent.eventId);
      expect(recreatedEvent.aggregateId).toBe(originalEvent.aggregateId);
      expect(recreatedEvent.payload).toEqual(originalEvent.payload);
      expect(recreatedEvent.occurredAt).toEqual(originalEvent.occurredAt);
    });

    it('should preserve occurred date as Date object', () => {
      const json = {
        eventId: 'test-event-123',
        eventType: 'TestEvent',
        aggregateId: 'test-123',
        payload: { data: 'test' },
        occurredAt: '2024-01-01T00:00:00.000Z',
      };

      const event = TestEvent.fromJSON(json);

      expect(event.occurredAt).toBeInstanceOf(Date);
      expect(event.occurredAt.toISOString()).toBe(json.occurredAt);
    });
  });

  describe('event ordering', () => {
    it('should maintain chronological order', () => {
      const events = [];

      // Create events with controlled time advances
      for (let i = 0; i < 3; i++) {
        events.push(new TestEvent(`test-${i}`, { index: i }));
        jest.advanceTimersByTime(10);
      }

      // Events should be in chronological order
      expect(events[0].occurredAt.getTime()).toBeLessThan(events[1].occurredAt.getTime());
      expect(events[1].occurredAt.getTime()).toBeLessThan(events[2].occurredAt.getTime());
    });
  });
});
