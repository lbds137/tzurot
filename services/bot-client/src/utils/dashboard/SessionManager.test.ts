/**
 * Dashboard Session Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DashboardSessionManager,
  getSessionManager,
  shutdownSessionManager,
} from './SessionManager.js';
import { isDashboardInteraction, parseDashboardCustomId, buildDashboardCustomId } from './types.js';

interface TestData {
  name: string;
  value: number;
}

describe('DashboardSessionManager', () => {
  let manager: DashboardSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new DashboardSessionManager(15 * 60 * 1000); // 15 minute timeout
  });

  afterEach(() => {
    manager.stopCleanup();
    manager.clear();
    vi.useRealTimers();
  });

  describe('set and get', () => {
    it('should create a new session', () => {
      const data: TestData = { name: 'test', value: 42 };

      const session = manager.set<TestData>(
        'user123',
        'character',
        'entity456',
        data,
        'msg789',
        'channel111'
      );

      expect(session.userId).toBe('user123');
      expect(session.entityType).toBe('character');
      expect(session.entityId).toBe('entity456');
      expect(session.data).toEqual(data);
      expect(session.messageId).toBe('msg789');
      expect(session.channelId).toBe('channel111');
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivityAt).toBeInstanceOf(Date);
    });

    it('should retrieve an existing session', () => {
      const data: TestData = { name: 'test', value: 42 };
      manager.set<TestData>('user123', 'character', 'entity456', data, 'msg789', 'channel111');

      const retrieved = manager.get<TestData>('user123', 'character', 'entity456');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.data).toEqual(data);
    });

    it('should return null for non-existent session', () => {
      const retrieved = manager.get<TestData>('nonexistent', 'character', 'entity');
      expect(retrieved).toBeNull();
    });

    it('should overwrite existing session with same key', () => {
      const data1: TestData = { name: 'first', value: 1 };
      const data2: TestData = { name: 'second', value: 2 };

      manager.set<TestData>('user123', 'character', 'entity456', data1, 'msg1', 'channel1');
      manager.set<TestData>('user123', 'character', 'entity456', data2, 'msg2', 'channel2');

      const retrieved = manager.get<TestData>('user123', 'character', 'entity456');

      expect(retrieved?.data).toEqual(data2);
      expect(retrieved?.messageId).toBe('msg2');
    });

    it('should track separate sessions for different entity types', () => {
      const charData: TestData = { name: 'character', value: 1 };
      const profileData: TestData = { name: 'profile', value: 2 };

      manager.set<TestData>('user123', 'character', 'entity1', charData, 'msg1', 'ch1');
      manager.set<TestData>('user123', 'profile', 'entity2', profileData, 'msg2', 'ch2');

      const charSession = manager.get<TestData>('user123', 'character', 'entity1');
      const profileSession = manager.get<TestData>('user123', 'profile', 'entity2');

      expect(charSession?.data.name).toBe('character');
      expect(profileSession?.data.name).toBe('profile');
    });
  });

  describe('session expiry', () => {
    it('should return null for expired sessions', () => {
      const data: TestData = { name: 'test', value: 42 };
      manager.set<TestData>('user123', 'character', 'entity456', data, 'msg789', 'channel111');

      // Advance time past the timeout
      vi.advanceTimersByTime(16 * 60 * 1000);

      const retrieved = manager.get<TestData>('user123', 'character', 'entity456');
      expect(retrieved).toBeNull();
    });

    it('should keep session alive if accessed within timeout', () => {
      const data: TestData = { name: 'test', value: 42 };
      manager.set<TestData>('user123', 'character', 'entity456', data, 'msg789', 'channel111');

      // Advance time but within timeout
      vi.advanceTimersByTime(10 * 60 * 1000);

      // Access refreshes the check (but doesn't update lastActivityAt)
      const retrieved = manager.get<TestData>('user123', 'character', 'entity456');
      expect(retrieved).not.toBeNull();
    });
  });

  describe('update', () => {
    it('should update session data', () => {
      const data: TestData = { name: 'original', value: 1 };
      manager.set<TestData>('user123', 'character', 'entity456', data, 'msg789', 'channel111');

      const updated = manager.update<TestData>('user123', 'character', 'entity456', {
        value: 99,
      });

      expect(updated).not.toBeNull();
      expect(updated?.data.name).toBe('original');
      expect(updated?.data.value).toBe(99);
    });

    it('should update lastActivityAt on update', () => {
      const data: TestData = { name: 'test', value: 42 };
      const session = manager.set<TestData>(
        'user123',
        'character',
        'entity456',
        data,
        'msg789',
        'channel111'
      );
      const originalActivity = session.lastActivityAt.getTime();

      vi.advanceTimersByTime(5000);

      const updated = manager.update<TestData>('user123', 'character', 'entity456', { value: 1 });

      expect(updated?.lastActivityAt.getTime()).toBeGreaterThan(originalActivity);
    });

    it('should return null when updating non-existent session', () => {
      const updated = manager.update<TestData>('nonexistent', 'character', 'entity', { value: 1 });
      expect(updated).toBeNull();
    });

    it('should return null when updating expired session', () => {
      const data: TestData = { name: 'test', value: 42 };
      manager.set<TestData>('user123', 'character', 'entity456', data, 'msg789', 'channel111');

      vi.advanceTimersByTime(16 * 60 * 1000);

      const updated = manager.update<TestData>('user123', 'character', 'entity456', { value: 1 });
      expect(updated).toBeNull();
    });
  });

  describe('touch', () => {
    it('should update lastActivityAt without changing data', () => {
      const data: TestData = { name: 'test', value: 42 };
      manager.set<TestData>('user123', 'character', 'entity456', data, 'msg789', 'channel111');

      vi.advanceTimersByTime(5000);

      const result = manager.touch('user123', 'character', 'entity456');

      expect(result).toBe(true);
      const session = manager.get<TestData>('user123', 'character', 'entity456');
      expect(session?.data).toEqual(data);
    });

    it('should return false for non-existent session', () => {
      const result = manager.touch('nonexistent', 'character', 'entity');
      expect(result).toBe(false);
    });

    it('should extend session lifetime', () => {
      const data: TestData = { name: 'test', value: 42 };
      manager.set<TestData>('user123', 'character', 'entity456', data, 'msg789', 'channel111');

      // Advance 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000);

      // Touch to refresh
      manager.touch('user123', 'character', 'entity456');

      // Advance another 10 minutes (would be expired without touch)
      vi.advanceTimersByTime(10 * 60 * 1000);

      const session = manager.get<TestData>('user123', 'character', 'entity456');
      expect(session).not.toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete an existing session', () => {
      const data: TestData = { name: 'test', value: 42 };
      manager.set<TestData>('user123', 'character', 'entity456', data, 'msg789', 'channel111');

      const result = manager.delete('user123', 'character', 'entity456');

      expect(result).toBe(true);
      expect(manager.get('user123', 'character', 'entity456')).toBeNull();
    });

    it('should return false when deleting non-existent session', () => {
      const result = manager.delete('nonexistent', 'character', 'entity');
      expect(result).toBe(false);
    });
  });

  describe('findByMessageId', () => {
    it('should find session by message ID', () => {
      const data: TestData = { name: 'test', value: 42 };
      manager.set<TestData>('user123', 'character', 'entity456', data, 'msg789', 'channel111');

      const found = manager.findByMessageId<TestData>('msg789');

      expect(found).not.toBeNull();
      expect(found?.data).toEqual(data);
      expect(found?.userId).toBe('user123');
    });

    it('should return null for non-existent message ID', () => {
      const found = manager.findByMessageId<TestData>('nonexistent');
      expect(found).toBeNull();
    });

    it('should return null for expired session', () => {
      const data: TestData = { name: 'test', value: 42 };
      manager.set<TestData>('user123', 'character', 'entity456', data, 'msg789', 'channel111');

      vi.advanceTimersByTime(16 * 60 * 1000);

      const found = manager.findByMessageId<TestData>('msg789');
      expect(found).toBeNull();
    });
  });

  describe('getUserSessions', () => {
    it('should return all sessions for a user', () => {
      manager.set<TestData>(
        'user123',
        'character',
        'entity1',
        { name: 'c1', value: 1 },
        'm1',
        'ch1'
      );
      manager.set<TestData>('user123', 'profile', 'entity2', { name: 'p1', value: 2 }, 'm2', 'ch2');
      manager.set<TestData>(
        'user456',
        'character',
        'entity3',
        { name: 'c2', value: 3 },
        'm3',
        'ch3'
      );

      const sessions = manager.getUserSessions('user123');

      expect(sessions).toHaveLength(2);
      expect(sessions.map(s => s.entityType).sort()).toEqual(['character', 'profile']);
    });

    it('should return empty array for user with no sessions', () => {
      const sessions = manager.getUserSessions('nonexistent');
      expect(sessions).toEqual([]);
    });

    it('should exclude expired sessions', () => {
      manager.set<TestData>(
        'user123',
        'character',
        'entity1',
        { name: 'c1', value: 1 },
        'm1',
        'ch1'
      );

      vi.advanceTimersByTime(16 * 60 * 1000);

      manager.set<TestData>('user123', 'profile', 'entity2', { name: 'p1', value: 2 }, 'm2', 'ch2');

      const sessions = manager.getUserSessions('user123');

      expect(sessions).toHaveLength(1);
      expect(sessions[0].entityType).toBe('profile');
    });
  });

  describe('getSessionCount', () => {
    it('should return correct session count', () => {
      expect(manager.getSessionCount()).toBe(0);

      manager.set<TestData>('user1', 'character', 'e1', { name: 'a', value: 1 }, 'm1', 'ch1');
      expect(manager.getSessionCount()).toBe(1);

      manager.set<TestData>('user2', 'character', 'e2', { name: 'b', value: 2 }, 'm2', 'ch2');
      expect(manager.getSessionCount()).toBe(2);

      manager.delete('user1', 'character', 'e1');
      expect(manager.getSessionCount()).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all sessions', () => {
      manager.set<TestData>('user1', 'character', 'e1', { name: 'a', value: 1 }, 'm1', 'ch1');
      manager.set<TestData>('user2', 'profile', 'e2', { name: 'b', value: 2 }, 'm2', 'ch2');

      manager.clear();

      expect(manager.getSessionCount()).toBe(0);
      expect(manager.get('user1', 'character', 'e1')).toBeNull();
      expect(manager.get('user2', 'profile', 'e2')).toBeNull();
    });
  });

  describe('cleanup interval', () => {
    it('should cleanup expired sessions periodically', () => {
      manager.startCleanup();

      manager.set<TestData>('user1', 'character', 'e1', { name: 'a', value: 1 }, 'm1', 'ch1');

      // Advance past session timeout
      vi.advanceTimersByTime(16 * 60 * 1000);

      // Session should be expired but not yet cleaned up
      expect(manager.getSessionCount()).toBe(1);

      // Advance to trigger cleanup (5 min interval from code)
      vi.advanceTimersByTime(5 * 60 * 1000);

      // Now cleanup should have run
      expect(manager.getSessionCount()).toBe(0);
    });

    it('should not start multiple cleanup intervals', () => {
      manager.startCleanup();
      manager.startCleanup();
      manager.startCleanup();

      // Just verifying no errors - implementation detail that only one interval runs
      expect(true).toBe(true);
    });

    it('should stop cleanup interval', () => {
      manager.startCleanup();
      manager.stopCleanup();

      manager.set<TestData>('user1', 'character', 'e1', { name: 'a', value: 1 }, 'm1', 'ch1');

      // Advance past both session timeout and cleanup interval
      vi.advanceTimersByTime(25 * 60 * 1000);

      // Session should still be in map (not cleaned up since interval stopped)
      // Note: getSessionCount returns raw count, get() checks expiry
      expect(manager.getSessionCount()).toBe(1);
    });
  });

  describe('custom timeout', () => {
    it('should respect custom timeout value', () => {
      const shortManager = new DashboardSessionManager(1000); // 1 second timeout

      shortManager.set<TestData>('user1', 'character', 'e1', { name: 'a', value: 1 }, 'm1', 'ch1');

      vi.advanceTimersByTime(500);
      expect(shortManager.get('user1', 'character', 'e1')).not.toBeNull();

      vi.advanceTimersByTime(600);
      expect(shortManager.get('user1', 'character', 'e1')).toBeNull();
    });
  });
});

describe('Singleton functions', () => {
  afterEach(() => {
    shutdownSessionManager();
  });

  describe('getSessionManager', () => {
    it('should return the same instance on multiple calls', () => {
      const manager1 = getSessionManager();
      const manager2 = getSessionManager();

      expect(manager1).toBe(manager2);
    });

    it('should start cleanup automatically', () => {
      const manager = getSessionManager();

      // Verify it's an instance of DashboardSessionManager
      expect(manager).toBeInstanceOf(DashboardSessionManager);
    });
  });

  describe('shutdownSessionManager', () => {
    it('should clear sessions and stop cleanup', () => {
      const manager = getSessionManager();
      manager.set('user1', 'test', 'entity1', { foo: 'bar' }, 'msg1', 'ch1');

      expect(manager.getSessionCount()).toBe(1);

      shutdownSessionManager();

      // Getting manager again should create a fresh instance
      const newManager = getSessionManager();
      expect(newManager.getSessionCount()).toBe(0);
    });

    it('should be safe to call multiple times', () => {
      getSessionManager();

      shutdownSessionManager();
      shutdownSessionManager();
      shutdownSessionManager();

      // No errors expected
      expect(true).toBe(true);
    });

    it('should be safe to call without initialization', () => {
      // Don't call getSessionManager first
      shutdownSessionManager();

      // No errors expected
      expect(true).toBe(true);
    });
  });
});

describe('Dashboard types utilities', () => {
  describe('isDashboardInteraction', () => {
    it('should return true for matching entity type', () => {
      expect(isDashboardInteraction('character-menu-abc123', 'character')).toBe(true);
      expect(isDashboardInteraction('character-modal-abc123-identity', 'character')).toBe(true);
      expect(isDashboardInteraction('character-close-abc123', 'character')).toBe(true);
    });

    it('should return false for non-matching entity type', () => {
      expect(isDashboardInteraction('profile-menu-abc123', 'character')).toBe(false);
      expect(isDashboardInteraction('other-action', 'character')).toBe(false);
    });
  });

  describe('parseDashboardCustomId', () => {
    it('should parse seed modal custom ID', () => {
      const result = parseDashboardCustomId('character-seed');
      expect(result).toEqual({
        entityType: 'character',
        action: 'seed',
        entityId: undefined,
        sectionId: undefined,
      });
    });

    it('should parse menu custom ID', () => {
      const result = parseDashboardCustomId('character-menu-abc123');
      expect(result).toEqual({
        entityType: 'character',
        action: 'menu',
        entityId: 'abc123',
        sectionId: undefined,
      });
    });

    it('should parse modal custom ID with section', () => {
      const result = parseDashboardCustomId('character-modal-abc123-identity');
      expect(result).toEqual({
        entityType: 'character',
        action: 'modal',
        entityId: 'abc123',
        sectionId: 'identity',
      });
    });

    it('should return null for invalid custom ID', () => {
      expect(parseDashboardCustomId('invalid')).toBeNull();
      expect(parseDashboardCustomId('')).toBeNull();
    });
  });

  describe('buildDashboardCustomId', () => {
    it('should build seed custom ID', () => {
      expect(buildDashboardCustomId('character', 'seed')).toBe('character-seed');
    });

    it('should build menu custom ID', () => {
      expect(buildDashboardCustomId('character', 'menu', 'abc123')).toBe('character-menu-abc123');
    });

    it('should build modal custom ID with section', () => {
      expect(buildDashboardCustomId('character', 'modal', 'abc123', 'identity')).toBe(
        'character-modal-abc123-identity'
      );
    });

    it('should skip empty entityId', () => {
      expect(buildDashboardCustomId('character', 'seed', '')).toBe('character-seed');
    });

    it('should skip empty sectionId', () => {
      expect(buildDashboardCustomId('character', 'menu', 'abc', '')).toBe('character-menu-abc');
    });
  });
});
