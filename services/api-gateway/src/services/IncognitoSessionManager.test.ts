/**
 * Tests for IncognitoSessionManager
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { IncognitoSessionManager } from './IncognitoSessionManager.js';
import { REDIS_KEY_PREFIXES, type IncognitoSession } from '@tzurot/common-types';

/**
 * Create a mock Redis client
 */
function createMockRedis(): Redis {
  return {
    setex: vi.fn().mockResolvedValue('OK'),
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    // SCAN returns [cursor, keys[]] - cursor '0' means done
    scan: vi.fn().mockResolvedValue(['0', []]),
    mget: vi.fn().mockResolvedValue([]),
  } as unknown as Redis;
}

describe('IncognitoSessionManager', () => {
  let redis: Redis;
  let manager: IncognitoSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
    redis = createMockRedis();
    manager = new IncognitoSessionManager(redis);
  });

  describe('enable', () => {
    it('creates session with TTL for timed durations', async () => {
      const session = await manager.enable('user123', 'personality456', '1h');

      expect(redis.setex).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.INCOGNITO}user123:personality456`,
        3600, // 1 hour in seconds
        expect.any(String)
      );

      expect(session).toEqual({
        userId: 'user123',
        personalityId: 'personality456',
        enabledAt: '2026-01-15T12:00:00.000Z',
        expiresAt: '2026-01-15T13:00:00.000Z',
        duration: '1h',
      });
    });

    it('creates session without TTL for forever duration', async () => {
      const session = await manager.enable('user123', 'all', 'forever');

      expect(redis.set).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.INCOGNITO}user123:all`,
        expect.any(String)
      );
      expect(redis.setex).not.toHaveBeenCalled();

      expect(session.expiresAt).toBeNull();
      expect(session.duration).toBe('forever');
    });

    it('calculates correct TTL for each duration', async () => {
      // 30 minutes
      await manager.enable('user1', 'p1', '30m');
      expect(redis.setex).toHaveBeenLastCalledWith(
        expect.any(String),
        1800, // 30 * 60
        expect.any(String)
      );

      // 4 hours
      await manager.enable('user2', 'p2', '4h');
      expect(redis.setex).toHaveBeenLastCalledWith(
        expect.any(String),
        14400, // 4 * 60 * 60
        expect.any(String)
      );
    });
  });

  describe('disable', () => {
    it('deletes session and returns true if existed', async () => {
      vi.mocked(redis.del).mockResolvedValue(1);

      const result = await manager.disable('user123', 'personality456');

      expect(redis.del).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.INCOGNITO}user123:personality456`
      );
      expect(result).toBe(true);
    });

    it('returns false if session did not exist', async () => {
      vi.mocked(redis.del).mockResolvedValue(0);

      const result = await manager.disable('user123', 'nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('getSession', () => {
    it('returns parsed session if exists and not expired', async () => {
      const storedSession: IncognitoSession = {
        userId: 'user123',
        personalityId: 'personality456',
        enabledAt: '2026-01-15T11:00:00.000Z',
        expiresAt: '2026-01-15T13:00:00.000Z', // 1 hour after current time (12:00)
        duration: '1h',
      };
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(storedSession));

      const session = await manager.getSession('user123', 'personality456');

      expect(session).toEqual(storedSession);
    });

    it('returns null if session does not exist', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);

      const session = await manager.getSession('user123', 'nonexistent');

      expect(session).toBeNull();
    });

    it('deletes and returns null for invalid session data', async () => {
      vi.mocked(redis.get).mockResolvedValue('invalid json{');

      const session = await manager.getSession('user123', 'corrupted');

      expect(session).toBeNull();
      expect(redis.del).toHaveBeenCalled();
    });

    it('deletes and returns null for session with wrong schema', async () => {
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify({ foo: 'bar' }));

      const session = await manager.getSession('user123', 'wrong-schema');

      expect(session).toBeNull();
      expect(redis.del).toHaveBeenCalled();
    });

    it('deletes and returns null for expired session', async () => {
      // Session that has already expired (expiresAt is in the past)
      const expiredSession: IncognitoSession = {
        userId: 'user123',
        personalityId: 'personality456',
        enabledAt: '2026-01-15T10:00:00.000Z',
        expiresAt: '2026-01-15T11:00:00.000Z', // 1 hour before current time (12:00)
        duration: '1h',
      };
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(expiredSession));

      const session = await manager.getSession('user123', 'personality456');

      expect(session).toBeNull();
      expect(redis.del).toHaveBeenCalled();
    });

    it('returns session if not yet expired', async () => {
      // Session that expires in the future
      const validSession: IncognitoSession = {
        userId: 'user123',
        personalityId: 'personality456',
        enabledAt: '2026-01-15T11:00:00.000Z',
        expiresAt: '2026-01-15T13:00:00.000Z', // 1 hour after current time (12:00)
        duration: '1h',
      };
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(validSession));

      const session = await manager.getSession('user123', 'personality456');

      expect(session).toEqual(validSession);
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('isActive', () => {
    it('returns true if specific personality session exists', async () => {
      const session: IncognitoSession = {
        userId: 'user123',
        personalityId: 'personality456',
        enabledAt: '2026-01-15T11:00:00.000Z',
        expiresAt: '2026-01-15T13:00:00.000Z',
        duration: '1h',
      };

      vi.mocked(redis.get).mockImplementation(async (key: unknown) => {
        const keyStr = key as string;
        if (keyStr.endsWith(':personality456')) {
          return JSON.stringify(session);
        }
        return null;
      });

      const result = await manager.isActive('user123', 'personality456');

      expect(result).toBe(true);
    });

    it('returns true if global "all" session exists', async () => {
      const session: IncognitoSession = {
        userId: 'user123',
        personalityId: 'all',
        enabledAt: '2026-01-15T11:00:00.000Z',
        expiresAt: null,
        duration: 'forever',
      };

      vi.mocked(redis.get).mockImplementation(async (key: unknown) => {
        const keyStr = key as string;
        if (keyStr.endsWith(':all')) {
          return JSON.stringify(session);
        }
        return null;
      });

      // Check any personality - global should apply
      const result = await manager.isActive('user123', 'anyPersonality');

      expect(result).toBe(true);
    });

    it('returns false if no sessions exist', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);

      const result = await manager.isActive('user123', 'personality456');

      expect(result).toBe(false);
    });
  });

  describe('getActiveSession', () => {
    it('returns specific session over global when both exist', async () => {
      const specificSession: IncognitoSession = {
        userId: 'user123',
        personalityId: 'personality456',
        enabledAt: '2026-01-15T11:00:00.000Z',
        expiresAt: '2026-01-15T13:00:00.000Z',
        duration: '1h',
      };

      const globalSession: IncognitoSession = {
        userId: 'user123',
        personalityId: 'all',
        enabledAt: '2026-01-15T10:00:00.000Z',
        expiresAt: null,
        duration: 'forever',
      };

      vi.mocked(redis.get).mockImplementation(async (key: unknown) => {
        const keyStr = key as string;
        if (keyStr.endsWith(':personality456')) {
          return JSON.stringify(specificSession);
        }
        if (keyStr.endsWith(':all')) {
          return JSON.stringify(globalSession);
        }
        return null;
      });

      const session = await manager.getActiveSession('user123', 'personality456');

      expect(session).toEqual(specificSession);
    });

    it('returns global session when specific does not exist', async () => {
      const globalSession: IncognitoSession = {
        userId: 'user123',
        personalityId: 'all',
        enabledAt: '2026-01-15T10:00:00.000Z',
        expiresAt: null,
        duration: 'forever',
      };

      vi.mocked(redis.get).mockImplementation(async (key: unknown) => {
        const keyStr = key as string;
        if (keyStr.endsWith(':all')) {
          return JSON.stringify(globalSession);
        }
        return null;
      });

      const session = await manager.getActiveSession('user123', 'anyPersonality');

      expect(session).toEqual(globalSession);
    });
  });

  describe('getStatus', () => {
    it('returns all active sessions for a user', async () => {
      const session1: IncognitoSession = {
        userId: 'user123',
        personalityId: 'p1',
        enabledAt: '2026-01-15T11:00:00.000Z',
        expiresAt: '2026-01-15T12:00:00.000Z',
        duration: '1h',
      };

      const session2: IncognitoSession = {
        userId: 'user123',
        personalityId: 'p2',
        enabledAt: '2026-01-15T11:30:00.000Z',
        expiresAt: '2026-01-15T15:30:00.000Z',
        duration: '4h',
      };

      // SCAN returns [cursor, keys[]] - cursor '0' means done
      vi.mocked(redis.scan).mockResolvedValue([
        '0',
        [`${REDIS_KEY_PREFIXES.INCOGNITO}user123:p1`, `${REDIS_KEY_PREFIXES.INCOGNITO}user123:p2`],
      ]);

      vi.mocked(redis.mget).mockResolvedValue([JSON.stringify(session1), JSON.stringify(session2)]);

      const status = await manager.getStatus('user123');

      expect(status.active).toBe(true);
      expect(status.sessions).toHaveLength(2);
      expect(status.sessions).toContainEqual(session1);
      expect(status.sessions).toContainEqual(session2);
    });

    it('returns inactive status when no sessions exist', async () => {
      vi.mocked(redis.scan).mockResolvedValue(['0', []]);

      const status = await manager.getStatus('user123');

      expect(status.active).toBe(false);
      expect(status.sessions).toHaveLength(0);
    });

    it('skips invalid session data', async () => {
      vi.mocked(redis.scan).mockResolvedValue([
        '0',
        [`${REDIS_KEY_PREFIXES.INCOGNITO}user123:p1`, `${REDIS_KEY_PREFIXES.INCOGNITO}user123:p2`],
      ]);

      vi.mocked(redis.mget).mockResolvedValue([
        'invalid json',
        JSON.stringify({
          userId: 'user123',
          personalityId: 'p2',
          enabledAt: '2026-01-15T11:30:00.000Z',
          expiresAt: null,
          duration: 'forever',
        }),
      ]);

      const status = await manager.getStatus('user123');

      expect(status.sessions).toHaveLength(1);
      expect(status.sessions[0].personalityId).toBe('p2');
    });

    it('iterates through multiple SCAN batches', async () => {
      const session1: IncognitoSession = {
        userId: 'user123',
        personalityId: 'p1',
        enabledAt: '2026-01-15T11:00:00.000Z',
        expiresAt: '2026-01-15T12:00:00.000Z',
        duration: '1h',
      };

      const session2: IncognitoSession = {
        userId: 'user123',
        personalityId: 'p2',
        enabledAt: '2026-01-15T11:30:00.000Z',
        expiresAt: null,
        duration: 'forever',
      };

      // Simulate SCAN returning results across multiple iterations
      vi.mocked(redis.scan)
        .mockResolvedValueOnce(['42', [`${REDIS_KEY_PREFIXES.INCOGNITO}user123:p1`]])
        .mockResolvedValueOnce(['0', [`${REDIS_KEY_PREFIXES.INCOGNITO}user123:p2`]]);

      vi.mocked(redis.mget).mockResolvedValue([JSON.stringify(session1), JSON.stringify(session2)]);

      const status = await manager.getStatus('user123');

      expect(redis.scan).toHaveBeenCalledTimes(2);
      expect(status.active).toBe(true);
      expect(status.sessions).toHaveLength(2);
    });
  });

  describe('disableAll', () => {
    it('deletes all sessions for a user', async () => {
      vi.mocked(redis.scan).mockResolvedValue([
        '0',
        [
          `${REDIS_KEY_PREFIXES.INCOGNITO}user123:p1`,
          `${REDIS_KEY_PREFIXES.INCOGNITO}user123:p2`,
          `${REDIS_KEY_PREFIXES.INCOGNITO}user123:all`,
        ],
      ]);
      vi.mocked(redis.del).mockResolvedValue(3);

      const count = await manager.disableAll('user123');

      expect(redis.del).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.INCOGNITO}user123:p1`,
        `${REDIS_KEY_PREFIXES.INCOGNITO}user123:p2`,
        `${REDIS_KEY_PREFIXES.INCOGNITO}user123:all`
      );
      expect(count).toBe(3);
    });

    it('returns 0 when no sessions exist', async () => {
      vi.mocked(redis.scan).mockResolvedValue(['0', []]);

      const count = await manager.disableAll('user123');

      expect(count).toBe(0);
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('getTimeRemaining', () => {
    it('returns human-readable time for hours remaining', () => {
      const session: IncognitoSession = {
        userId: 'user123',
        personalityId: 'p1',
        enabledAt: '2026-01-15T11:00:00.000Z',
        expiresAt: '2026-01-15T14:30:00.000Z', // 2h 30m from now (12:00)
        duration: '4h',
      };

      const remaining = manager.getTimeRemaining(session);

      expect(remaining).toBe('2h 30m remaining');
    });

    it('returns just hours when no extra minutes', () => {
      const session: IncognitoSession = {
        userId: 'user123',
        personalityId: 'p1',
        enabledAt: '2026-01-15T11:00:00.000Z',
        expiresAt: '2026-01-15T14:00:00.000Z', // Exactly 2h from now
        duration: '4h',
      };

      const remaining = manager.getTimeRemaining(session);

      expect(remaining).toBe('2h remaining');
    });

    it('returns minutes when less than an hour', () => {
      const session: IncognitoSession = {
        userId: 'user123',
        personalityId: 'p1',
        enabledAt: '2026-01-15T11:00:00.000Z',
        expiresAt: '2026-01-15T12:45:00.000Z', // 45m from now
        duration: '1h',
      };

      const remaining = manager.getTimeRemaining(session);

      expect(remaining).toBe('45m remaining');
    });

    it('returns special message for forever duration', () => {
      const session: IncognitoSession = {
        userId: 'user123',
        personalityId: 'p1',
        enabledAt: '2026-01-15T11:00:00.000Z',
        expiresAt: null,
        duration: 'forever',
      };

      const remaining = manager.getTimeRemaining(session);

      expect(remaining).toBe('Until manually disabled');
    });

    it('returns Expired for past expiration', () => {
      const session: IncognitoSession = {
        userId: 'user123',
        personalityId: 'p1',
        enabledAt: '2026-01-15T10:00:00.000Z',
        expiresAt: '2026-01-15T11:00:00.000Z', // Already expired (it's 12:00)
        duration: '1h',
      };

      const remaining = manager.getTimeRemaining(session);

      expect(remaining).toBe('Expired');
    });
  });
});
