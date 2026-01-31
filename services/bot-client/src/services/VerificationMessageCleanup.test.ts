/**
 * Verification Message Cleanup Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType } from 'discord.js';
import { VerificationMessageCleanup } from './VerificationMessageCleanup.js';

// Mock the pendingVerificationMessages module
vi.mock('../utils/pendingVerificationMessages.js', () => ({
  getPendingVerificationMessages: vi.fn(),
  clearPendingVerificationMessages: vi.fn(),
  getAllPendingVerificationUserIds: vi.fn(),
  MAX_MESSAGE_AGE_MS: 13 * 24 * 60 * 60 * 1000,
  REDIS_KEY_PREFIX: 'nsfw:verification:pending:',
}));

import {
  getPendingVerificationMessages,
  clearPendingVerificationMessages,
  getAllPendingVerificationUserIds,
  MAX_MESSAGE_AGE_MS,
  REDIS_KEY_PREFIX,
} from '../utils/pendingVerificationMessages.js';

describe('VerificationMessageCleanup', () => {
  let cleanup: VerificationMessageCleanup;
  let mockClient: {
    channels: { fetch: ReturnType<typeof vi.fn> };
  };
  let mockRedis: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      channels: {
        fetch: vi.fn(),
      },
    };

    mockRedis = {
      rpush: vi.fn(),
      expire: vi.fn(),
      pipeline: vi.fn().mockReturnValue({
        rpush: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      }),
    };

    cleanup = new VerificationMessageCleanup(mockClient as any, mockRedis as any);
  });

  describe('cleanupForUser', () => {
    it('should do nothing if no pending messages', async () => {
      vi.mocked(getPendingVerificationMessages).mockResolvedValue([]);

      await cleanup.cleanupForUser('user-123');

      expect(mockClient.channels.fetch).not.toHaveBeenCalled();
      expect(clearPendingVerificationMessages).not.toHaveBeenCalled();
    });

    it('should delete messages and clear Redis on success', async () => {
      const mockMessage = { delete: vi.fn().mockResolvedValue(undefined) };
      const mockDmChannel = {
        type: ChannelType.DM,
        messages: { fetch: vi.fn().mockResolvedValue(mockMessage) },
      };

      vi.mocked(getPendingVerificationMessages).mockResolvedValue([
        { messageId: 'msg-1', channelId: 'ch-1', timestamp: Date.now() },
      ]);
      mockClient.channels.fetch.mockResolvedValue(mockDmChannel);

      await cleanup.cleanupForUser('user-123');

      expect(mockClient.channels.fetch).toHaveBeenCalledWith('ch-1');
      expect(mockDmChannel.messages.fetch).toHaveBeenCalledWith('msg-1');
      expect(mockMessage.delete).toHaveBeenCalled();
      expect(clearPendingVerificationMessages).toHaveBeenCalledWith(mockRedis, 'user-123');
    });

    it('should clear Redis even if message deletion fails', async () => {
      vi.mocked(getPendingVerificationMessages).mockResolvedValue([
        { messageId: 'msg-1', channelId: 'ch-1', timestamp: Date.now() },
      ]);
      mockClient.channels.fetch.mockRejectedValue(new Error('Channel not found'));

      await cleanup.cleanupForUser('user-123');

      // Should still clear Redis
      expect(clearPendingVerificationMessages).toHaveBeenCalledWith(mockRedis, 'user-123');
    });

    it('should skip non-DM channels', async () => {
      const mockGuildChannel = {
        type: ChannelType.GuildText,
      };

      vi.mocked(getPendingVerificationMessages).mockResolvedValue([
        { messageId: 'msg-1', channelId: 'ch-1', timestamp: Date.now() },
      ]);
      mockClient.channels.fetch.mockResolvedValue(mockGuildChannel);

      await cleanup.cleanupForUser('user-123');

      expect(clearPendingVerificationMessages).toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredMessages', () => {
    it('should return zeros when no users have pending messages', async () => {
      vi.mocked(getAllPendingVerificationUserIds).mockResolvedValue([]);

      const result = await cleanup.cleanupExpiredMessages();

      expect(result).toEqual({ processed: 0, deleted: 0, failed: 0 });
    });

    it('should delete expired messages and keep non-expired ones', async () => {
      const now = Date.now();
      const expiredTimestamp = now - MAX_MESSAGE_AGE_MS - 1000; // Older than 13 days
      const freshTimestamp = now - 1000; // 1 second ago

      const mockMessage = { delete: vi.fn().mockResolvedValue(undefined) };
      const mockDmChannel = {
        type: ChannelType.DM,
        messages: { fetch: vi.fn().mockResolvedValue(mockMessage) },
      };

      vi.mocked(getAllPendingVerificationUserIds).mockResolvedValue(['user-1']);
      vi.mocked(getPendingVerificationMessages).mockResolvedValue([
        { messageId: 'expired-msg', channelId: 'ch-1', timestamp: expiredTimestamp },
        { messageId: 'fresh-msg', channelId: 'ch-2', timestamp: freshTimestamp },
      ]);
      mockClient.channels.fetch.mockResolvedValue(mockDmChannel);

      const result = await cleanup.cleanupExpiredMessages();

      // Should only process the expired message
      expect(result.processed).toBe(1);
      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(0);

      // Should have tried to delete only the expired message
      expect(mockDmChannel.messages.fetch).toHaveBeenCalledWith('expired-msg');
      expect(mockDmChannel.messages.fetch).not.toHaveBeenCalledWith('fresh-msg');
    });

    it('should count failed deletions', async () => {
      const expiredTimestamp = Date.now() - MAX_MESSAGE_AGE_MS - 1000;

      vi.mocked(getAllPendingVerificationUserIds).mockResolvedValue(['user-1']);
      vi.mocked(getPendingVerificationMessages).mockResolvedValue([
        { messageId: 'msg-1', channelId: 'ch-1', timestamp: expiredTimestamp },
      ]);
      mockClient.channels.fetch.mockRejectedValue(new Error('Channel not found'));

      const result = await cleanup.cleanupExpiredMessages();

      expect(result.processed).toBe(1);
      expect(result.deleted).toBe(0);
      expect(result.failed).toBe(1);
    });
  });
});
