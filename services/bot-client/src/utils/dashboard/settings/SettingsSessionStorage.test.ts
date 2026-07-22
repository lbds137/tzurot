/**
 * Tests for SettingsSessionStorage
 *
 * Tests the thin Redis-backed SessionManager wrappers. Update handlers are
 * NOT session state — they're rebuilt per-interaction (see the production
 * file's header for why the old handler Map was removed).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SettingsDashboardSession } from './types.js';

// Mock SessionManager
const mockSessionManager = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../SessionManager.js', () => ({
  getSessionManager: () => mockSessionManager,
}));

import { storeSession, getSession, deleteSession } from './SettingsSessionStorage.js';

describe('SettingsSessionStorage', () => {
  const mockSession: SettingsDashboardSession = {
    level: 'global',
    entityId: 'global',
    entityName: 'Global Settings',
    data: {
      maxMessages: { localValue: 50, hasLocalOverride: true, effectiveValue: 50, source: 'admin' },
      maxAge: {
        localValue: null,
        hasLocalOverride: false,
        effectiveValue: null,
        source: 'hardcoded',
      },
      maxImages: { localValue: 5, hasLocalOverride: true, effectiveValue: 5, source: 'admin' },
      crossChannelHistoryEnabled: {
        localValue: null,
        hasLocalOverride: false,
        effectiveValue: false,
        source: 'hardcoded',
      },
      shareLtmAcrossPersonalities: {
        localValue: null,
        hasLocalOverride: false,
        effectiveValue: false,
        source: 'hardcoded',
      },
      showModelFooter: {
        localValue: null,
        hasLocalOverride: false,
        effectiveValue: true,
        source: 'hardcoded',
      },
      memoryScoreThreshold: {
        localValue: null,
        hasLocalOverride: false,
        effectiveValue: 0.5,
        source: 'hardcoded',
      },
      memoryLimit: {
        localValue: null,
        hasLocalOverride: false,
        effectiveValue: 20,
        source: 'hardcoded',
      },
      voiceResponseMode: {
        localValue: null,
        hasLocalOverride: false,
        effectiveValue: 'always' as const,
        source: 'hardcoded',
      },
      voiceTranscriptionEnabled: {
        localValue: null,
        hasLocalOverride: false,
        effectiveValue: false,
        source: 'hardcoded',
      },
    },
    view: 'overview' as never,
    userId: 'user-123',
    messageId: 'msg-123',
    channelId: 'channel-123',
    lastActivityAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('storeSession', () => {
    it('should store session in SessionManager with correct params', async () => {
      await storeSession(mockSession, 'admin-settings');

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
});
