/**
 * Redis Utilities Tests
 *
 * Tests for Redis connection configuration builders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseRedisUrl,
  createRedisSocketConfig,
  createBullMQRedisConfig,
  createIORedisClient,
} from './redis.js';
import { REDIS_CONNECTION, RETRY_CONFIG } from '../constants/index.js';

// Mock ioredis - must use class so `new Redis()` works as constructor
const mockOn = vi.fn().mockReturnThis();
const mockDisconnect = vi.fn();
vi.mock('ioredis', () => {
  class MockRedis {
    on = mockOn;
    disconnect = mockDisconnect;
    constructor(public opts?: Record<string, unknown>) {}
  }
  return { Redis: MockRedis };
});

describe('parseRedisUrl', () => {
  it('should parse a complete Redis URL', () => {
    const result = parseRedisUrl('redis://user:password@localhost:6379');
    expect(result).toEqual({
      host: 'localhost',
      port: 6379,
      password: 'password',
      username: 'user',
    });
  });

  it('should filter out "default" placeholder username', () => {
    const result = parseRedisUrl('redis://default:password@localhost:6379');
    expect(result).toEqual({
      host: 'localhost',
      port: 6379,
      password: 'password',
      username: undefined,
    });
  });

  it('should handle URL without password', () => {
    const result = parseRedisUrl('redis://localhost:6379');
    expect(result).toEqual({
      host: 'localhost',
      port: 6379,
      password: undefined,
      username: undefined,
    });
  });

  it('should default to port 6379 if not specified', () => {
    const result = parseRedisUrl('redis://localhost');
    expect(result).toEqual({
      host: 'localhost',
      port: 6379,
      password: undefined,
      username: undefined,
    });
  });

  it('should handle Railway-style Redis URLs', () => {
    const result = parseRedisUrl('redis://default:secretpass@redis.railway.internal:6379');
    expect(result).toEqual({
      host: 'redis.railway.internal',
      port: 6379,
      password: 'secretpass',
      username: undefined, // "default" is filtered out
    });
  });

  it('should throw in production on invalid URL', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    expect(() => parseRedisUrl('not-a-valid-url')).toThrow(
      'Failed to parse REDIS_URL in production'
    );

    process.env.NODE_ENV = originalEnv;
  });

  it('should fallback to localhost in development on invalid URL', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const result = parseRedisUrl('not-a-valid-url');
    expect(result).toEqual({
      host: 'localhost',
      port: 6379,
    });

    process.env.NODE_ENV = originalEnv;
  });
});

describe('createRedisSocketConfig', () => {
  it('should create config with correct timeout values from constants', () => {
    const config = createRedisSocketConfig({
      host: 'localhost',
      port: 6379,
    });

    expect(config.socket.connectTimeout).toBe(REDIS_CONNECTION.CONNECT_TIMEOUT);
    expect(config.socket.commandTimeout).toBe(REDIS_CONNECTION.COMMAND_TIMEOUT);
    expect(config.socket.keepAliveInitialDelay).toBe(REDIS_CONNECTION.KEEPALIVE);
  });

  it('should set maxRetriesPerRequest to RETRY_CONFIG value (not null)', () => {
    const config = createRedisSocketConfig({
      host: 'localhost',
      port: 6379,
    });

    expect(config.maxRetriesPerRequest).toBe(RETRY_CONFIG.REDIS_RETRIES_PER_REQUEST);
    expect(config.maxRetriesPerRequest).toBe(3); // Direct Redis clients use 3
  });

  it('should default to IPv6 (family 6) for Railway', () => {
    const config = createRedisSocketConfig({
      host: 'redis.railway.internal',
      port: 6379,
    });

    expect(config.socket.family).toBe(6);
  });

  it('should respect explicit family setting', () => {
    const config = createRedisSocketConfig({
      host: 'localhost',
      port: 6379,
      family: 4,
    });

    expect(config.socket.family).toBe(4);
  });

  it('should include password and username if provided', () => {
    const config = createRedisSocketConfig({
      host: 'localhost',
      port: 6379,
      password: 'secret',
      username: 'admin',
    });

    expect(config.password).toBe('secret');
    expect(config.username).toBe('admin');
  });

  it('should enable keepAlive and readyCheck', () => {
    const config = createRedisSocketConfig({
      host: 'localhost',
      port: 6379,
    });

    expect(config.socket.keepAlive).toBe(true);
    expect(config.enableReadyCheck).toBe(true);
    expect(config.lazyConnect).toBe(false);
  });

  it('should have a reconnectStrategy function', () => {
    const config = createRedisSocketConfig({
      host: 'localhost',
      port: 6379,
    });

    expect(typeof config.socket.reconnectStrategy).toBe('function');

    // Test that it returns a delay for early retries
    const delay = config.socket.reconnectStrategy(1);
    expect(typeof delay).toBe('number');
    expect(delay).toBeGreaterThan(0);
  });

  it('should give up after max retries', () => {
    const config = createRedisSocketConfig({
      host: 'localhost',
      port: 6379,
    });

    const result = config.socket.reconnectStrategy(RETRY_CONFIG.REDIS_MAX_RETRIES + 1);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('Max reconnection attempts reached');
  });
});

describe('createBullMQRedisConfig', () => {
  it('should set maxRetriesPerRequest to null for BullMQ compatibility', () => {
    const config = createBullMQRedisConfig({
      host: 'localhost',
      port: 6379,
    });

    expect(config.maxRetriesPerRequest).toBeNull();
  });

  it('should use REDIS_CONNECTION constants for timeouts', () => {
    const config = createBullMQRedisConfig({
      host: 'localhost',
      port: 6379,
    });

    expect(config.connectTimeout).toBe(REDIS_CONNECTION.CONNECT_TIMEOUT);
    expect(config.commandTimeout).toBe(REDIS_CONNECTION.COMMAND_TIMEOUT);
    expect(config.keepAlive).toBe(REDIS_CONNECTION.KEEPALIVE);
  });

  it('should default to IPv6 (family 6) for Railway', () => {
    const config = createBullMQRedisConfig({
      host: 'redis.railway.internal',
      port: 6379,
    });

    expect(config.family).toBe(6);
  });

  it('should respect explicit family setting', () => {
    const config = createBullMQRedisConfig({
      host: 'localhost',
      port: 6379,
      family: 4,
    });

    expect(config.family).toBe(4);
  });

  it('should include password and username if provided', () => {
    const config = createBullMQRedisConfig({
      host: 'localhost',
      port: 6379,
      password: 'secret',
      username: 'admin',
    });

    expect(config.password).toBe('secret');
    expect(config.username).toBe('admin');
  });

  it('should enable readyCheck and disable lazyConnect', () => {
    const config = createBullMQRedisConfig({
      host: 'localhost',
      port: 6379,
    });

    expect(config.enableReadyCheck).toBe(true);
    expect(config.lazyConnect).toBe(false);
  });

  it('should have a reconnectStrategy function', () => {
    const config = createBullMQRedisConfig({
      host: 'localhost',
      port: 6379,
    });

    expect(typeof config.reconnectStrategy).toBe('function');

    // Test that it returns a delay for early retries
    const delay = config.reconnectStrategy(1);
    expect(typeof delay).toBe('number');
    expect(delay).toBeGreaterThan(0);
  });

  it('should give up after max retries', () => {
    const config = createBullMQRedisConfig({
      host: 'localhost',
      port: 6379,
    });

    const result = config.reconnectStrategy(RETRY_CONFIG.REDIS_MAX_RETRIES + 1);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('Max reconnection attempts reached');
  });

  it('should use exponential backoff for retries', () => {
    const config = createBullMQRedisConfig({
      host: 'localhost',
      port: 6379,
    });

    const delay1 = config.reconnectStrategy(1) as number;
    const delay2 = config.reconnectStrategy(2) as number;
    const delay3 = config.reconnectStrategy(3) as number;

    // Each retry should have increasing delay (up to max)
    expect(delay2).toBeGreaterThan(delay1);
    expect(delay3).toBeGreaterThan(delay2);

    // But capped at REDIS_MAX_DELAY (test within valid range)
    const delayMax = config.reconnectStrategy(RETRY_CONFIG.REDIS_MAX_RETRIES - 1) as number;
    expect(delayMax).toBeLessThanOrEqual(RETRY_CONFIG.REDIS_MAX_DELAY);
  });
});

describe('createIORedisClient', () => {
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    mockOn.mockClear();
    mockDisconnect.mockClear();
  });

  it('should create an IORedis client from a Redis URL', () => {
    const client = createIORedisClient(
      'redis://default:password@redis.railway.internal:6379',
      'TestService',
      mockLogger as never
    );

    expect(client).toBeDefined();
    expect(client.on).toBeDefined();
  });

  it('should log connection config with service name', () => {
    createIORedisClient(
      'redis://default:password@redis.railway.internal:6379',
      'MyWorker',
      mockLogger as never
    );

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'redis.railway.internal',
        port: 6379,
        hasPassword: true,
        connectTimeout: REDIS_CONNECTION.CONNECT_TIMEOUT,
        commandTimeout: REDIS_CONNECTION.COMMAND_TIMEOUT,
      }),
      '[MyWorker] Redis config (ioredis):'
    );
  });

  it('should register error, connect, ready, and reconnecting event handlers', () => {
    createIORedisClient('redis://localhost:6379', 'TestService', mockLogger as never);

    const onCalls = mockOn.mock.calls;
    const eventNames = onCalls.map((call: string[]) => call[0]);

    expect(eventNames).toContain('error');
    expect(eventNames).toContain('connect');
    expect(eventNames).toContain('ready');
    expect(eventNames).toContain('reconnecting');
  });

  it('should use IPv6 family for Railway private network', () => {
    const client = createIORedisClient(
      'redis://localhost:6379',
      'TestService',
      mockLogger as never
    );

    // The mock class stores opts on the instance
    const opts = (client as unknown as { opts: Record<string, unknown> }).opts;
    expect(opts).toEqual(
      expect.objectContaining({
        family: 6,
      })
    );
  });

  it('should not pass maxRetriesPerRequest (use default)', () => {
    const client = createIORedisClient(
      'redis://localhost:6379',
      'TestService',
      mockLogger as never
    );

    const opts = (client as unknown as { opts: Record<string, unknown> }).opts;
    expect(opts).not.toHaveProperty('maxRetriesPerRequest');
  });
});
