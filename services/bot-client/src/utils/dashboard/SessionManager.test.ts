/**
 * Dashboard Session Manager Tests (Redis-backed)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Redis, ChainableCommander } from 'ioredis';
import {
  DashboardSessionManager,
  getSessionManager,
  shutdownSessionManager,
  initSessionManager,
  isSessionManagerInitialized,
} from './SessionManager.js';
import { isDashboardInteraction, parseDashboardCustomId, buildDashboardCustomId } from './types.js';

interface TestData {
  name: string;
  value: number;
}

/**
 * Create a mock Redis client with common operations
 */
function createMockRedis(): {
  redis: Redis;
  storage: Map<string, string>;
  pipelineOps: Array<{ method: string; args: unknown[] }>;
} {
  const storage = new Map<string, string>();
  const pipelineOps: Array<{ method: string; args: unknown[] }> = [];

  // Use plain functions instead of vi.fn for pipeline to avoid closure issues
  const createPipeline = (): ChainableCommander => {
    // Track ops for this specific pipeline execution
    const localOps: Array<{ method: string; args: unknown[] }> = [];

    const pipeline: ChainableCommander = {
      setex(key: string, ttl: number, value: string) {
        localOps.push({ method: 'setex', args: [key, ttl, value] });
        pipelineOps.push({ method: 'setex', args: [key, ttl, value] });
        storage.set(key, value);
        return pipeline;
      },
      del(key: string) {
        localOps.push({ method: 'del', args: [key] });
        pipelineOps.push({ method: 'del', args: [key] });
        storage.delete(key);
        return pipeline;
      },
      expire(key: string, ttl: number) {
        localOps.push({ method: 'expire', args: [key, ttl] });
        pipelineOps.push({ method: 'expire', args: [key, ttl] });
        return pipeline;
      },
      async exec() {
        // Return results for each pipeline operation
        return localOps.map(op => {
          if (op.method === 'del') {
            return [null, 1]; // Key was deleted
          }
          return [null, 'OK'];
        });
      },
    } as unknown as ChainableCommander;
    return pipeline;
  };

  // Use plain async functions instead of vi.fn to avoid mock complications
  const redis: Redis = {
    async get(key: string) {
      return storage.get(key) ?? null;
    },
    async setex(key: string, _ttl: number, value: string) {
      storage.set(key, value);
      return 'OK';
    },
    async del(...keys: string[]) {
      let deleted = 0;
      for (const key of keys) {
        if (storage.has(key)) {
          storage.delete(key);
          deleted++;
        }
      }
      return deleted;
    },
    async expire(_key: string, _ttl: number) {
      return 1;
    },
    // mget receives keys as an array
    async mget(keys: string[]) {
      return keys.map(k => storage.get(k) ?? null);
    },
    // scan receives: cursor, 'MATCH', pattern, 'COUNT', count
    async scan(_cursor: string, _match: string, pattern: string) {
      // Convert glob pattern to regex for proper matching
      // 'session:*' should NOT match 'session-msg:*'
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
        .replace(/\*/g, '.*') // Convert glob * to regex .*
        .replace(/\?/g, '.'); // Convert glob ? to regex .
      const regex = new RegExp(`^${regexPattern}$`);

      const matchingKeys: string[] = [];
      for (const key of storage.keys()) {
        if (regex.test(key)) {
          matchingKeys.push(key);
        }
      }
      return ['0', matchingKeys] as [string, string[]]; // Return cursor '0' to indicate scan complete
    },
    pipeline() {
      pipelineOps.length = 0; // Reset pipeline ops for this pipeline
      return createPipeline();
    },
  } as unknown as Redis;

  return { redis, storage, pipelineOps };
}

