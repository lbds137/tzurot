/**
 * Tests for SettingsSessionStorage
 *
 * Tests the session storage helpers that wrap SessionManager
 * with settings-specific metadata (non-serializable update handler).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SettingsDashboardSession, SettingUpdateHandler } from './types.js';

// Mock SessionManager
const mockSessionManager = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../SessionManager.js', () => ({
  getSessionManager: () => mockSessionManager,
}));

import {
  storeSession,
  getSession,
  deleteSession,
  getUpdateHandler,
} from './SettingsSessionStorage.js';

describe('SettingsSessionStorage', () => {
  const mockSession: SettingsDashboardSession = {
    level: 'global',
    entityId: 'global',
    entityName: 'Global Settings',
    data: {
      maxMessages: { localValue: 50, effectiveValue: 50, source: 'global' },
      maxAge: { localValue: null, effectiveValue: null, source: 'default' },
      maxImages: { localValue: 5, effectiveValue: 5, source: 'global' },
    },
    view: 'overview' as never,
    userId: 'user-123',
    messageId: 'msg-123',
    channelId: 'channel-123',
    lastActivityAt: new Date(),
  };

  const mockUpdateHandler: SettingUpdateHandler = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('storeSession', () => {
    it('should store session in SessionManager with correct params', async () => {
      await storeSession(mockSession, 'admin-settings', mockUpdateHandler);

      expect(mockSessionManager.set).toHaveBeenCalledWith({
        userId: 'user-123',
        entityType: 'admin-settings',
        entityId: 'global',
        data: mockSession,
        messageId: 'msg-123',
        channelId: 'channel-123',
      });
    });
  });

  describe('getSession', () => {
    it('should return session data when found', async () => {
      mockSessionManager.get.mockResolvedValue({ data: mockSession });

      const result = await getSession('user-123', 'admin-settings', 'global');

      expect(result).toEqual(mockSession);
      expect(mockSessionManager.get).toHaveBeenCalledWith('user-123', 'admin-settings', 'global');
    });

    it('should return null when session not found', async () => {
      mockSessionManager.get.mockResolvedValue(null);

      const result = await getSession('user-123', 'admin-settings', 'global');

      expect(result).toBeNull();
    });

    it('should return null when session exists but data is undefined', async () => {
      mockSessionManager.get.mockResolvedValue({ data: undefined });

      const result = await getSession('user-123', 'admin-settings', 'global');

      expect(result).toBeNull();
    });
  });

  describe('deleteSession', () => {
    it('should delete session from SessionManager', async () => {
      await deleteSession('user-123', 'admin-settings', 'global');

      expect(mockSessionManager.delete).toHaveBeenCalledWith(
        'user-123',
        'admin-settings',
        'global'
      );
    });
  });

  describe('getUpdateHandler', () => {
    it('should return stored handler after storeSession', async () => {
      await storeSession(mockSession, 'admin-settings', mockUpdateHandler);

      const handler = getUpdateHandler('user-123', 'admin-settings', 'global');

      expect(handler).toBe(mockUpdateHandler);
    });

    it('should return undefined for unknown session', () => {
      const handler = getUpdateHandler('unknown', 'admin-settings', 'global');

      expect(handler).toBeUndefined();
    });

    it('should return undefined after deleteSession', async () => {
      await storeSession(mockSession, 'admin-settings', mockUpdateHandler);
      await deleteSession('user-123', 'admin-settings', 'global');

      const handler = getUpdateHandler('user-123', 'admin-settings', 'global');

      expect(handler).toBeUndefined();
    });
  });
});
