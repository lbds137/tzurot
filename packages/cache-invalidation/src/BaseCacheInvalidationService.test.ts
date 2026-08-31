/**
 * Tests for BaseCacheInvalidationService
 *
 * Tests the base class functionality and helper functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BaseCacheInvalidationService,
  createStandardEventValidator,
  createEventValidator,
  type StandardInvalidationEvent,
  type EventValidator,
} from './BaseCacheInvalidationService.js';

// Mock logger
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});
describe('createStandardEventValidator', () => {
  const validator = createStandardEventValidator<StandardInvalidationEvent>();

  describe('valid events', () => {
    it('should validate "all" event type', () => {
      expect(validator({ type: 'all' })).toBe(true);
    });

    it('should validate "user" event type with discordId', () => {
      expect(validator({ type: 'user', discordId: '123456789' })).toBe(true);
    });

    it('should validate "user" event with empty discordId', () => {
      // Empty string is a valid string type
      expect(validator({ type: 'user', discordId: '' })).toBe(true);
    });
  });

  describe('invalid events', () => {
    it('should reject null', () => {
      expect(validator(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(validator(undefined)).toBe(false);
    });

    it('should reject non-objects', () => {
      expect(validator('string')).toBe(false);
      expect(validator(123)).toBe(false);
      expect(validator(true)).toBe(false);
      expect(validator([])).toBe(false);
    });

    it('should reject unknown event types', () => {
      expect(validator({ type: 'unknown' })).toBe(false);
      expect(validator({ type: 'config' })).toBe(false);
      expect(validator({ type: 'guild' })).toBe(false);
    });

    it('should reject "user" event without discordId', () => {
      expect(validator({ type: 'user' })).toBe(false);
    });

    it('should reject "user" event with wrong discordId type', () => {
      expect(validator({ type: 'user', discordId: 123 })).toBe(false);
      expect(validator({ type: 'user', discordId: null })).toBe(false);
      expect(validator({ type: 'user', discordId: undefined })).toBe(false);
      expect(validator({ type: 'user', discordId: {} })).toBe(false);
    });

    it('should reject "all" event with extra properties', () => {
      expect(validator({ type: 'all', extra: 'field' })).toBe(false);
      expect(validator({ type: 'all', discordId: '123' })).toBe(false);
    });

    it('should reject "user" event with extra properties', () => {
      expect(validator({ type: 'user', discordId: '123', extra: 'field' })).toBe(false);
    });

    it('should reject objects without type property', () => {
      expect(validator({})).toBe(false);
      expect(validator({ discordId: '123' })).toBe(false);
    });
  });
});

describe('createEventValidator', () => {
  type TestEvent =
    | { type: 'user'; discordId: string }
    | { type: 'config'; configId: string }
    | { type: 'admin' }
    | { type: 'all' };

  const validator = createEventValidator<TestEvent>([
    { type: 'user', fields: { discordId: 'string' } },
    { type: 'config', fields: { configId: 'string' } },
    { type: 'admin' },
    { type: 'all' },
  ]);

  describe('valid events', () => {
    it('should validate type-only events', () => {
      expect(validator({ type: 'all' })).toBe(true);
      expect(validator({ type: 'admin' })).toBe(true);
    });

    it('should validate events with string fields', () => {
      expect(validator({ type: 'user', discordId: '123456789' })).toBe(true);
      expect(validator({ type: 'config', configId: 'cfg-1' })).toBe(true);
    });

    it('should accept empty strings for string fields', () => {
      expect(validator({ type: 'user', discordId: '' })).toBe(true);
    });
  });

  describe('invalid events', () => {
    it('should reject null and undefined', () => {
      expect(validator(null)).toBe(false);
      expect(validator(undefined)).toBe(false);
    });

    it('should reject non-objects', () => {
      expect(validator('string')).toBe(false);
      expect(validator(123)).toBe(false);
      expect(validator(true)).toBe(false);
      expect(validator([])).toBe(false);
    });

    it('should reject unknown event types', () => {
      expect(validator({ type: 'unknown' })).toBe(false);
      expect(validator({ type: 'guild' })).toBe(false);
    });

    it('should reject events missing required fields', () => {
      expect(validator({ type: 'user' })).toBe(false);
      expect(validator({ type: 'config' })).toBe(false);
    });

    it('should reject events with wrong field types', () => {
      expect(validator({ type: 'user', discordId: 123 })).toBe(false);
      expect(validator({ type: 'user', discordId: null })).toBe(false);
      expect(validator({ type: 'config', configId: true })).toBe(false);
    });

    it('should reject events with extra properties', () => {
      expect(validator({ type: 'all', extra: 'field' })).toBe(false);
      expect(validator({ type: 'admin', extra: 'field' })).toBe(false);
      expect(validator({ type: 'user', discordId: '123', extra: 'field' })).toBe(false);
    });

    it('should reject objects without type property', () => {
      expect(validator({})).toBe(false);
      expect(validator({ discordId: '123' })).toBe(false);
    });
  });

  describe('numeric fields', () => {
    type NumericEvent = { type: 'threshold'; value: number } | { type: 'all' };
    const numValidator = createEventValidator<NumericEvent>([
      { type: 'threshold', fields: { value: 'number' } },
      { type: 'all' },
    ]);

    it('should validate numeric fields', () => {
      expect(numValidator({ type: 'threshold', value: 42 })).toBe(true);
      expect(numValidator({ type: 'threshold', value: 0 })).toBe(true);
    });

    it('should reject wrong types for numeric fields', () => {
      expect(numValidator({ type: 'threshold', value: '42' })).toBe(false);
    });
  });

  describe('produces same results as createStandardEventValidator', () => {
    const factoryValidator = createEventValidator<StandardInvalidationEvent>([
      { type: 'user', fields: { discordId: 'string' } },
      { type: 'all' },
    ]);
    const standardValidator = createStandardEventValidator<StandardInvalidationEvent>();

    const testCases = [
      { type: 'all' },
      { type: 'user', discordId: '123' },
      { type: 'user', discordId: '' },
      { type: 'user' },
      { type: 'user', discordId: 123 },
      { type: 'all', extra: 'field' },
      { type: 'user', discordId: '123', extra: 'field' },
      { type: 'unknown' },
      {},
      null,
      'string',
    ];

    for (const testCase of testCases) {
      it(`should match standard validator for ${JSON.stringify(testCase)}`, () => {
        expect(factoryValidator(testCase)).toBe(standardValidator(testCase));
      });
    }
  });
});

describe('BaseCacheInvalidationService', () => {
  // Create a concrete implementation for testing
  class TestCacheInvalidationService extends BaseCacheInvalidationService<StandardInvalidationEvent> {
    constructor(
      redis: ReturnType<typeof createMockRedis>,
      logOptions?: {
        getLogContext?: (event: StandardInvalidationEvent) => Record<string, unknown>;
        getEventDescription?: (event: StandardInvalidationEvent) => string;
      }
    ) {
      super(
        redis as never,
        'test:channel',
        'TestCacheInvalidationService',
        createStandardEventValidator<StandardInvalidationEvent>(),
        logOptions
      );
    }
  }

  function createMockRedis() {
    return {
      duplicate: vi.fn(),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue(1),
      disconnect: vi.fn(),
      on: vi.fn(),
    };
  }

  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockSubscriber: ReturnType<typeof createMockRedis>;
  let service: TestCacheInvalidationService;

  beforeEach(() => {
    mockSubscriber = createMockRedis();
    mockRedis = createMockRedis();
    mockRedis.duplicate.mockReturnValue(mockSubscriber);
    service = new TestCacheInvalidationService(mockRedis);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('subscribe', () => {
    it('should create a duplicate Redis connection', async () => {
      await service.subscribe(vi.fn());

      expect(mockRedis.duplicate).toHaveBeenCalledTimes(1);
    });

    it('should subscribe to the configured channel', async () => {
      await service.subscribe(vi.fn());

      expect(mockSubscriber.subscribe).toHaveBeenCalledWith('test:channel');
    });

    it('should never put the shared client into subscriber mode', async () => {
      await service.subscribe(vi.fn());

      // Load-bearing for the caller, not just tidy: api-gateway hands this same
      // client to the dedup cache and rate limiters and configures it with a
      // commandTimeout. A connection in subscriber mode accepts only pub/sub
      // commands, so subscribing HERE instead of on the duplicate would break
      // every other consumer of the shared client.
      expect(mockRedis.subscribe).not.toHaveBeenCalled();
      expect(mockSubscriber.subscribe).toHaveBeenCalled();
    });

    it('should register a message handler', async () => {
      await service.subscribe(vi.fn());

      expect(mockSubscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should not create multiple subscribers', async () => {
      await service.subscribe(vi.fn());
      await service.subscribe(vi.fn());
      await service.subscribe(vi.fn());

      expect(mockRedis.duplicate).toHaveBeenCalledTimes(1);
    });

    it('should register multiple callbacks', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      await service.subscribe(callback1);
      await service.subscribe(callback2);
      await service.subscribe(callback3);

      // Get message handler and trigger it
      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('test:channel', JSON.stringify({ type: 'all' }));

      expect(callback1).toHaveBeenCalledWith({ type: 'all' });
      expect(callback2).toHaveBeenCalledWith({ type: 'all' });
      expect(callback3).toHaveBeenCalledWith({ type: 'all' });
    });

    it('should isolate callback errors — a throwing callback must not block later ones', async () => {
      const throwing = vi.fn().mockImplementation(() => {
        throw new Error('subscriber bug');
      });
      const healthy = vi.fn();

      await service.subscribe(throwing);
      await service.subscribe(healthy);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      expect(() => {
        messageHandler('test:channel', JSON.stringify({ type: 'all' }));
      }).not.toThrow();
      expect(throwing).toHaveBeenCalled();
      expect(healthy).toHaveBeenCalledWith({ type: 'all' });
    });

    it('should clean up on subscribe error', async () => {
      mockSubscriber.subscribe.mockRejectedValue(new Error('Connection failed'));

      await expect(service.subscribe(vi.fn())).rejects.toThrow('Connection failed');
      expect(mockSubscriber.disconnect).toHaveBeenCalled();
    });

    it('should allow subscribing after failed subscribe', async () => {
      mockSubscriber.subscribe.mockRejectedValueOnce(new Error('Temporary error'));
      mockSubscriber.subscribe.mockResolvedValueOnce(undefined);

      await expect(service.subscribe(vi.fn())).rejects.toThrow('Temporary error');

      // Reset the mock subscriber for retry
      mockRedis.duplicate.mockReturnValue(mockSubscriber);

      await service.subscribe(vi.fn());
      expect(service.isSubscribed()).toBe(true);
    });

    it('starts with an empty callback list — a seeded bogus entry would throw on dispatch', async () => {
      mockLogger.error.mockClear();
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('test:channel', JSON.stringify({ type: 'all' }));

      expect(callback).toHaveBeenCalledWith({ type: 'all' });
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('propagates the original error when creating the duplicate connection fails', async () => {
      mockRedis.duplicate.mockImplementation(() => {
        throw new Error('Duplicate failed');
      });

      // The cleanup guard must not dereference a null subscriber when
      // duplicate() itself throws before any subscriber is assigned.
      await expect(service.subscribe(vi.fn())).rejects.toThrow('Duplicate failed');
    });

    describe('callback cleanup on failed subscribe', () => {
      // Read the private callback list directly for the one assertion that
      // needs the actual array state rather than an inferred behavior —
      // no existing test in this file exposes an accessor for it.
      function getRegisteredCallbacks(
        svc: TestCacheInvalidationService
      ): ((event: StandardInvalidationEvent) => void)[] {
        return (svc as unknown as { callbacks: ((event: StandardInvalidationEvent) => void)[] })
          .callbacks;
      }

      it('leaves the callback list empty after a failed subscribe', async () => {
        mockSubscriber.subscribe.mockRejectedValueOnce(new Error('boom'));

        await expect(service.subscribe(vi.fn())).rejects.toThrow('boom');

        expect(getRegisteredCallbacks(service)).toEqual([]);
      });

      it('does not leave a stale callback registered after subscribe fails — a later successful subscribe delivers to the new callback only', async () => {
        mockSubscriber.subscribe.mockRejectedValueOnce(new Error('Temporary error'));
        const callbackA = vi.fn();

        await expect(service.subscribe(callbackA)).rejects.toThrow('Temporary error');

        // Retry: same duplicate mock, but subscribe() now resolves.
        mockRedis.duplicate.mockReturnValue(mockSubscriber);
        const callbackB = vi.fn();
        await service.subscribe(callbackB);

        const messageHandler = mockSubscriber.on.mock.calls.find(
          (call: unknown[]) => call[0] === 'message'
        )?.[1] as (channel: string, message: string) => void;

        messageHandler('test:channel', JSON.stringify({ type: 'all' }));

        expect(callbackB).toHaveBeenCalledWith({ type: 'all' });
        expect(callbackA).not.toHaveBeenCalled();
      });

      it('removes the failed caller by identity, not position — an interleaved early-return registration must survive', async () => {
        // Caller A's subscribe() connects but hangs mid-flight (the mock
        // Promise below is neither resolved nor rejected yet). While A is
        // still awaiting, caller B calls subscribe() and hits the
        // "Already subscribed" early-return path (subscriber is already
        // assigned, synchronously, before A's await point) — B pushes its
        // own callback and returns immediately. A is left pending until we
        // reject it below. If cleanup removed the LAST array entry (pop())
        // instead of A's own entry, it would incorrectly evict B instead.
        let rejectSubscribe: (err: Error) => void = () => {};
        const pending = new Promise<void>((_, reject) => {
          rejectSubscribe = reject;
        });
        mockSubscriber.subscribe.mockReturnValueOnce(pending);

        const callbackA = vi.fn();
        const callbackB = vi.fn();

        const subscribeA = service.subscribe(callbackA);
        await service.subscribe(callbackB); // early-return path, resolves immediately

        rejectSubscribe(new Error('mid-flight failure'));
        await expect(subscribeA).rejects.toThrow('mid-flight failure');

        // A's connection attempt never reached the 'message' handler
        // registration, so retry with a fresh caller to wire up delivery.
        mockRedis.duplicate.mockReturnValue(mockSubscriber);
        const callbackC = vi.fn();
        await service.subscribe(callbackC);

        const messageHandler = mockSubscriber.on.mock.calls.find(
          (call: unknown[]) => call[0] === 'message'
        )?.[1] as (channel: string, message: string) => void;

        messageHandler('test:channel', JSON.stringify({ type: 'all' }));

        expect(callbackB).toHaveBeenCalledWith({ type: 'all' });
        expect(callbackC).toHaveBeenCalledWith({ type: 'all' });
        expect(callbackA).not.toHaveBeenCalled();
      });

      it('does not evict a survivor when the failed caller is absent from the list — unsubscribe() cleared it mid-flight', async () => {
        // Caller A connects then hangs, exactly like the interleaving test
        // above, but this time a shutdown races it instead of another
        // subscribe(): unsubscribe() clears the callback list (and the
        // connection) before A's own subscribe() settles. A gets its own
        // distinct connection mock so the assertions below can tell A's
        // straggling connection apart from B's live one.
        const subscriberA = createMockRedis();
        let rejectSubscribeA: (err: Error) => void = () => {};
        const pendingA = new Promise<void>((_, reject) => {
          rejectSubscribeA = reject;
        });
        subscriberA.subscribe.mockReturnValueOnce(pendingA);
        mockRedis.duplicate.mockReturnValueOnce(subscriberA);

        const callbackA = vi.fn();
        const subscribeA = service.subscribe(callbackA);

        await service.unsubscribe();

        // A later subscribe(B) succeeds and registers B against a fresh
        // connection — A's callback is no longer in the array at all.
        mockRedis.duplicate.mockReturnValue(mockSubscriber);
        const callbackB = vi.fn();
        await service.subscribe(callbackB);

        // Now A's original in-flight subscribe rejects. indexOf(A) must
        // return -1 (A isn't in the current array), so the guard must skip
        // the splice — an unconditional splice(-1, 1) would instead evict
        // the LAST element, which is B.
        rejectSubscribeA(new Error('mid-flight failure'));
        await expect(subscribeA).rejects.toThrow('mid-flight failure');

        // A's straggling catch cleans up only the connection it created —
        // B's live connection (a different object from A's) survives, and
        // the service stays subscribed.
        expect(service.isSubscribed()).toBe(true);
        expect(subscriberA.disconnect).toHaveBeenCalled();
        expect(mockSubscriber.disconnect).not.toHaveBeenCalled();

        const messageHandler = mockSubscriber.on.mock.calls.find(
          (call: unknown[]) => call[0] === 'message'
        )?.[1] as (channel: string, message: string) => void;

        messageHandler('test:channel', JSON.stringify({ type: 'all' }));

        expect(callbackB).toHaveBeenCalledWith({ type: 'all' });
      });

      it('removes the failed caller from its own index, not just index 0 — a failure at index 1 is still evicted', async () => {
        // A connects then hangs; B hits the early-return path while A is
        // still in flight, so the callback list is [A, B].
        let rejectSubscribeA: (err: Error) => void = () => {};
        const pendingA = new Promise<void>((_, reject) => {
          rejectSubscribeA = reject;
        });
        mockSubscriber.subscribe.mockReturnValueOnce(pendingA);

        const callbackA = vi.fn();
        const callbackB = vi.fn();
        const subscribeA = service.subscribe(callbackA);
        await service.subscribe(callbackB); // early-return path

        // A rejects and is removed at its own index (0), leaving [B].
        rejectSubscribeA(new Error('A failure'));
        await expect(subscribeA).rejects.toThrow('A failure');

        // C now subscribes against a fresh connection, landing at index 1
        // (after survivor B) — and its own connection attempt fails too.
        mockRedis.duplicate.mockReturnValue(mockSubscriber);
        mockSubscriber.subscribe.mockRejectedValueOnce(new Error('C failure'));
        const callbackC = vi.fn();
        await expect(service.subscribe(callbackC)).rejects.toThrow('C failure');

        // A final successful subscribe re-establishes delivery.
        mockRedis.duplicate.mockReturnValue(mockSubscriber);
        const callbackD = vi.fn();
        await service.subscribe(callbackD);

        const messageHandler = mockSubscriber.on.mock.calls.find(
          (call: unknown[]) => call[0] === 'message'
        )?.[1] as (channel: string, message: string) => void;

        messageHandler('test:channel', JSON.stringify({ type: 'all' }));

        expect(callbackB).toHaveBeenCalledWith({ type: 'all' });
        expect(callbackD).toHaveBeenCalledWith({ type: 'all' });
        expect(callbackC).not.toHaveBeenCalled();
      });
    });
  });

  describe('publish', () => {
    it('should publish event as JSON to the channel', async () => {
      await service.publish({ type: 'user', discordId: '123' });

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'test:channel',
        JSON.stringify({ type: 'user', discordId: '123' })
      );
    });

    it('should throw on publish error', async () => {
      mockRedis.publish.mockRejectedValue(new Error('Publish failed'));

      await expect(service.publish({ type: 'all' })).rejects.toThrow('Publish failed');
    });
  });

  describe('message handling', () => {
    it('should parse and validate incoming messages', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('test:channel', JSON.stringify({ type: 'user', discordId: '456' }));

      expect(callback).toHaveBeenCalledWith({ type: 'user', discordId: '456' });
    });

    it('should ignore messages from other channels', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('other:channel', JSON.stringify({ type: 'all' }));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      // Should not throw
      messageHandler('test:channel', 'not json');
      expect(callback).not.toHaveBeenCalled();
    });

    it('should reject invalid event structures', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('test:channel', JSON.stringify({ type: 'invalid' }));
      expect(callback).not.toHaveBeenCalled();

      messageHandler('test:channel', JSON.stringify({ foo: 'bar' }));
      expect(callback).not.toHaveBeenCalled();
    });

    it('should continue calling callbacks after one throws', async () => {
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });
      const normalCallback = vi.fn();

      await service.subscribe(errorCallback);
      await service.subscribe(normalCallback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('test:channel', JSON.stringify({ type: 'all' }));

      expect(errorCallback).toHaveBeenCalled();
      expect(normalCallback).toHaveBeenCalled();
    });

    it('logs a parse failure when the message is not valid JSON', async () => {
      mockLogger.error.mockClear();
      const callback = vi.fn();
      await service.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('test:channel', 'not-valid-json');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(SyntaxError) }),
        expect.any(String)
      );
    });

    it('logs a callback error when a registered callback throws', async () => {
      mockLogger.error.mockClear();
      const throwing = vi.fn(() => {
        throw new Error('Callback boom');
      });
      await service.subscribe(throwing);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('test:channel', JSON.stringify({ type: 'all' }));

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.any(String)
      );
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe from channel', async () => {
      await service.subscribe(vi.fn());
      await service.unsubscribe();

      expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith('test:channel');
    });

    it('should disconnect subscriber', async () => {
      await service.subscribe(vi.fn());
      await service.unsubscribe();

      expect(mockSubscriber.disconnect).toHaveBeenCalled();
    });

    it('should clear callbacks', async () => {
      const callback = vi.fn();
      await service.subscribe(callback);
      await service.unsubscribe();

      // Resubscribe and trigger event
      mockRedis.duplicate.mockReturnValue(mockSubscriber);
      await service.subscribe(vi.fn());

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      messageHandler('test:channel', JSON.stringify({ type: 'all' }));

      // Original callback should not be called
      expect(callback).not.toHaveBeenCalled();
    });

    it('should do nothing if not subscribed', async () => {
      await service.unsubscribe();

      expect(mockSubscriber.unsubscribe).not.toHaveBeenCalled();
      expect(mockSubscriber.disconnect).not.toHaveBeenCalled();
    });

    it('resets the callback list to empty — a seeded non-empty array would surface as a callback-error log', async () => {
      const callbackA = vi.fn();
      await service.subscribe(callbackA);
      await service.unsubscribe();

      mockRedis.duplicate.mockReturnValue(mockSubscriber);
      const callbackB = vi.fn();
      await service.subscribe(callbackB);

      mockLogger.error.mockClear();

      const messageHandler = mockSubscriber.on.mock.calls
        .filter((call: unknown[]) => call[0] === 'message')
        .at(-1)?.[1] as (channel: string, message: string) => void;

      messageHandler('test:channel', JSON.stringify({ type: 'all' }));

      expect(callbackB).toHaveBeenCalledWith({ type: 'all' });
      expect(callbackA).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('isSubscribed', () => {
    it('should return false initially', () => {
      expect(service.isSubscribed()).toBe(false);
    });

    it('should return true after subscribe', async () => {
      await service.subscribe(vi.fn());
      expect(service.isSubscribed()).toBe(true);
    });

    it('should return false after unsubscribe', async () => {
      await service.subscribe(vi.fn());
      await service.unsubscribe();
      expect(service.isSubscribed()).toBe(false);
    });
  });

  describe('logging options', () => {
    it('should use custom log context and description', async () => {
      const serviceWithOptions = new TestCacheInvalidationService(mockRedis, {
        getLogContext: event => (event.type === 'user' ? { userId: event.discordId } : {}),
        getEventDescription: event => (event.type === 'all' ? 'ALL' : `user ${event.discordId}`),
      });

      // Just verify it doesn't throw - actual logging is mocked
      await serviceWithOptions.publish({ type: 'user', discordId: '123' });
      expect(mockRedis.publish).toHaveBeenCalled();
    });
  });

  describe('custom event types', () => {
    // Test with a custom event type beyond standard user/all
    type CustomEvent =
      { type: 'user'; discordId: string } | { type: 'guild'; guildId: string } | { type: 'all' };

    const customValidator: EventValidator<CustomEvent> = (obj): obj is CustomEvent => {
      if (typeof obj !== 'object' || obj === null) return false;
      const event = obj as Record<string, unknown>;
      if (event.type === 'all') return Object.keys(event).length === 1;
      if (event.type === 'user') {
        return typeof event.discordId === 'string' && Object.keys(event).length === 2;
      }
      if (event.type === 'guild') {
        return typeof event.guildId === 'string' && Object.keys(event).length === 2;
      }
      return false;
    };

    class CustomCacheInvalidationService extends BaseCacheInvalidationService<CustomEvent> {
      constructor(redis: ReturnType<typeof createMockRedis>) {
        super(redis as never, 'custom:channel', 'CustomCacheInvalidationService', customValidator);
      }
    }

    it('should support custom event types', async () => {
      const customService = new CustomCacheInvalidationService(mockRedis);
      const callback = vi.fn();
      await customService.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      // Test guild event type
      messageHandler('custom:channel', JSON.stringify({ type: 'guild', guildId: 'guild-123' }));
      expect(callback).toHaveBeenCalledWith({ type: 'guild', guildId: 'guild-123' });
    });

    it('should reject invalid custom events', async () => {
      const customService = new CustomCacheInvalidationService(mockRedis);
      const callback = vi.fn();
      await customService.subscribe(callback);

      const messageHandler = mockSubscriber.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'message'
      )?.[1] as (channel: string, message: string) => void;

      // Invalid event type
      messageHandler('custom:channel', JSON.stringify({ type: 'channel', channelId: '123' }));
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