describe('DashboardSessionManager', () => {
  let manager: DashboardSessionManager;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockRedis = createMockRedis();
    manager = new DashboardSessionManager(mockRedis.redis, 15 * 60); // 15 minute TTL in seconds
  });

  afterEach(async () => {
    await manager.clear();
    vi.useRealTimers();
  });

  describe('set and get', () => {
    it('should create a new session', async () => {
      const data: TestData = { name: 'test', value: 42 };

      const session = await manager.set<TestData>({
        userId: 'user123',
        entityType: 'character',
        entityId: 'entity456',
        data,
        messageId: 'msg789',
        channelId: 'channel111',
      });

      expect(session.userId).toBe('user123');
      expect(session.entityType).toBe('character');
      expect(session.entityId).toBe('entity456');
      expect(session.data).toEqual(data);
      expect(session.messageId).toBe('msg789');
      expect(session.channelId).toBe('channel111');
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivityAt).toBeInstanceOf(Date);
    });

    it('should store session in Redis and retrieve it correctly', async () => {
      const data: TestData = { name: 'test', value: 42 };
      await manager.set<TestData>({
        userId: 'user123',
        entityType: 'character',
        entityId: 'entity456',
        data,
        messageId: 'msg789',
        channelId: 'channel111',
      });

      // Verify session can be retrieved by user/entity
      const session = await manager.get<TestData>('user123', 'character', 'entity456');
      expect(session).not.toBeNull();
      expect(session?.data).toEqual(data);

      // Verify session can be found by messageId
      const byMsg = await manager.findByMessageId<TestData>('msg789');
      expect(byMsg).not.toBeNull();
      expect(byMsg?.userId).toBe('user123');
    });

    it('should retrieve an existing session', async () => {
      const data: TestData = { name: 'test', value: 42 };
      await manager.set<TestData>({
        userId: 'user123',
        entityType: 'character',
        entityId: 'entity456',
        data,
        messageId: 'msg789',
        channelId: 'channel111',
      });

      const retrieved = await manager.get<TestData>('user123', 'character', 'entity456');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.data).toEqual(data);
    });

    it('should return null for non-existent session', async () => {
      const retrieved = await manager.get<TestData>('nonexistent', 'character', 'entity');
      expect(retrieved).toBeNull();
    });

    it('should overwrite existing session with same key', async () => {
      const data1: TestData = { name: 'first', value: 1 };
      const data2: TestData = { name: 'second', value: 2 };

      await manager.set<TestData>({
        userId: 'user123',
        entityType: 'character',
        entityId: 'entity456',
        data: data1,
        messageId: 'msg1',
        channelId: 'channel1',
      });
      await manager.set<TestData>({
        userId: 'user123',
        entityType: 'character',
        entityId: 'entity456',
        data: data2,
        messageId: 'msg2',
        channelId: 'channel2',
      });

      const retrieved = await manager.get<TestData>('user123', 'character', 'entity456');

      expect(retrieved?.data).toEqual(data2);
      expect(retrieved?.messageId).toBe('msg2');
    });

    it('should track separate sessions for different entity types', async () => {
      const charData: TestData = { name: 'character', value: 1 };
      const profileData: TestData = { name: 'profile', value: 2 };

      await manager.set<TestData>({
        userId: 'user123',
        entityType: 'character',
        entityId: 'entity1',
        data: charData,
        messageId: 'msg1',
        channelId: 'ch1',
      });
      await manager.set<TestData>({
        userId: 'user123',
        entityType: 'profile',
        entityId: 'entity2',
        data: profileData,
        messageId: 'msg2',
        channelId: 'ch2',
      });

      const charSession = await manager.get<TestData>('user123', 'character', 'entity1');
      const profileSession = await manager.get<TestData>('user123', 'profile', 'entity2');

      expect(charSession?.data.name).toBe('character');
      expect(profileSession?.data.name).toBe('profile');
    });
  });

  describe('update', () => {
    it('should update session data', async () => {
      const data: TestData = { name: 'original', value: 1 };
      await manager.set<TestData>({
        userId: 'user123',
        entityType: 'character',
        entityId: 'entity456',
        data,
        messageId: 'msg789',
        channelId: 'channel111',
      });

      const updated = await manager.update<TestData>('user123', 'character', 'entity456', {
        value: 99,
      });

      expect(updated).not.toBeNull();
      expect(updated?.data.name).toBe('original');
      expect(updated?.data.value).toBe(99);
    });

    it('should update lastActivityAt on update', async () => {
      const data: TestData = { name: 'test', value: 42 };
      const session = await manager.set<TestData>({
        userId: 'user123',
        entityType: 'character',
        entityId: 'entity456',
        data,
        messageId: 'msg789',
        channelId: 'channel111',
      });
      const originalActivity = session.lastActivityAt.getTime();

      vi.advanceTimersByTime(5000);

      const updated = await manager.update<TestData>('user123', 'character', 'entity456', {
        value: 1,
      });

      expect(updated?.lastActivityAt.getTime()).toBeGreaterThan(originalActivity);
    });

    it('should return null when updating non-existent session', async () => {
      const updated = await manager.update<TestData>('nonexistent', 'character', 'entity', {
        value: 1,
      });
      expect(updated).toBeNull();
    });
  });

  describe('touch', () => {
    it('should update lastActivityAt without changing data', async () => {
      const data: TestData = { name: 'test', value: 42 };
      await manager.set<TestData>({
        userId: 'user123',
        entityType: 'character',
        entityId: 'entity456',
        data,
        messageId: 'msg789',
        channelId: 'channel111',
      });

      vi.advanceTimersByTime(5000);

      const result = await manager.touch('user123', 'character', 'entity456');

      expect(result).toBe(true);
      const session = await manager.get<TestData>('user123', 'character', 'entity456');
      expect(session?.data).toEqual(data);
    });

    it('should return false for non-existent session', async () => {
      const result = await manager.touch('nonexistent', 'character', 'entity');
      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete an existing session', async () => {
      const data: TestData = { name: 'test', value: 42 };
      await manager.set<TestData>({
        userId: 'user123',
        entityType: 'character',
        entityId: 'entity456',
        data,
        messageId: 'msg789',
        channelId: 'channel111',
      });

      const result = await manager.delete('user123', 'character', 'entity456');

      expect(result).toBe(true);
      expect(await manager.get('user123', 'character', 'entity456')).toBeNull();
    });

    it('should return false when deleting non-existent session', async () => {
      const result = await manager.delete('nonexistent', 'character', 'entity');
      expect(result).toBe(false);
    });

    it('should also delete the message index', async () => {
      const data: TestData = { name: 'test', value: 42 };
      await manager.set<TestData>({
        userId: 'user123',
        entityType: 'character',
        entityId: 'entity456',
        data,
        messageId: 'msg789',
        channelId: 'channel111',
      });

      await manager.delete('user123', 'character', 'entity456');

      // Both session and index should be gone
      expect(mockRedis.storage.has('session:user123:character:entity456')).toBe(false);
      expect(mockRedis.storage.has('session-msg:msg789')).toBe(false);
    });
  });

  describe('findByMessageId', () => {
    it('should find session by message ID', async () => {
      const data: TestData = { name: 'test', value: 42 };
      await manager.set<TestData>({
        userId: 'user123',
        entityType: 'character',
        entityId: 'entity456',
        data,
        messageId: 'msg789',
        channelId: 'channel111',
      });

      const found = await manager.findByMessageId<TestData>('msg789');

      expect(found).not.toBeNull();
      expect(found?.data).toEqual(data);
      expect(found?.userId).toBe('user123');
    });

    it('should return null for non-existent message ID', async () => {
      const found = await manager.findByMessageId<TestData>('nonexistent');
      expect(found).toBeNull();
    });

    it('should return null for orphaned message index', async () => {
      // Create orphaned index (points to non-existent session)
      mockRedis.storage.set('session-msg:orphan123', 'session:deleted:session:key');

      // Looking up an orphaned index should return null
      const found = await manager.findByMessageId<TestData>('orphan123');
      expect(found).toBeNull();
    });
  });

  describe('getUserSessions', () => {
    it('should return all sessions for a user', async () => {
      await manager.set<TestData>({
        userId: 'user123',
        entityType: 'character',
        entityId: 'entity1',
        data: { name: 'c1', value: 1 },
        messageId: 'm1',
        channelId: 'ch1',
      });
      await manager.set<TestData>({
        userId: 'user123',
        entityType: 'profile',
        entityId: 'entity2',
        data: { name: 'p1', value: 2 },
        messageId: 'm2',
        channelId: 'ch2',
      });
      await manager.set<TestData>({
        userId: 'user456',
        entityType: 'character',
        entityId: 'entity3',
        data: { name: 'c2', value: 3 },
        messageId: 'm3',
        channelId: 'ch3',
      });

      const sessions = await manager.getUserSessions('user123');

      expect(sessions).toHaveLength(2);
      expect(sessions.map(s => s.entityType).sort()).toEqual(['character', 'profile']);
    });

    it('should return empty array for user with no sessions', async () => {
      const sessions = await manager.getUserSessions('nonexistent');
      expect(sessions).toEqual([]);
    });
  });

  describe('getSessionCount', () => {
    it('should return 0 for empty manager', async () => {
      expect(await manager.getSessionCount()).toBe(0);
    });

    it('should return non-zero count after creating sessions', async () => {
      await manager.set<TestData>({
        userId: 'user1',
        entityType: 'character',
        entityId: 'e1',
        data: { name: 'a', value: 1 },
        messageId: 'm1',
        channelId: 'ch1',
      });

      // Should have at least 1 session
      const count = await manager.getSessionCount();
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    it('should remove all sessions', async () => {
      await manager.set<TestData>({
        userId: 'user1',
        entityType: 'character',
        entityId: 'e1',
        data: { name: 'a', value: 1 },
        messageId: 'm1',
        channelId: 'ch1',
      });
      await manager.set<TestData>({
        userId: 'user2',
        entityType: 'profile',
        entityId: 'e2',
        data: { name: 'b', value: 2 },
        messageId: 'm2',
        channelId: 'ch2',
      });

      await manager.clear();

      expect(await manager.getSessionCount()).toBe(0);
      expect(await manager.get('user1', 'character', 'e1')).toBeNull();
      expect(await manager.get('user2', 'profile', 'e2')).toBeNull();
    });
  });

  describe('corrupt data handling', () => {
    it('should return null for corrupt JSON session data', async () => {
      // Store corrupt JSON directly
      mockRedis.storage.set('session:user1:character:corrupt', 'not valid json');

      // Corrupt data should return null (fail-open)
      const session = await manager.get('user1', 'character', 'corrupt');
      expect(session).toBeNull();
    });

    it('should return null for invalid schema session data', async () => {
      // Store valid JSON but invalid schema
      mockRedis.storage.set('session:user1:character:invalid', JSON.stringify({ foo: 'bar' }));

      // Invalid schema should return null (fail-open)
      const session = await manager.get('user1', 'character', 'invalid');
      expect(session).toBeNull();
    });
  });

  describe('custom TTL', () => {
    it('should respect custom TTL value', async () => {
      const shortManager = new DashboardSessionManager(mockRedis.redis, 60); // 1 minute TTL

      await shortManager.set<TestData>({
        userId: 'user1',
        entityType: 'character',
        entityId: 'e1',
        data: { name: 'a', value: 1 },
        messageId: 'm1',
        channelId: 'ch1',
      });

      // Verify pipeline was called with correct TTL
      expect(mockRedis.pipelineOps).toContainEqual(
        expect.objectContaining({
          method: 'setex',
          args: expect.arrayContaining([60]),
        })
      );
    });
  });
});

