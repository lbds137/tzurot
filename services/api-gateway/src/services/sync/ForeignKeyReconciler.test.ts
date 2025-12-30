/**
 * Tests for ForeignKeyReconciler
 * Tests Pass 2 of two-pass sync: updating deferred FK columns
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForeignKeyReconciler } from './ForeignKeyReconciler.js';
import type { TableSyncConfig } from './config/syncTables.js';

// Mock logger
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

type SyncTableConfig = TableSyncConfig;

describe('ForeignKeyReconciler', () => {
  let mockDevClient: { $executeRawUnsafe: ReturnType<typeof vi.fn> };
  let mockProdClient: { $executeRawUnsafe: ReturnType<typeof vi.fn> };
  let reconciler: ForeignKeyReconciler;

  const mockFetchAllRows = vi.fn();
  const mockBuildRowMap = vi.fn();
  const mockCompareTimestamps = vi.fn();

  const testConfig: SyncTableConfig = {
    pk: 'id',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    uuidColumns: ['id', 'parentId'],
    timestampColumns: ['createdAt', 'updatedAt'],
    deferredFkColumns: ['parentId'],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDevClient = { $executeRawUnsafe: vi.fn() };
    mockProdClient = { $executeRawUnsafe: vi.fn() };

    reconciler = new ForeignKeyReconciler(mockDevClient as never, mockProdClient as never);
  });

  describe('reconcile', () => {
    it('should skip if no deferred FK columns', async () => {
      const configWithoutDeferred: SyncTableConfig = {
        pk: 'id',
        createdAt: 'createdAt',
        uuidColumns: ['id'],
        timestampColumns: ['createdAt'],
      };

      await reconciler.reconcile(
        'test_table',
        configWithoutDeferred,
        mockFetchAllRows,
        mockBuildRowMap,
        mockCompareTimestamps
      );

      expect(mockFetchAllRows).not.toHaveBeenCalled();
    });

    it('should update prod when dev is newer', async () => {
      const devRow = { id: 'row-1', parentId: 'parent-dev', updatedAt: new Date('2025-01-02') };
      const prodRow = { id: 'row-1', parentId: 'parent-prod', updatedAt: new Date('2025-01-01') };

      mockFetchAllRows
        .mockResolvedValueOnce([devRow]) // dev rows
        .mockResolvedValueOnce([prodRow]); // prod rows

      mockBuildRowMap
        .mockReturnValueOnce(new Map([['row-1', devRow]]))
        .mockReturnValueOnce(new Map([['row-1', prodRow]]));

      mockCompareTimestamps.mockReturnValue('dev-newer');

      await reconciler.reconcile(
        'test_table',
        testConfig,
        mockFetchAllRows,
        mockBuildRowMap,
        mockCompareTimestamps
      );

      // Should update prod with dev's value
      expect(mockProdClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "test_table"'),
        'parent-dev',
        'row-1'
      );
      expect(mockDevClient.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should update dev when prod is newer', async () => {
      const devRow = { id: 'row-1', parentId: 'parent-dev', updatedAt: new Date('2025-01-01') };
      const prodRow = { id: 'row-1', parentId: 'parent-prod', updatedAt: new Date('2025-01-02') };

      mockFetchAllRows.mockResolvedValueOnce([devRow]).mockResolvedValueOnce([prodRow]);

      mockBuildRowMap
        .mockReturnValueOnce(new Map([['row-1', devRow]]))
        .mockReturnValueOnce(new Map([['row-1', prodRow]]));

      mockCompareTimestamps.mockReturnValue('prod-newer');

      await reconciler.reconcile(
        'test_table',
        testConfig,
        mockFetchAllRows,
        mockBuildRowMap,
        mockCompareTimestamps
      );

      // Should update dev with prod's value
      expect(mockDevClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "test_table"'),
        'parent-prod',
        'row-1'
      );
      expect(mockProdClient.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should update both when timestamps are same', async () => {
      const timestamp = new Date('2025-01-01');
      const devRow = { id: 'row-1', parentId: 'parent-dev', updatedAt: timestamp };
      const prodRow = { id: 'row-1', parentId: 'parent-prod', updatedAt: timestamp };

      mockFetchAllRows.mockResolvedValueOnce([devRow]).mockResolvedValueOnce([prodRow]);

      mockBuildRowMap
        .mockReturnValueOnce(new Map([['row-1', devRow]]))
        .mockReturnValueOnce(new Map([['row-1', prodRow]]));

      mockCompareTimestamps.mockReturnValue('same');

      await reconciler.reconcile(
        'test_table',
        testConfig,
        mockFetchAllRows,
        mockBuildRowMap,
        mockCompareTimestamps
      );

      // Both should be updated
      expect(mockProdClient.$executeRawUnsafe).toHaveBeenCalled();
      expect(mockDevClient.$executeRawUnsafe).toHaveBeenCalled();
    });

    it('should skip null FK values', async () => {
      const devRow = { id: 'row-1', parentId: null, updatedAt: new Date() };
      const prodRow = { id: 'row-1', parentId: 'parent-prod', updatedAt: new Date() };

      mockFetchAllRows.mockResolvedValueOnce([devRow]).mockResolvedValueOnce([prodRow]);

      mockBuildRowMap
        .mockReturnValueOnce(new Map([['row-1', devRow]]))
        .mockReturnValueOnce(new Map([['row-1', prodRow]]));

      mockCompareTimestamps.mockReturnValue('dev-newer');

      await reconciler.reconcile(
        'test_table',
        testConfig,
        mockFetchAllRows,
        mockBuildRowMap,
        mockCompareTimestamps
      );

      // Dev has null, so prod should NOT be updated
      expect(mockProdClient.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should handle rows only in prod', async () => {
      const prodRow = { id: 'row-1', parentId: 'parent-prod', updatedAt: new Date() };

      mockFetchAllRows
        .mockResolvedValueOnce([]) // no dev rows
        .mockResolvedValueOnce([prodRow]);

      mockBuildRowMap
        .mockReturnValueOnce(new Map())
        .mockReturnValueOnce(new Map([['row-1', prodRow]]));

      await reconciler.reconcile(
        'test_table',
        testConfig,
        mockFetchAllRows,
        mockBuildRowMap,
        mockCompareTimestamps
      );

      // Should copy prod FK value to dev
      expect(mockDevClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "test_table"'),
        'parent-prod',
        'row-1'
      );
    });

    it('should handle rows only in dev', async () => {
      const devRow = { id: 'row-1', parentId: 'parent-dev', updatedAt: new Date() };

      mockFetchAllRows.mockResolvedValueOnce([devRow]).mockResolvedValueOnce([]); // no prod rows

      mockBuildRowMap
        .mockReturnValueOnce(new Map([['row-1', devRow]]))
        .mockReturnValueOnce(new Map());

      await reconciler.reconcile(
        'test_table',
        testConfig,
        mockFetchAllRows,
        mockBuildRowMap,
        mockCompareTimestamps
      );

      // Should copy dev FK value to prod
      expect(mockProdClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "test_table"'),
        'parent-dev',
        'row-1'
      );
    });

    it('should skip when values are equal', async () => {
      const devRow = { id: 'row-1', parentId: 'same-parent', updatedAt: new Date() };
      const prodRow = { id: 'row-1', parentId: 'same-parent', updatedAt: new Date() };

      mockFetchAllRows.mockResolvedValueOnce([devRow]).mockResolvedValueOnce([prodRow]);

      mockBuildRowMap
        .mockReturnValueOnce(new Map([['row-1', devRow]]))
        .mockReturnValueOnce(new Map([['row-1', prodRow]]));

      mockCompareTimestamps.mockReturnValue('same');

      await reconciler.reconcile(
        'test_table',
        testConfig,
        mockFetchAllRows,
        mockBuildRowMap,
        mockCompareTimestamps
      );

      // Values are equal, no updates needed
      expect(mockDevClient.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(mockProdClient.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });
});
