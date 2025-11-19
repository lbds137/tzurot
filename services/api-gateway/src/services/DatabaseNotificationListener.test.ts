/**
 * DatabaseNotificationListener Tests
 *
 * Tests for PostgreSQL NOTIFY listener with reconnection logic
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { CacheInvalidationService } from '@tzurot/common-types';

// Mock pg Client - must be at module scope BEFORE importing the service
vi.mock('pg', () => {
  const Client = vi.fn();
  return { Client };
});

import { DatabaseNotificationListener } from './DatabaseNotificationListener.js';
import { Client } from 'pg';

// Mock CacheInvalidationService
const createMockCacheService = () => ({
  publish: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
});

describe('DatabaseNotificationListener', () => {
  let listener: DatabaseNotificationListener;
  let mockCacheService: ReturnType<typeof createMockCacheService>;
  let mockClient: {
    connect: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockCacheService = createMockCacheService();

    mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    };

    // Mock Client constructor to return our mock
    vi.mocked(Client).mockImplementation(function (this: unknown) {
      return mockClient as unknown as Client;
    });

    listener = new DatabaseNotificationListener(
      'postgresql://test:test@localhost:5432/test',
      mockCacheService as unknown as CacheInvalidationService
    );
  });

  afterEach(async () => {
    await listener.stop();
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('start()', () => {
    it('should connect to database and setup LISTEN', async () => {
      await listener.start();

      expect(mockClient.connect).toHaveBeenCalledTimes(1);
      expect(mockClient.query).toHaveBeenCalledWith('LISTEN cache_invalidation');
      expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('notification', expect.any(Function));
    });

    it('should not reconnect if already listening', async () => {
      await listener.start();
      mockClient.connect.mockClear();

      await listener.start();

      expect(mockClient.connect).not.toHaveBeenCalled();
    });
  });

  describe('notification handling', () => {
    let notificationHandler: (msg: { channel: string; payload: string | null }) => void;

    beforeEach(async () => {
      mockClient.on.mockImplementation((event, handler) => {
        if (event === 'notification') {
          notificationHandler = handler;
        }
      });

      await listener.start();
    });

    it('should parse and forward valid notification events', async () => {
      const validEvent = {
        type: 'personality' as const,
        personalityId: '123e4567-e89b-12d3-a456-426614174000',
      };

      notificationHandler({
        channel: 'cache_invalidation',
        payload: JSON.stringify(validEvent),
      });

      // Wait for async handling
      await vi.runAllTimersAsync();

      expect(mockCacheService.publish).toHaveBeenCalledWith(validEvent);
    });

    it('should ignore notifications from wrong channel', () => {
      notificationHandler({
        channel: 'wrong_channel',
        payload: JSON.stringify({ type: 'personality', id: 'test' }),
      });

      expect(mockCacheService.publish).not.toHaveBeenCalled();
    });

    it('should ignore notifications with null payload', () => {
      notificationHandler({
        channel: 'cache_invalidation',
        payload: null,
      });

      expect(mockCacheService.publish).not.toHaveBeenCalled();
    });

    it('should ignore notifications with empty payload', () => {
      notificationHandler({
        channel: 'cache_invalidation',
        payload: '',
      });

      expect(mockCacheService.publish).not.toHaveBeenCalled();
    });

    it('should reject invalid notification structure', () => {
      const invalidEvent = {
        invalid: 'structure',
      };

      notificationHandler({
        channel: 'cache_invalidation',
        payload: JSON.stringify(invalidEvent),
      });

      expect(mockCacheService.publish).not.toHaveBeenCalled();
    });

    it('should handle malformed JSON gracefully', () => {
      notificationHandler({
        channel: 'cache_invalidation',
        payload: 'not valid json{',
      });

      expect(mockCacheService.publish).not.toHaveBeenCalled();
    });

    it('should handle publish failures gracefully', async () => {
      mockCacheService.publish.mockRejectedValueOnce(new Error('Publish failed'));

      const validEvent = {
        type: 'personality' as const,
        personalityId: '123e4567-e89b-12d3-a456-426614174000',
      };

      notificationHandler({
        channel: 'cache_invalidation',
        payload: JSON.stringify(validEvent),
      });

      // Wait for async handling
      await vi.runAllTimersAsync();

      // Should not throw, just log error
      expect(mockCacheService.publish).toHaveBeenCalledWith(validEvent);
    });
  });

  describe('reconnection logic', () => {
    it('should handle connection errors and attempt reconnect', async () => {
      let errorHandler: (err: Error) => void;

      mockClient.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          errorHandler = handler;
        }
      });

      await listener.start();

      // Trigger connection error
      errorHandler!(new Error('Connection lost'));

      // Should have scheduled a reconnect
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    });

    it('should retry connection on start failure', async () => {
      mockClient.connect.mockRejectedValueOnce(new Error('Connection failed'));

      await listener.start();

      // Should have scheduled a reconnect
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    });

    it('should clean up client on reconnect', async () => {
      let errorHandler: (err: Error) => void;

      mockClient.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          errorHandler = handler;
        }
      });

      await listener.start();

      // Trigger error
      errorHandler!(new Error('Connection lost'));

      // Fast-forward to reconnect attempt
      await vi.runAllTimersAsync();

      expect(mockClient.removeAllListeners).toHaveBeenCalled();
      expect(mockClient.end).toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('should execute UNLISTEN and disconnect', async () => {
      await listener.start();
      await listener.stop();

      expect(mockClient.query).toHaveBeenCalledWith('UNLISTEN cache_invalidation');
      expect(mockClient.end).toHaveBeenCalled();
    });

    it('should clear reconnect timeout if pending', async () => {
      mockClient.connect.mockRejectedValueOnce(new Error('Connection failed'));

      await listener.start();

      // Verify timeout is pending
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      await listener.stop();

      // Timeout should be cleared
      expect(vi.getTimerCount()).toBe(0);
    });

    it('should handle errors during shutdown gracefully', async () => {
      await listener.start();

      mockClient.query.mockRejectedValueOnce(new Error('UNLISTEN failed'));
      mockClient.end.mockRejectedValueOnce(new Error('Disconnect failed'));

      // Should not throw
      await expect(listener.stop()).resolves.toBeUndefined();
    });

    it('should handle stop when not connected', async () => {
      // Should not throw
      await expect(listener.stop()).resolves.toBeUndefined();
    });
  });

  describe('integration flow', () => {
    it('should handle full notification lifecycle', async () => {
      let notificationHandler: (msg: { channel: string; payload: string }) => void;

      mockClient.on.mockImplementation((event, handler) => {
        if (event === 'notification') {
          notificationHandler = handler;
        }
      });

      // Start listener
      await listener.start();

      // Receive notification
      const event = {
        type: 'personality' as const,
        personalityId: '123e4567-e89b-12d3-a456-426614174000',
      };

      notificationHandler!({
        channel: 'cache_invalidation',
        payload: JSON.stringify(event),
      });

      await vi.runAllTimersAsync();

      // Verify forwarded to cache service
      expect(mockCacheService.publish).toHaveBeenCalledWith(event);

      // Stop listener
      await listener.stop();

      expect(mockClient.query).toHaveBeenCalledWith('UNLISTEN cache_invalidation');
    });

    it('should recover from connection loss', async () => {
      let errorHandler: (err: Error) => void;

      mockClient.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          errorHandler = handler;
        }
      });

      await listener.start();

      // Simulate connection loss
      errorHandler!(new Error('Connection lost'));

      // Fast-forward through reconnect attempts
      await vi.runAllTimersAsync();

      // Should have attempted to reconnect
      expect(mockClient.connect).toHaveBeenCalledTimes(2); // Initial + 1 reconnect
    });
  });
});