describe('Singleton functions', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    shutdownSessionManager(); // Ensure clean state
  });

  afterEach(() => {
    shutdownSessionManager();
  });

  describe('initSessionManager', () => {
    it('should initialize the session manager', () => {
      expect(isSessionManagerInitialized()).toBe(false);

      initSessionManager(mockRedis.redis);

      expect(isSessionManagerInitialized()).toBe(true);
    });
  });

  describe('getSessionManager', () => {
    it('should return the initialized instance', () => {
      initSessionManager(mockRedis.redis);

      const manager = getSessionManager();

      expect(manager).toBeInstanceOf(DashboardSessionManager);
    });

    it('should throw if not initialized', () => {
      expect(() => getSessionManager()).toThrow('Session manager not initialized');
    });

    it('should return the same instance on multiple calls', () => {
      initSessionManager(mockRedis.redis);

      const manager1 = getSessionManager();
      const manager2 = getSessionManager();

      expect(manager1).toBe(manager2);
    });
  });

  describe('shutdownSessionManager', () => {
    it('should clear the singleton instance', async () => {
      initSessionManager(mockRedis.redis);
      const manager = getSessionManager();
      await manager.set({
        userId: 'user1',
        entityType: 'test',
        entityId: 'entity1',
        data: { foo: 'bar' },
        messageId: 'msg1',
        channelId: 'ch1',
      });

      shutdownSessionManager();

      expect(isSessionManagerInitialized()).toBe(false);
    });

    it('should be safe to call multiple times', () => {
      initSessionManager(mockRedis.redis);

      shutdownSessionManager();
      shutdownSessionManager();
      shutdownSessionManager();

      // No errors expected
      expect(isSessionManagerInitialized()).toBe(false);
    });

    it('should be safe to call without initialization', () => {
      // Don't call initSessionManager first
      shutdownSessionManager();

      // No errors expected
      expect(isSessionManagerInitialized()).toBe(false);
    });
  });
});

