/**
 * @jest-environment node
 * @testType domain
 *
 * DomainEventBus Test
 * - Tests event bus infrastructure
 * - Minimal mocking (only logger)
 * - Tests event subscription and publishing patterns
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Mock logger
jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

// Domain models under test - NOT mocked!
const { DomainEventBus } = require('../../../../src/domain/shared/DomainEventBus');
const { DomainEvent } = require('../../../../src/domain/shared/DomainEvent');

// Test event
class TestEvent extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);
  }
}

describe('DomainEventBus', () => {
  let eventBus;

  beforeEach(() => {
    jest.clearAllMocks();
    eventBus = new DomainEventBus();
  });

  describe('subscribe', () => {
    it('should subscribe handler to event type', () => {
      const handler = jest.fn();

      const unsubscribe = eventBus.subscribe('TestEvent', handler);

      expect(eventBus.getHandlerCount('TestEvent')).toBe(1);
      expect(unsubscribe).toBeInstanceOf(Function);
    });

    it('should allow multiple handlers for same event', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.subscribe('TestEvent', handler1);
      eventBus.subscribe('TestEvent', handler2);

      expect(eventBus.getHandlerCount('TestEvent')).toBe(2);
    });

    it('should require handler to be a function', () => {
      expect(() => eventBus.subscribe('TestEvent', 'not-a-function')).toThrow(
        'Handler must be a function'
      );
    });

    it('should support wildcard subscription', () => {
      const handler = jest.fn();

      eventBus.subscribe('*', handler);

      expect(eventBus.getHandlerCount('*')).toBe(1);
    });
  });

  describe('unsubscribe', () => {
    it('should remove handler when unsubscribe called', () => {
      const handler = jest.fn();
      const unsubscribe = eventBus.subscribe('TestEvent', handler);

      expect(eventBus.getHandlerCount('TestEvent')).toBe(1);

      unsubscribe();

      expect(eventBus.getHandlerCount('TestEvent')).toBe(0);
    });

    it('should only remove specific handler', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      const unsubscribe1 = eventBus.subscribe('TestEvent', handler1);
      eventBus.subscribe('TestEvent', handler2);

      unsubscribe1();

      expect(eventBus.getHandlerCount('TestEvent')).toBe(1);
    });

    it('should handle multiple unsubscribe calls gracefully', () => {
      const handler = jest.fn();
      const unsubscribe = eventBus.subscribe('TestEvent', handler);

      unsubscribe();
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe('publish', () => {
    it('should call all handlers for event type', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const event = new TestEvent('test-123', { data: 'test' });

      eventBus.subscribe('TestEvent', handler1);
      eventBus.subscribe('TestEvent', handler2);

      await eventBus.publish(event);

      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).toHaveBeenCalledWith(event);
    });

    it('should call wildcard handlers for any event', async () => {
      const wildcardHandler = jest.fn();
      const specificHandler = jest.fn();
      const event = new TestEvent('test-123', {});

      eventBus.subscribe('*', wildcardHandler);
      eventBus.subscribe('TestEvent', specificHandler);

      await eventBus.publish(event);

      expect(wildcardHandler).toHaveBeenCalledWith(event);
      expect(specificHandler).toHaveBeenCalledWith(event);
    });

    it('should require DomainEvent instance', async () => {
      await expect(eventBus.publish({})).rejects.toThrow('Event must be instance of DomainEvent');
    });

    it('should handle no handlers gracefully', async () => {
      const event = new TestEvent('test-123', {});

      await expect(eventBus.publish(event)).resolves.not.toThrow();
    });

    it('should handle async handlers', async () => {
      const asyncHandler = jest.fn().mockResolvedValue('result');
      const event = new TestEvent('test-123', {});

      eventBus.subscribe('TestEvent', asyncHandler);

      await eventBus.publish(event);

      expect(asyncHandler).toHaveBeenCalledWith(event);
    });

    it('should continue if one handler fails', async () => {
      const failingHandler = jest.fn().mockRejectedValue(new Error('Handler error'));
      const successHandler = jest.fn();
      const event = new TestEvent('test-123', {});

      eventBus.subscribe('TestEvent', failingHandler);
      eventBus.subscribe('TestEvent', successHandler);

      await eventBus.publish(event);

      expect(failingHandler).toHaveBeenCalled();
      expect(successHandler).toHaveBeenCalled();
    });
  });

  describe('middleware', () => {
    it('should apply middleware before handlers', async () => {
      const calls = [];
      const middleware = jest.fn(event => {
        calls.push('middleware');
        return event;
      });
      const handler = jest.fn(() => {
        calls.push('handler');
      });
      const event = new TestEvent('test-123', {});

      eventBus.use(middleware);
      eventBus.subscribe('TestEvent', handler);

      await eventBus.publish(event);

      expect(middleware).toHaveBeenCalledWith(event);
      expect(handler).toHaveBeenCalledWith(event);
      expect(calls).toEqual(['middleware', 'handler']);
    });

    it('should apply multiple middleware in order', async () => {
      const calls = [];
      const middleware1 = jest.fn(event => {
        calls.push('middleware1');
        return event;
      });
      const middleware2 = jest.fn(event => {
        calls.push('middleware2');
        return event;
      });

      eventBus.use(middleware1);
      eventBus.use(middleware2);

      await eventBus.publish(new TestEvent('test-123', {}));

      expect(calls).toEqual(['middleware1', 'middleware2']);
    });

    it('should filter event if middleware returns falsy', async () => {
      const filterMiddleware = jest.fn(() => null);
      const handler = jest.fn();

      eventBus.use(filterMiddleware);
      eventBus.subscribe('TestEvent', handler);

      await eventBus.publish(new TestEvent('test-123', {}));

      expect(filterMiddleware).toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it('should allow middleware to transform events', async () => {
      const transformMiddleware = jest.fn(event => {
        return new TestEvent(event.aggregateId, {
          ...event.payload,
          transformed: true,
        });
      });
      const handler = jest.fn();

      eventBus.use(transformMiddleware);
      eventBus.subscribe('TestEvent', handler);

      await eventBus.publish(new TestEvent('test-123', { original: true }));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            original: true,
            transformed: true,
          }),
        })
      );
    });

    it('should require middleware to be a function', () => {
      expect(() => eventBus.use('not-a-function')).toThrow('Middleware must be a function');
    });
  });

  describe('clear', () => {
    it('should remove all handlers and middleware', () => {
      eventBus.subscribe('TestEvent', jest.fn());
      eventBus.subscribe('OtherEvent', jest.fn());
      eventBus.subscribe('*', jest.fn());
      eventBus.use(jest.fn());

      eventBus.clear();

      expect(eventBus.getHandlerCount('TestEvent')).toBe(0);
      expect(eventBus.getHandlerCount('OtherEvent')).toBe(0);
      expect(eventBus.getHandlerCount('*')).toBe(0);
    });
  });

  describe('hasHandlers', () => {
    it('should return false when no handlers', () => {
      expect(eventBus.hasHandlers('TestEvent')).toBe(false);
    });

    it('should return true when specific handler exists', () => {
      eventBus.subscribe('TestEvent', jest.fn());

      expect(eventBus.hasHandlers('TestEvent')).toBe(true);
    });

    it('should return true when only wildcard handler exists', () => {
      eventBus.subscribe('*', jest.fn());

      expect(eventBus.hasHandlers('TestEvent')).toBe(true);
    });
  });
});
