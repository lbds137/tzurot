/**
 * Tests for MultiTagPersistence — Redis adapter for coordinator state.
 *
 * Uses a hand-rolled Redis mock that records calls. We're not testing
 * Redis itself — just verifying that the persistence layer wires the
 * right commands to the right keys with the right TTL.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { MULTI_TAG, REDIS_KEY_PREFIXES } from '@tzurot/common-types';
import { MultiTagPersistence, type CoordinatorEntrySnapshot } from './MultiTagPersistence.js';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

function buildEntry(overrides: Partial<CoordinatorEntrySnapshot> = {}): CoordinatorEntrySnapshot {
  return {
    groupId: 'group-1',
    sourceMessageId: 'src-msg-1',
    channelId: 'channel-1',
    guildId: 'guild-1',
    userId: 'user-1',
    userMessageTime: new Date('2026-05-15T10:00:00Z').toISOString(),
    userMessageContent: 'hello',
    slots: [
      {
        slotIndex: 0,
        personalityId: 'pid-A',
        personalitySlug: 'alice',
        source: 'mention',
        isAutoResponse: false,
        jobId: 'job-A',
        status: 'pending',
      },
      {
        slotIndex: 1,
        personalityId: 'pid-B',
        personalitySlug: 'bob',
        source: 'mention',
        isAutoResponse: false,
        jobId: 'job-B',
        status: 'pending',
      },
    ],
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('MultiTagPersistence', () => {
  let pipelineCalls: Array<{ method: string; args: unknown[] }>;
  let mockRedis: {
    multi: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    scan: ReturnType<typeof vi.fn>;
    mget: ReturnType<typeof vi.fn>;
    sadd: ReturnType<typeof vi.fn>;
    srem: ReturnType<typeof vi.fn>;
    sismember: ReturnType<typeof vi.fn>;
  };
  let persistence: MultiTagPersistence;

  beforeEach(() => {
    pipelineCalls = [];
    const fakePipeline = {
      set: vi.fn((...args: unknown[]) => {
        pipelineCalls.push({ method: 'set', args });
        return fakePipeline;
      }),
      del: vi.fn((...args: unknown[]) => {
        pipelineCalls.push({ method: 'del', args });
        return fakePipeline;
      }),
      exec: vi.fn().mockResolvedValue([]),
    };

    mockRedis = {
      multi: vi.fn(() => fakePipeline),
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn(),
      scan: vi.fn(),
      mget: vi.fn(),
      sadd: vi.fn().mockResolvedValue(1),
      srem: vi.fn().mockResolvedValue(1),
      sismember: vi.fn(),
    };

    persistence = new MultiTagPersistence(mockRedis as unknown as Redis);
  });

  describe('putEntry', () => {
    it('writes entry + source-index + per-slot job-indices via MULTI', async () => {
      const entry = buildEntry();
      await persistence.putEntry(entry);

      expect(mockRedis.multi).toHaveBeenCalledOnce();
      // 1 entry + 1 source-index + 2 slot job-indices = 4 sets, all TTL'd
      expect(pipelineCalls.filter(c => c.method === 'set')).toHaveLength(4);

      const setCalls = pipelineCalls.filter(c => c.method === 'set');
      // Entry key
      expect(setCalls[0].args[0]).toBe(`${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}group-1`);
      // Source-index
      expect(setCalls[1].args[0]).toBe(`${REDIS_KEY_PREFIXES.MULTI_TAG_SOURCE_INDEX}src-msg-1`);
      expect(setCalls[1].args[1]).toBe('group-1');
      // Job-indices
      expect(setCalls[2].args[0]).toBe(`${REDIS_KEY_PREFIXES.MULTI_TAG_JOB_INDEX}job-A`);
      expect(setCalls[3].args[0]).toBe(`${REDIS_KEY_PREFIXES.MULTI_TAG_JOB_INDEX}job-B`);

      // TTL is uniform across all writes
      for (const call of setCalls) {
        expect(call.args[2]).toBe('EX');
        expect(call.args[3]).toBe(MULTI_TAG.REDIS_TTL_SEC);
      }
    });
  });

  describe('updateEntry', () => {
    it('replaces just the entry JSON, refreshing TTL', async () => {
      const entry = buildEntry();
      await persistence.updateEntry(entry);

      expect(mockRedis.set).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}group-1`,
        expect.any(String),
        'EX',
        MULTI_TAG.REDIS_TTL_SEC
      );
      // multi() is not used for partial updates
      expect(mockRedis.multi).not.toHaveBeenCalled();
    });
  });

  describe('deleteEntry', () => {
    it('deletes entry + source-index + per-slot job-indices via MULTI', async () => {
      const entry = buildEntry();
      await persistence.deleteEntry(entry);

      const delCalls = pipelineCalls.filter(c => c.method === 'del');
      expect(delCalls).toHaveLength(4);
      expect(delCalls.map(c => c.args[0])).toEqual([
        `${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}group-1`,
        `${REDIS_KEY_PREFIXES.MULTI_TAG_SOURCE_INDEX}src-msg-1`,
        `${REDIS_KEY_PREFIXES.MULTI_TAG_JOB_INDEX}job-A`,
        `${REDIS_KEY_PREFIXES.MULTI_TAG_JOB_INDEX}job-B`,
      ]);
    });
  });

  describe('scanAllEntries', () => {
    it('walks SCAN cursor and parses all entries', async () => {
      const e1 = buildEntry({ groupId: 'g-1' });
      const e2 = buildEntry({ groupId: 'g-2' });
      mockRedis.scan.mockResolvedValueOnce([
        '0',
        [`${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}g-1`, `${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}g-2`],
      ]);
      mockRedis.mget.mockResolvedValueOnce([JSON.stringify(e1), JSON.stringify(e2)]);

      const result = await persistence.scanAllEntries();

      expect(result).toHaveLength(2);
      expect(result.map(e => e.groupId)).toEqual(['g-1', 'g-2']);
    });

    it('skips malformed JSON without crashing the scan', async () => {
      const valid = buildEntry({ groupId: 'good' });
      mockRedis.scan.mockResolvedValueOnce([
        '0',
        [
          `${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}good`,
          `${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}corrupt`,
        ],
      ]);
      mockRedis.mget.mockResolvedValueOnce([JSON.stringify(valid), 'not-json{']);

      const result = await persistence.scanAllEntries();

      expect(result).toHaveLength(1);
      expect(result[0].groupId).toBe('good');
    });

    it('skips entries missing required fields', async () => {
      mockRedis.scan.mockResolvedValueOnce([
        '0',
        [`${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}empty-slots`],
      ]);
      mockRedis.mget.mockResolvedValueOnce([JSON.stringify({ groupId: 'empty-slots', slots: [] })]);

      const result = await persistence.scanAllEntries();
      expect(result).toHaveLength(0);
    });

    it('returns empty array when no entries exist', async () => {
      mockRedis.scan.mockResolvedValueOnce(['0', []]);
      const result = await persistence.scanAllEntries();
      expect(result).toEqual([]);
    });

    it('walks multiple cursor pages', async () => {
      const e1 = buildEntry({ groupId: 'p1' });
      const e2 = buildEntry({ groupId: 'p2' });
      mockRedis.scan
        .mockResolvedValueOnce(['cursor-2', [`${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}p1`]])
        .mockResolvedValueOnce(['0', [`${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}p2`]]);
      mockRedis.mget
        .mockResolvedValueOnce([JSON.stringify(e1)])
        .mockResolvedValueOnce([JSON.stringify(e2)]);

      const result = await persistence.scanAllEntries();
      expect(result.map(e => e.groupId)).toEqual(['p1', 'p2']);
    });
  });

  describe('stale-jobid set', () => {
    it('SADDs jobIds when markStale is called', async () => {
      await persistence.markStale('job-A', 'job-B');
      expect(mockRedis.sadd).toHaveBeenCalledWith(
        REDIS_KEY_PREFIXES.MULTI_TAG_STALE_JOBS,
        'job-A',
        'job-B'
      );
    });

    it('no-ops when markStale is called with empty list', async () => {
      await persistence.markStale();
      expect(mockRedis.sadd).not.toHaveBeenCalled();
    });

    it('isStale returns true when SISMEMBER returns 1', async () => {
      mockRedis.sismember.mockResolvedValue(1);
      expect(await persistence.isStale('job-A')).toBe(true);
    });

    it('isStale returns false when SISMEMBER returns 0', async () => {
      mockRedis.sismember.mockResolvedValue(0);
      expect(await persistence.isStale('job-A')).toBe(false);
    });

    it('clearStale removes the jobId from the set', async () => {
      await persistence.clearStale('job-A');
      expect(mockRedis.srem).toHaveBeenCalledWith(REDIS_KEY_PREFIXES.MULTI_TAG_STALE_JOBS, 'job-A');
    });
  });

  describe('DM backfill sentinel', () => {
    it('markDMBackfillTried writes a TTL sentinel', async () => {
      await persistence.markDMBackfillTried('dm-channel-1', 3600);
      expect(mockRedis.set).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.MULTI_TAG_DM_BACKFILL_TRIED}dm-channel-1`,
        '1',
        'EX',
        3600
      );
    });

    it('wasDMBackfillTried returns true when the sentinel exists', async () => {
      mockRedis.get.mockResolvedValue('1');
      expect(await persistence.wasDMBackfillTried('dm-channel-1')).toBe(true);
    });

    it('wasDMBackfillTried returns false when the sentinel is missing', async () => {
      mockRedis.get.mockResolvedValue(null);
      expect(await persistence.wasDMBackfillTried('dm-channel-1')).toBe(false);
    });
  });
});
