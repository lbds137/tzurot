/**
 * Pending Verification Messages Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  storePendingVerificationMessage,
  getPendingVerificationMessages,
  clearPendingVerificationMessages,
  getAllPendingVerificationUserIds,
  MAX_MESSAGE_AGE_MS,
  type PendingVerificationMessage,
} from './pendingVerificationMessages.js';

// Mock Redis
const mockRedis = {
  rpush: vi.fn(),
  expire: vi.fn(),
  lrange: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
};

describe('Pending Verification Messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('storePendingVerificationMessage', () => {
    it('should store a message in Redis', async () => {
      mockRedis.rpush.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const message: PendingVerificationMessage = {
        messageId: 'msg-123',
        channelId: 'channel-456',
        timestamp: Date.now(),
      };

      await storePendingVerificationMessage(mockRedis as any, 'user-789', message);

      expect(mockRedis.rpush).toHaveBeenCalledWith(
        'nsfw:verification:pending:user-789',
        JSON.stringify(message)
      );
      expect(mockRedis.expire).toHaveBeenCalledWith(
        'nsfw:verification:pending:user-789',
        14 * 24 * 60 * 60 // 14 days
      );
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.rpush.mockRejectedValue(new Error('Redis error'));

      const message: PendingVerificationMessage = {
        messageId: 'msg-123',
        channelId: 'channel-456',
        timestamp: Date.now(),
      };

      // Should not throw
      await expect(
        storePendingVerificationMessage(mockRedis as any, 'user-789', message)
      ).resolves.not.toThrow();
    });
  });

  describe('getPendingVerificationMessages', () => {
    it('should retrieve messages from Redis', async () => {
      const messages: PendingVerificationMessage[] = [
        { messageId: 'msg-1', channelId: 'ch-1', timestamp: 1000 },
        { messageId: 'msg-2', channelId: 'ch-2', timestamp: 2000 },
      ];

      mockRedis.lrange.mockResolvedValue(messages.map(m => JSON.stringify(m)));

      const result = await getPendingVerificationMessages(mockRedis as any, 'user-123');

      expect(result).toEqual(messages);
      expect(mockRedis.lrange).toHaveBeenCalledWith('nsfw:verification:pending:user-123', 0, -1);
    });

    it('should return empty array on Redis error', async () => {
      mockRedis.lrange.mockRejectedValue(new Error('Redis error'));

      const result = await getPendingVerificationMessages(mockRedis as any, 'user-123');

      expect(result).toEqual([]);
    });
  });

  describe('clearPendingVerificationMessages', () => {
    it('should delete the key from Redis', async () => {
      mockRedis.del.mockResolvedValue(1);

      await clearPendingVerificationMessages(mockRedis as any, 'user-123');

      expect(mockRedis.del).toHaveBeenCalledWith('nsfw:verification:pending:user-123');
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis error'));

      await expect(
        clearPendingVerificationMessages(mockRedis as any, 'user-123')
      ).resolves.not.toThrow();
    });
  });

  describe('getAllPendingVerificationUserIds', () => {
    it('should return user IDs from Redis keys', async () => {
      mockRedis.keys.mockResolvedValue([
        'nsfw:verification:pending:user-1',
        'nsfw:verification:pending:user-2',
        'nsfw:verification:pending:user-3',
      ]);

      const result = await getAllPendingVerificationUserIds(mockRedis as any);

      expect(result).toEqual(['user-1', 'user-2', 'user-3']);
    });

    it('should return empty array on Redis error', async () => {
      mockRedis.keys.mockRejectedValue(new Error('Redis error'));

      const result = await getAllPendingVerificationUserIds(mockRedis as any);

      expect(result).toEqual([]);
    });
  });

  describe('MAX_MESSAGE_AGE_MS', () => {
    it('should be 13 days in milliseconds', () => {
      const thirteenDays = 13 * 24 * 60 * 60 * 1000;
      expect(MAX_MESSAGE_AGE_MS).toBe(thirteenDays);
    });
  });
});
