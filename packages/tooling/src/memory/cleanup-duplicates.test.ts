/**
 * Tests for Memory Duplicate Cleanup
 *
 * Tests the exported helpers: findDuplicates, deleteDuplicates,
 * displaySummary, and printAuditLog.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  findDuplicates,
  deleteDuplicates,
  displaySummary,
  printAuditLog,
  type DuplicateGroup,
  type DuplicateSummary,
} from './cleanup-duplicates.js';

/** Build a mock PrismaClient with the subset of methods used by the module */
function createMockPrisma() {
  return {
    $queryRaw: vi.fn(),
    memory: {
      deleteMany: vi.fn(),
    },
  };
}

/** Build a DuplicateGroup with sensible defaults */
function makeGroup(overrides?: Partial<DuplicateGroup>): DuplicateGroup {
  return {
    persona_id: 'persona-1',
    personality_id: 'pers-1',
    user_msg_prefix: '{user}: Hello there',
    count: 2,
    first_created: new Date('2026-02-10T12:00:00Z'),
    last_created: new Date('2026-02-10T12:00:30Z'),
    ids_to_delete: ['id-older'],
    ...overrides,
  };
}

/** Build a DuplicateSummary with sensible defaults */
function makeSummary(overrides?: Partial<DuplicateSummary>): DuplicateSummary {
  return {
    totalGroups: 1,
    totalDuplicates: 1,
    earliestDuplicate: new Date('2026-02-10T12:00:00Z'),
    latestDuplicate: new Date('2026-02-10T12:00:30Z'),
    groups: [makeGroup()],
    truncated: false,
    ...overrides,
  };
}

