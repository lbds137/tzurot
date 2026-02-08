import { describe, it, expect, vi } from 'vitest';

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

vi.mock('./utils/syncValidation.js', () => ({
  assertValidTableName: vi.fn(),
  assertValidColumnName: vi.fn(),
}));

import { buildRowMap, compareTimestamps } from './SyncUpsertBuilder.js';
import type { SYNC_CONFIG } from './config/syncTables.js';

describe('SyncUpsertBuilder', () => {
  describe('buildRowMap', () => {
    it('should build map from rows with single PK', () => {
      const rows = [
        { id: 'a', name: 'Alice' },
        { id: 'b', name: 'Bob' },
      ];
      const map = buildRowMap(rows, 'id');
      expect(map.size).toBe(2);
      expect(map.get('a')).toEqual({ id: 'a', name: 'Alice' });
      expect(map.get('b')).toEqual({ id: 'b', name: 'Bob' });
    });

    it('should build map from rows with composite PK', () => {
      const rows = [
        { userId: 'u1', guildId: 'g1', role: 'admin' },
        { userId: 'u1', guildId: 'g2', role: 'member' },
      ];
      const map = buildRowMap(rows, ['userId', 'guildId']);
      expect(map.size).toBe(2);
      expect(map.get('u1|g1')).toEqual({ userId: 'u1', guildId: 'g1', role: 'admin' });
      expect(map.get('u1|g2')).toEqual({ userId: 'u1', guildId: 'g2', role: 'member' });
    });

    it('should handle empty rows array', () => {
      const map = buildRowMap([], 'id');
      expect(map.size).toBe(0);
    });

    it('should overwrite duplicate keys (last wins)', () => {
      const rows = [
        { id: 'a', value: 1 },
        { id: 'a', value: 2 },
      ];
      const map = buildRowMap(rows, 'id');
      expect(map.size).toBe(1);
      expect(map.get('a')).toEqual({ id: 'a', value: 2 });
    });
  });

  describe('compareTimestamps', () => {
    const now = new Date('2025-01-20T12:00:00Z');
    const earlier = new Date('2025-01-19T12:00:00Z');
    const config = {
      pk: 'id',
      uuidColumns: ['id'] as readonly string[],
      updatedAt: 'updatedAt',
      createdAt: 'createdAt',
    } as unknown as (typeof SYNC_CONFIG)[keyof typeof SYNC_CONFIG];

    it('should return dev-newer when dev has later timestamp', () => {
      const devRow = { updatedAt: now };
      const prodRow = { updatedAt: earlier };
      expect(compareTimestamps(devRow, prodRow, config)).toBe('dev-newer');
    });

    it('should return prod-newer when prod has later timestamp', () => {
      const devRow = { updatedAt: earlier };
      const prodRow = { updatedAt: now };
      expect(compareTimestamps(devRow, prodRow, config)).toBe('prod-newer');
    });

    it('should return same when timestamps are equal', () => {
      const devRow = { updatedAt: now };
      const prodRow = { updatedAt: new Date(now.getTime()) };
      expect(compareTimestamps(devRow, prodRow, config)).toBe('same');
    });

    it('should return same when timestamp field is undefined', () => {
      const configNoTimestamp = {
        pk: 'id',
        uuidColumns: ['id'] as readonly string[],
      } as unknown as (typeof SYNC_CONFIG)[keyof typeof SYNC_CONFIG];
      const devRow = { createdAt: now };
      const prodRow = { createdAt: earlier };
      expect(compareTimestamps(devRow, prodRow, configNoTimestamp)).toBe('same');
    });

    it('should return same when timestamps are not Date objects', () => {
      const devRow = { updatedAt: '2025-01-20' };
      const prodRow = { updatedAt: '2025-01-19' };
      expect(compareTimestamps(devRow, prodRow, config)).toBe('same');
    });
  });
});
