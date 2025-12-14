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
  let devClient: { $queryRawUnsafe: ReturnType<typeof vi.fn>; $executeRawUnsafe: ReturnType<typeof vi.fn> };
  let prodClient: { $queryRawUnsafe: ReturnType<typeof vi.fn>; $executeRawUnsafe: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    devClient = {
      $queryRawUnsafe: vi.fn(),
      $executeRawUnsafe: vi.fn(),
    };
    prodClient = {
      $queryRawUnsafe: vi.fn(),
      $executeRawUnsafe: vi.fn(),
    };
  });

  describe('loadTombstoneIds', () => {
    it('should load tombstone IDs from both databases', async () => {
      devClient.$queryRawUnsafe.mockResolvedValue([{ id: 'dev-id-1' }, { id: 'dev-id-2' }]);
      prodClient.$queryRawUnsafe.mockResolvedValue([{ id: 'prod-id-1' }, { id: 'dev-id-1' }]); // dev-id-1 is in both

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
      devClient.$queryRawUnsafe.mockResolvedValue([]);
      prodClient.$queryRawUnsafe.mockResolvedValue([]);

      const result = await loadTombstoneIds(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(result.size).toBe(0);
    });

    it('should query the correct table', async () => {
      devClient.$queryRawUnsafe.mockResolvedValue([]);
      prodClient.$queryRawUnsafe.mockResolvedValue([]);

      await loadTombstoneIds(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient
      );

      expect(devClient.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('conversation_history_tombstones')
      );
      expect(prodClient.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('conversation_history_tombstones')
      );
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
      expect(devClient.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(prodClient.$executeRawUnsafe).not.toHaveBeenCalled();
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
      expect(devClient.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(prodClient.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should delete messages with tombstones from both databases', async () => {
      const tombstoneIds = new Set(['id-1', 'id-2', 'id-3']);
      devClient.$executeRawUnsafe.mockResolvedValue(2); // 2 deleted from dev
      prodClient.$executeRawUnsafe.mockResolvedValue(3); // 3 deleted from prod

      const result = await deleteMessagesWithTombstones(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient,
        tombstoneIds,
        false
      );

      expect(result).toEqual({ devDeleted: 2, prodDeleted: 3 });
      expect(devClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "conversation_history"'),
        expect.arrayContaining(['id-1', 'id-2', 'id-3'])
      );
      expect(prodClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "conversation_history"'),
        expect.arrayContaining(['id-1', 'id-2', 'id-3'])
      );
    });

    it('should handle non-numeric delete results', async () => {
      const tombstoneIds = new Set(['id-1']);
      devClient.$executeRawUnsafe.mockResolvedValue({ count: 1 }); // Object instead of number
      prodClient.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await deleteMessagesWithTombstones(
        devClient as unknown as PrismaClient,
        prodClient as unknown as PrismaClient,
        tombstoneIds,
        false
      );

      // Should default to 0 when result is not a number
      expect(result).toEqual({ devDeleted: 0, prodDeleted: 0 });
    });
  });
});