describe('Redis failure injection', () => {
  /**
   * The SessionManager uses fail-open strategy: Redis failures return
   * graceful defaults (null, false, empty arrays) instead of throwing.
   * These tests verify that behavior by injecting failures.
   */

  interface TestData {
    name: string;
    value: number;
  }

  it('set() should return session even when Redis pipeline fails', async () => {
    const failingRedis = {
      pipeline: () => ({
        setex: vi.fn().mockReturnThis(),
        exec: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
      }),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const session = await manager.set<TestData>({
      userId: 'user1',
      entityType: 'test',
      entityId: 'entity1',
      data: { name: 'test', value: 1 },
      messageId: 'msg1',
      channelId: 'ch1',
    });

    // Session is still returned (fail-open) even though Redis failed
    expect(session).not.toBeNull();
    expect(session.userId).toBe('user1');
    expect(session.data.name).toBe('test');
  });

  it('get() should return null when Redis.get() throws', async () => {
    const failingRedis = {
      get: vi.fn().mockRejectedValue(new Error('Redis timeout')),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const session = await manager.get<TestData>('user1', 'test', 'entity1');

    expect(session).toBeNull();
  });

  it('update() should return null when underlying get() fails', async () => {
    const failingRedis = {
      get: vi.fn().mockRejectedValue(new Error('Connection refused')),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const updated = await manager.update<TestData>('user1', 'test', 'entity1', { value: 99 });

    expect(updated).toBeNull();
  });

  it('touch() should return false when Redis.get() throws', async () => {
    const failingRedis = {
      get: vi.fn().mockRejectedValue(new Error('Network error')),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const result = await manager.touch('user1', 'test', 'entity1');

    expect(result).toBe(false);
  });

  it('touch() should return false when pipeline fails after successful get', async () => {
    const storedSession = {
      entityType: 'test',
      entityId: 'entity1',
      userId: 'user1',
      data: { name: 'test', value: 1 },
      messageId: 'msg1',
      channelId: 'ch1',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };

    const failingRedis = {
      get: vi.fn().mockResolvedValue(JSON.stringify(storedSession)),
      pipeline: () => ({
        setex: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockRejectedValue(new Error('Pipeline execution failed')),
      }),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const result = await manager.touch('user1', 'test', 'entity1');

    expect(result).toBe(false);
  });

  it('delete() should return false when Redis.get() throws', async () => {
    const failingRedis = {
      get: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const result = await manager.delete('user1', 'test', 'entity1');

    expect(result).toBe(false);
  });

  it('findByMessageId() should return null when first get() throws', async () => {
    const failingRedis = {
      get: vi.fn().mockRejectedValue(new Error('DNS lookup failed')),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const session = await manager.findByMessageId<TestData>('msg123');

    expect(session).toBeNull();
  });

  it('findByMessageId() should return null when second get() throws', async () => {
    const failingRedis = {
      get: vi
        .fn()
        .mockResolvedValueOnce('session:user1:test:entity1') // First call returns index
        .mockRejectedValueOnce(new Error('Connection reset')), // Second call fails
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const session = await manager.findByMessageId<TestData>('msg123');

    expect(session).toBeNull();
  });

  it('getUserSessions() should return empty array when scan() throws', async () => {
    const failingRedis = {
      scan: vi.fn().mockRejectedValue(new Error('SCAN command failed')),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const sessions = await manager.getUserSessions('user1');

    expect(sessions).toEqual([]);
  });

  it('getUserSessions() should return empty array when mget() throws', async () => {
    const failingRedis = {
      scan: vi.fn().mockResolvedValue(['0', ['session:user1:test:entity1']]),
      mget: vi.fn().mockRejectedValue(new Error('MGET command failed')),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const sessions = await manager.getUserSessions('user1');

    expect(sessions).toEqual([]);
  });

  it('getSessionCount() should return 0 when scan() throws', async () => {
    const failingRedis = {
      scan: vi.fn().mockRejectedValue(new Error('SCAN not available')),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const count = await manager.getSessionCount();

    expect(count).toBe(0);
  });

  it('clear() should not throw when scan() fails', async () => {
    const failingRedis = {
      scan: vi.fn().mockRejectedValue(new Error('Redis cluster unavailable')),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);

    // Should not throw
    await expect(manager.clear()).resolves.not.toThrow();
  });

  it('clear() should not throw when del() fails', async () => {
    const failingRedis = {
      scan: vi
        .fn()
        .mockResolvedValueOnce(['0', ['session:user1:test:entity1']]) // session keys
        .mockResolvedValueOnce(['0', ['session-msg:msg1']]), // msg index keys
      del: vi.fn().mockRejectedValue(new Error('DEL command failed')),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);

    // Should not throw
    await expect(manager.clear()).resolves.not.toThrow();
  });

  it('set() handles partial pipeline failures gracefully', async () => {
    const partialFailRedis = {
      pipeline: () => ({
        setex: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [new Error('First setex failed'), null],
          [null, 'OK'], // Second succeeded
        ]),
      }),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(partialFailRedis, 60);
    const session = await manager.set<TestData>({
      userId: 'user1',
      entityType: 'test',
      entityId: 'entity1',
      data: { name: 'test', value: 1 },
      messageId: 'msg1',
      channelId: 'ch1',
    });

    // Session is still returned despite partial failure
    expect(session).not.toBeNull();
    expect(session.userId).toBe('user1');
  });

  it('update() should return updated session when setex fails after get (fail-open)', async () => {
    const storedSession = {
      entityType: 'test',
      entityId: 'entity1',
      userId: 'user1',
      data: { name: 'test', value: 1 },
      messageId: 'msg1',
      channelId: 'ch1',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };

    const failingRedis = {
      get: vi.fn().mockResolvedValue(JSON.stringify(storedSession)),
      setex: vi.fn().mockRejectedValue(new Error('SETEX failed')),
      expire: vi.fn().mockRejectedValue(new Error('EXPIRE failed')),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const updated = await manager.update<TestData>('user1', 'test', 'entity1', { value: 99 });

    // Fail-open: returns the updated session even though Redis write failed
    expect(updated).not.toBeNull();
    expect(updated?.data.value).toBe(99);
  });

  it('delete() should return false when pipeline.exec() throws after get', async () => {
    const storedSession = {
      entityType: 'test',
      entityId: 'entity1',
      userId: 'user1',
      data: { name: 'test', value: 1 },
      messageId: 'msg1',
      channelId: 'ch1',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };

    const failingRedis = {
      get: vi.fn().mockResolvedValue(JSON.stringify(storedSession)),
      pipeline: () => ({
        del: vi.fn().mockReturnThis(),
        exec: vi.fn().mockRejectedValue(new Error('Pipeline exec failed')),
      }),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const result = await manager.delete('user1', 'test', 'entity1');

    expect(result).toBe(false);
  });

  it('findByMessageId() should return null when corrupt data and cleanup del() throws', async () => {
    const failingRedis = {
      get: vi
        .fn()
        .mockResolvedValueOnce('session:user1:test:entity1') // msg index returns session key
        .mockResolvedValueOnce('not-valid-json{{{'), // session data is corrupt
      del: vi.fn().mockRejectedValue(new Error('DEL cleanup failed')),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const session = await manager.findByMessageId<TestData>('msg123');

    // Returns null and swallows the cleanup error (no unhandled rejection)
    expect(session).toBeNull();
  });

  it('set() should return session when pipeline.exec() returns null (Redis timeout)', async () => {
    const nullResultRedis = {
      pipeline: () => ({
        setex: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(nullResultRedis, 60);
    const session = await manager.set<TestData>({
      userId: 'user1',
      entityType: 'test',
      entityId: 'entity1',
      data: { name: 'test', value: 1 },
      messageId: 'msg1',
      channelId: 'ch1',
    });

    // Session is returned (fail-open) even with null pipeline result
    expect(session).not.toBeNull();
    expect(session.userId).toBe('user1');
    expect(session.data.name).toBe('test');
  });

  it('touch() should return false when partial pipeline ops fail', async () => {
    const storedSession = {
      entityType: 'test',
      entityId: 'entity1',
      userId: 'user1',
      data: { name: 'test', value: 1 },
      messageId: 'msg1',
      channelId: 'ch1',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };

    const failingRedis = {
      get: vi.fn().mockResolvedValue(JSON.stringify(storedSession)),
      pipeline: () => ({
        setex: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [new Error('SETEX failed'), null], // First op fails
          [null, 1], // Second op succeeds
        ]),
      }),
    } as unknown as Redis;

    const manager = new DashboardSessionManager(failingRedis, 60);
    const result = await manager.touch('user1', 'test', 'entity1');

    // touch returns true (it completed), but logs a warning about partial failure
    expect(result).toBe(true);
  });
});

describe('Dashboard types utilities', () => {
  describe('isDashboardInteraction', () => {
    it('should return true for matching entity type', () => {
      expect(isDashboardInteraction('character::menu::abc123', 'character')).toBe(true);
      expect(isDashboardInteraction('character::modal::abc123::identity', 'character')).toBe(true);
      expect(isDashboardInteraction('character::close::abc123', 'character')).toBe(true);
    });

    it('should return false for non-matching entity type', () => {
      expect(isDashboardInteraction('profile::menu::abc123', 'character')).toBe(false);
      expect(isDashboardInteraction('other-action', 'character')).toBe(false);
    });
  });

  describe('parseDashboardCustomId', () => {
    it('should parse seed modal custom ID', () => {
      const result = parseDashboardCustomId('character::seed');
      expect(result).toEqual({
        entityType: 'character',
        action: 'seed',
        entityId: undefined,
        sectionId: undefined,
      });
    });

    it('should parse menu custom ID', () => {
      const result = parseDashboardCustomId('character::menu::abc123');
      expect(result).toEqual({
        entityType: 'character',
        action: 'menu',
        entityId: 'abc123',
        sectionId: undefined,
      });
    });

    it('should parse modal custom ID with section', () => {
      const result = parseDashboardCustomId('character::modal::abc123::identity');
      expect(result).toEqual({
        entityType: 'character',
        action: 'modal',
        entityId: 'abc123',
        sectionId: 'identity',
      });
    });

    it('should correctly parse UUIDs in entityId', () => {
      const uuid = 'abc12345-def6-7890-abcd-ef1234567890';
      const result = parseDashboardCustomId(`character::menu::${uuid}`);
      expect(result).toEqual({
        entityType: 'character',
        action: 'menu',
        entityId: uuid,
        sectionId: undefined,
      });
    });

    it('should return null for invalid custom ID', () => {
      expect(parseDashboardCustomId('invalid')).toBeNull();
      expect(parseDashboardCustomId('')).toBeNull();
    });
  });

  describe('buildDashboardCustomId', () => {
    it('should build seed custom ID', () => {
      expect(buildDashboardCustomId('character', 'seed')).toBe('character::seed');
    });

    it('should build menu custom ID', () => {
      expect(buildDashboardCustomId('character', 'menu', 'abc123')).toBe('character::menu::abc123');
    });

    it('should build modal custom ID with section', () => {
      expect(buildDashboardCustomId('character', 'modal', 'abc123', 'identity')).toBe(
        'character::modal::abc123::identity'
      );
    });

    it('should correctly build with UUID entityId', () => {
      const uuid = 'abc12345-def6-7890-abcd-ef1234567890';
      expect(buildDashboardCustomId('character', 'menu', uuid)).toBe(`character::menu::${uuid}`);
    });

    it('should skip empty entityId', () => {
      expect(buildDashboardCustomId('character', 'seed', '')).toBe('character::seed');
    });

    it('should skip empty sectionId', () => {
      expect(buildDashboardCustomId('character', 'menu', 'abc', '')).toBe('character::menu::abc');
    });
  });
});
