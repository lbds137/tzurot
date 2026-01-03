/**
 * Tests for Tombstone Utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadTombstoneIds, deleteMessagesWithTombstones } from './tombstoneUtils.js';
import type { PrismaClient } from '@tzurot/common-types';

// Mock logger
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('tombstoneUtils', () => {
  let devClient: {
    conversationHistoryTombstone: {
      findMany: ReturnType<typeof vi.fn>;
    };
    conversationHistory: {
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };
  let prodClient: {
    conversationHistoryTombstone: {
      findMany: ReturnType<typeof vi.fn>;
    };
    conversationHistory: {
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    devClient = {
      conversationHistoryTombstone: {
        findMany: vi.fn(),
      },
      conversationHistory: {
        deleteMany: vi.fn(),
      },
    };
    prodClient = {
      conversationHistoryTombstone: {
        findMany: vi.fn(),
      },
      conversationHistory: {
        deleteMany: vi.fn(),
      },
    };
  });

  describe('loadTombstoneIds', () => {
    it('should load tombstone IDs from both databases', async () => {
      devClient.conversationHistoryTombstone.findMany.mockResolvedValue([
        { id: 'dev-id-1' },
        { id: 'dev-id-2' },
      ]);
      prodClient.conversationHistoryTombstone.findMany.mockResolvedValue([
        { id: 'prod-id-1' },
        { id: 'dev-id-1' }, // dev-id-1 is in both
      ]);

      const result = await loadTombstoneIds(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(3); // Deduplicated: dev-id-1, dev-id-2, prod-id-1
      expect(result.has('dev-id-1')).toBe(true);
      expect(result.has('dev-id-2')).toBe(true);
      expect(result.has('prod-id-1')).toBe(true);
    });

    it('should return empty set when no tombstones exist', async () => {
      devClient.conversationHistoryTombstone.findMany.mockResolvedValue([]);
      prodClient.conversationHistoryTombstone.findMany.mockResolvedValue([]);

      const result = await loadTombstoneIds(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(result.size).toBe(0);
    });

    it('should query with correct paginated parameters', async () => {
      devClient.conversationHistoryTombstone.findMany.mockResolvedValue([]);
      prodClient.conversationHistoryTombstone.findMany.mockResolvedValue([]);

      await loadTombstoneIds(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Now uses pagination with cursor-based approach
      expect(devClient.conversationHistoryTombstone.findMany).toHaveBeenCalledWith({
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 1000,
        skip: 0,
        cursor: undefined,
      });
      expect(prodClient.conversationHistoryTombstone.findMany).toHaveBeenCalledWith({
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 1000,
        skip: 0,
        cursor: undefined,
      });
    });

    it('should load from both databases in parallel', async () => {
      devClient.conversationHistoryTombstone.findMany.mockResolvedValue([{ id: 'dev-1' }]);
      prodClient.conversationHistoryTombstone.findMany.mockResolvedValue([{ id: 'prod-1' }]);

      await loadTombstoneIds(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      // Both should be called (Promise.all runs in parallel)
      expect(devClient.conversationHistoryTombstone.findMany).toHaveBeenCalled();
      expect(prodClient.conversationHistoryTombstone.findMany).toHaveBeenCalled();
    });
  });

  describe('deleteMessagesWithTombstones', () => {
    it('should return zeros when tombstone set is empty', async () => {
      const result = await deleteMessagesWithTombstones(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient,
        new Set(),
        false
      );

      expect(result).toEqual({ devDeleted: 0, prodDeleted: 0 });
      expect(devClient.conversationHistory.deleteMany).not.toHaveBeenCalled();
      expect(prodClient.conversationHistory.deleteMany).not.toHaveBeenCalled();
    });

    it('should not delete when dryRun is true', async () => {
      const tombstoneIds = new Set(['id-1', 'id-2']);

      const result = await deleteMessagesWithTombstones(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient,
        tombstoneIds,
        true // dryRun
      );

      expect(result).toEqual({ devDeleted: 0, prodDeleted: 0 });
      expect(devClient.conversationHistory.deleteMany).not.toHaveBeenCalled();
      expect(prodClient.conversationHistory.deleteMany).not.toHaveBeenCalled();
    });

    it('should delete messages with tombstones from both databases', async () => {
      const tombstoneIds = new Set(['id-1', 'id-2', 'id-3']);
      devClient.conversationHistory.deleteMany.mockResolvedValue({ count: 2 }); // 2 deleted from dev
      prodClient.conversationHistory.deleteMany.mockResolvedValue({ count: 3 }); // 3 deleted from prod

      const result = await deleteMessagesWithTombstones(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient,
        tombstoneIds,
        false
      );

      expect(result).toEqual({ devDeleted: 2, prodDeleted: 3 });
      expect(devClient.conversationHistory.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: expect.arrayContaining(['id-1', 'id-2', 'id-3']) } },
      });
      expect(prodClient.conversationHistory.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: expect.arrayContaining(['id-1', 'id-2', 'id-3']) } },
      });
    });

    it('should delete from both databases in parallel', async () => {
      const tombstoneIds = new Set(['id-1']);
      devClient.conversationHistory.deleteMany.mockResolvedValue({ count: 1 });
      prodClient.conversationHistory.deleteMany.mockResolvedValue({ count: 1 });

      await deleteMessagesWithTombstones(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient,
        tombstoneIds,
        false
      );

      // Both should be called (Promise.all runs in parallel)
      expect(devClient.conversationHistory.deleteMany).toHaveBeenCalled();
      expect(prodClient.conversationHistory.deleteMany).toHaveBeenCalled();
    });
  });
});