describe('cleanup-duplicates', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findDuplicates', () => {
    it('should return empty summary when no results', async () => {
      const mockPrisma = createMockPrisma();
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await findDuplicates(mockPrisma as never);

      expect(result).toEqual({
        totalGroups: 0,
        totalDuplicates: 0,
        earliestDuplicate: null,
        latestDuplicate: null,
        groups: [],
        truncated: false,
      });
    });

    it('should map results correctly and keep most recent ID', async () => {
      const mockPrisma = createMockPrisma();
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          persona_id: 'persona-1',
          personality_id: 'pers-1',
          user_msg_prefix: '{user}: Hello',
          count: BigInt(3),
          first_created: new Date('2026-02-10T12:00:00Z'),
          last_created: new Date('2026-02-10T12:00:45Z'),
          // Ordered DESC by created_at: newest first
          all_ids: ['id-newest', 'id-middle', 'id-oldest'],
        },
      ]);

      const result = await findDuplicates(mockPrisma as never);

      expect(result.totalGroups).toBe(1);
      expect(result.totalDuplicates).toBe(2);
      expect(result.groups).toHaveLength(1);
      // Keeps the first (newest), deletes the rest
      expect(result.groups[0].ids_to_delete).toEqual(['id-middle', 'id-oldest']);
      expect(result.groups[0].count).toBe(3);
      // Verify bigint was converted to number
      expect(typeof result.groups[0].count).toBe('number');
    });

    it('should set truncated=true when results hit query limit of 1000', async () => {
      const mockPrisma = createMockPrisma();
      // Generate exactly 1000 results
      const rows = Array.from({ length: 1000 }, (_, i) => ({
        persona_id: `persona-${i}`,
        personality_id: `pers-${i}`,
        user_msg_prefix: `{user}: Message ${i}`,
        count: BigInt(2),
        first_created: new Date('2026-02-10T12:00:00Z'),
        last_created: new Date('2026-02-10T12:00:30Z'),
        all_ids: [`id-${i}-new`, `id-${i}-old`],
      }));
      mockPrisma.$queryRaw.mockResolvedValue(rows);

      const result = await findDuplicates(mockPrisma as never);

      expect(result.truncated).toBe(true);
      expect(result.totalGroups).toBe(1000);
    });

    it('should set truncated=false when results are below limit', async () => {
      const mockPrisma = createMockPrisma();
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          persona_id: 'persona-1',
          personality_id: 'pers-1',
          user_msg_prefix: '{user}: Hello',
          count: BigInt(2),
          first_created: new Date('2026-02-10T12:00:00Z'),
          last_created: new Date('2026-02-10T12:00:30Z'),
          all_ids: ['id-new', 'id-old'],
        },
      ]);

      const result = await findDuplicates(mockPrisma as never);

      expect(result.truncated).toBe(false);
    });

    it('should convert bigint count to number', async () => {
      const mockPrisma = createMockPrisma();
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          persona_id: 'persona-1',
          personality_id: 'pers-1',
          user_msg_prefix: '{user}: Test',
          count: BigInt(5),
          first_created: new Date('2026-02-10T12:00:00Z'),
          last_created: new Date('2026-02-10T12:00:30Z'),
          all_ids: ['a', 'b', 'c', 'd', 'e'],
        },
      ]);

      const result = await findDuplicates(mockPrisma as never);

      expect(result.groups[0].count).toBe(5);
      expect(typeof result.groups[0].count).toBe('number');
    });

    it('should compute totalDuplicates across multiple groups', async () => {
      const mockPrisma = createMockPrisma();
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          persona_id: 'persona-1',
          personality_id: 'pers-1',
          user_msg_prefix: '{user}: First',
          count: BigInt(3),
          first_created: new Date('2026-02-10T12:00:00Z'),
          last_created: new Date('2026-02-10T12:00:30Z'),
          all_ids: ['a1', 'a2', 'a3'],
        },
        {
          persona_id: 'persona-2',
          personality_id: 'pers-2',
          user_msg_prefix: '{user}: Second',
          count: BigInt(2),
          first_created: new Date('2026-02-10T13:00:00Z'),
          last_created: new Date('2026-02-10T13:00:15Z'),
          all_ids: ['b1', 'b2'],
        },
      ]);

      const result = await findDuplicates(mockPrisma as never);

      // Group 1: 3 total, keep 1, delete 2. Group 2: 2 total, keep 1, delete 1.
      expect(result.totalDuplicates).toBe(3);
      expect(result.totalGroups).toBe(2);
    });

    it('should set earliest and latest dates from groups', async () => {
      const mockPrisma = createMockPrisma();
      const earlyDate = new Date('2026-01-01T00:00:00Z');
      const lateDate = new Date('2026-02-15T23:59:59Z');

      mockPrisma.$queryRaw.mockResolvedValue([
        {
          persona_id: 'persona-1',
          personality_id: 'pers-1',
          user_msg_prefix: '{user}: First',
          count: BigInt(2),
          first_created: new Date('2026-02-01T00:00:00Z'),
          last_created: lateDate,
          all_ids: ['a1', 'a2'],
        },
        {
          persona_id: 'persona-2',
          personality_id: 'pers-2',
          user_msg_prefix: '{user}: Second',
          count: BigInt(2),
          first_created: earlyDate,
          last_created: new Date('2026-01-01T00:01:00Z'),
          all_ids: ['b1', 'b2'],
        },
      ]);

      const result = await findDuplicates(mockPrisma as never);

      // Results are ORDER BY count DESC, first_created DESC
      // earliestDuplicate = last group's first_created
      // latestDuplicate = first group's last_created
      expect(result.latestDuplicate).toEqual(lateDate);
      expect(result.earliestDuplicate).toEqual(earlyDate);
    });
  });

  describe('deleteDuplicates', () => {
    it('should return 0 and make no calls for empty array', async () => {
      const mockPrisma = createMockPrisma();

      const result = await deleteDuplicates(mockPrisma as never, []);

      expect(result).toBe(0);
      expect(mockPrisma.memory.deleteMany).not.toHaveBeenCalled();
    });

    it('should delete in a single batch when under 100 IDs', async () => {
      const mockPrisma = createMockPrisma();
      mockPrisma.memory.deleteMany.mockResolvedValue({ count: 5 });

      const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5'];
      const result = await deleteDuplicates(mockPrisma as never, ids);

      expect(result).toBe(5);
      expect(mockPrisma.memory.deleteMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.memory.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ids } },
      });
    });

    it('should delete exactly 100 IDs in a single batch', async () => {
      const mockPrisma = createMockPrisma();
      mockPrisma.memory.deleteMany.mockResolvedValue({ count: 100 });

      const ids = Array.from({ length: 100 }, (_, i) => `id-${i}`);
      const result = await deleteDuplicates(mockPrisma as never, ids);

      expect(result).toBe(100);
      expect(mockPrisma.memory.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('should split into multiple batches when over 100 IDs', async () => {
      const mockPrisma = createMockPrisma();
      // First batch: 100 deleted, second batch: 50 deleted
      mockPrisma.memory.deleteMany
        .mockResolvedValueOnce({ count: 100 })
        .mockResolvedValueOnce({ count: 50 });

      const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
      const result = await deleteDuplicates(mockPrisma as never, ids);

      expect(result).toBe(150);
      expect(mockPrisma.memory.deleteMany).toHaveBeenCalledTimes(2);

      // First batch: IDs 0-99
      const firstCall = mockPrisma.memory.deleteMany.mock.calls[0][0];
      expect(firstCall.where.id.in).toHaveLength(100);
      expect(firstCall.where.id.in[0]).toBe('id-0');
      expect(firstCall.where.id.in[99]).toBe('id-99');

      // Second batch: IDs 100-149
      const secondCall = mockPrisma.memory.deleteMany.mock.calls[1][0];
      expect(secondCall.where.id.in).toHaveLength(50);
      expect(secondCall.where.id.in[0]).toBe('id-100');
    });

    it('should handle three batches correctly', async () => {
      const mockPrisma = createMockPrisma();
      mockPrisma.memory.deleteMany
        .mockResolvedValueOnce({ count: 100 })
        .mockResolvedValueOnce({ count: 100 })
        .mockResolvedValueOnce({ count: 25 });

      const ids = Array.from({ length: 225 }, (_, i) => `id-${i}`);
      const result = await deleteDuplicates(mockPrisma as never, ids);

      expect(result).toBe(225);
      expect(mockPrisma.memory.deleteMany).toHaveBeenCalledTimes(3);
    });

    it('should return total deleted count even if some batches delete fewer', async () => {
      const mockPrisma = createMockPrisma();
      // Simulate some IDs already being deleted (count < batch size)
      mockPrisma.memory.deleteMany
        .mockResolvedValueOnce({ count: 90 })
        .mockResolvedValueOnce({ count: 40 });

      const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
      const result = await deleteDuplicates(mockPrisma as never, ids);

      expect(result).toBe(130);
    });
  });

  describe('displaySummary', () => {
    it('should log basic stats in non-verbose mode', () => {
      const summary = makeSummary({
        totalGroups: 5,
        totalDuplicates: 12,
      });

      displaySummary(summary, false);

      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).toContain('5');
      expect(output).toContain('12');
    });

    it('should log date lines when dates are present', () => {
      const summary = makeSummary({
        earliestDuplicate: new Date('2026-01-15T10:00:00Z'),
        latestDuplicate: new Date('2026-02-20T14:30:00Z'),
      });

      displaySummary(summary, false);

      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).toContain('Earliest duplicate');
      expect(output).toContain('Latest duplicate');
    });

    it('should not log date lines when dates are null', () => {
      const summary = makeSummary({
        earliestDuplicate: null,
        latestDuplicate: null,
      });

      displaySummary(summary, false);

      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).not.toContain('Earliest duplicate');
      expect(output).not.toContain('Latest duplicate');
    });

    it('should show truncation warning when truncated', () => {
      const summary = makeSummary({ truncated: true });

      displaySummary(summary, false);

      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).toContain('Results limited to 1000 groups');
    });

    it('should not show truncation warning when not truncated', () => {
      const summary = makeSummary({ truncated: false });

      displaySummary(summary, false);

      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).not.toContain('Results limited to 1000 groups');
    });

    it('should show detailed breakdown in verbose mode', () => {
      const groups = [
        makeGroup({
          count: 3,
          user_msg_prefix: '{user}: Hello world',
          ids_to_delete: ['a', 'b'],
        }),
      ];
      const summary = makeSummary({ groups, totalGroups: 1 });

      displaySummary(summary, true);

      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).toContain('Detailed breakdown');
      expect(output).toContain('3 copies');
      expect(output).toContain('deleting 2');
    });

    it('should not show detailed breakdown in non-verbose mode', () => {
      const summary = makeSummary();

      displaySummary(summary, false);

      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).not.toContain('Detailed breakdown');
    });

    it('should limit verbose output to 10 groups', () => {
      const groups = Array.from({ length: 15 }, (_, i) =>
        makeGroup({
          persona_id: `persona-${i}`,
          user_msg_prefix: `{user}: Message ${i}`,
          ids_to_delete: [`id-${i}`],
        })
      );
      const summary = makeSummary({
        groups,
        totalGroups: 15,
        totalDuplicates: 15,
      });

      displaySummary(summary, true);

      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).toContain('and 5 more groups');
    });

    it('should not show "more groups" when 10 or fewer', () => {
      const groups = Array.from({ length: 10 }, (_, i) =>
        makeGroup({
          persona_id: `persona-${i}`,
          user_msg_prefix: `{user}: Message ${i}`,
        })
      );
      const summary = makeSummary({
        groups,
        totalGroups: 10,
        totalDuplicates: 10,
      });

      displaySummary(summary, true);

      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).not.toContain('more groups');
    });

    it('should truncate long user message prefixes in verbose mode', () => {
      const longPrefix = '{user}: ' + 'A'.repeat(100);
      const groups = [
        makeGroup({
          user_msg_prefix: longPrefix,
          count: 2,
          ids_to_delete: ['id-1'],
        }),
      ];
      const summary = makeSummary({ groups });

      displaySummary(summary, true);

      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      // The prefix should be truncated at 60 chars + "..."
      expect(output).toContain('...');
      // Should NOT contain the full 100-char string
      expect(output).not.toContain('A'.repeat(100));
    });
  });

  describe('printAuditLog', () => {
    it('should log environment, timestamp, and counts', () => {
      const fakeNow = new Date('2026-02-23T15:00:00Z');
      vi.setSystemTime(fakeNow);

      printAuditLog('dev', 42, 10);

      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).toContain('Audit log');
      expect(output).toContain('dev');
      expect(output).toContain('42');
      expect(output).toContain('10');
      expect(output).toContain('2026-02-23T15:00:00.000Z');

      vi.useRealTimers();
    });

    it('should log prod environment correctly', () => {
      printAuditLog('prod', 100, 25);

      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).toContain('prod');
      expect(output).toContain('100');
      expect(output).toContain('25');
    });
  });
});
