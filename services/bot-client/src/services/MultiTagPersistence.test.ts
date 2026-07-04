/**
 * Tests for MultiTagPersistence — Redis adapter for coordinator state.
 *
 * Uses a hand-rolled Redis mock that records calls. We're not testing
 * Redis itself — just verifying that the persistence layer wires the
 * right commands to the right keys with the right TTL.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { MULTI_TAG } from '@tzurot/common-types/constants/message';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { MultiTagPersistence, type CoordinatorEntrySnapshot } from './MultiTagPersistence.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
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
    truncated: false,
    ...overrides,
  };
}

describe('MultiTagPersistence', () => {
  let pipelineCalls: Array<{ method: string; args: unknown[] }>;
  let mockRedis: {
    multi: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
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
      sadd: vi.fn((...args: unknown[]) => {
        pipelineCalls.push({ method: 'sadd', args });
        return fakePipeline;
      }),
      expire: vi.fn((...args: unknown[]) => {
        pipelineCalls.push({ method: 'expire', args });
        return fakePipeline;
      }),
      exec: vi.fn().mockResolvedValue([]),
    };

    mockRedis = {
      multi: vi.fn(() => fakePipeline),
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn(),
      del: vi.fn().mockResolvedValue(1),
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
    it('replaces entry JSON, slides source-index TTL, sets job-index entries idempotently', async () => {
      const entry = buildEntry();
      await persistence.updateEntry(entry);

      expect(mockRedis.multi).toHaveBeenCalledOnce();
      // SET for the entry key + one SET per slot's job-index. Using SET
      // (not EXPIRE) so recovery's new jobIds create their job-index
      // entries fresh — EXPIRE is a no-op on missing keys.
      const setCalls = pipelineCalls.filter(c => c.method === 'set');
      expect(setCalls).toHaveLength(3); // 1 entry + 2 slot job-indexes
      expect(setCalls[0].args[0]).toBe(`${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}group-1`);
      expect(setCalls[0].args[2]).toBe('EX');
      expect(setCalls[0].args[3]).toBe(MULTI_TAG.REDIS_TTL_SEC);
      expect(setCalls[1].args[0]).toBe(`${REDIS_KEY_PREFIXES.MULTI_TAG_JOB_INDEX}job-A`);
      expect(setCalls[1].args[1]).toBe('group-1');
      expect(setCalls[2].args[0]).toBe(`${REDIS_KEY_PREFIXES.MULTI_TAG_JOB_INDEX}job-B`);
      expect(setCalls[2].args[1]).toBe('group-1');
      // EXPIRE only for the source-index (its key was always created by putEntry
      // and never changes mid-flight, so refreshing TTL is sufficient).
      const expireCalls = pipelineCalls.filter(c => c.method === 'expire');
      expect(expireCalls).toHaveLength(1);
      expect(expireCalls[0].args[0]).toBe(`${REDIS_KEY_PREFIXES.MULTI_TAG_SOURCE_INDEX}src-msg-1`);
      expect(expireCalls[0].args[1]).toBe(MULTI_TAG.REDIS_TTL_SEC);
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
    it('SADDs jobIds and slides the SET TTL via MULTI when markStale is called', async () => {
      await persistence.markStale('job-A', 'job-B');
      const saddCalls = pipelineCalls.filter(c => c.method === 'sadd');
      const expireCalls = pipelineCalls.filter(c => c.method === 'expire');
      expect(saddCalls).toHaveLength(1);
      expect(saddCalls[0].args).toEqual([
        REDIS_KEY_PREFIXES.MULTI_TAG_STALE_JOBS,
        'job-A',
        'job-B',
      ]);
      // EXPIRE on the SET key — sliding TTL so orphan entries (results that
      // never arrive) eventually fall out instead of accumulating forever.
      expect(expireCalls).toHaveLength(1);
      expect(expireCalls[0].args[0]).toBe(REDIS_KEY_PREFIXES.MULTI_TAG_STALE_JOBS);
      expect(typeof expireCalls[0].args[1]).toBe('number');
      expect(expireCalls[0].args[1]).toBeGreaterThan(0);
    });

    it('no-ops when markStale is called with empty list', async () => {
      await persistence.markStale();
      // No MULTI pipeline opened at all — both sadd and expire skipped.
      expect(pipelineCalls.filter(c => c.method === 'sadd')).toHaveLength(0);
      expect(pipelineCalls.filter(c => c.method === 'expire')).toHaveLength(0);
    });

    it('isStale returns true when SISMEMBER returns 1', async () => {
      mockRedis.sismember.mockResolvedValue(1);
      expect(await persistence.isStale('job-A')).toBe(true);
    });

    it('isStale returns false when SISMEMBER returns 0', async () => {
      mockRedis.sismember.mockResolvedValue(0);
      expect(await persistence.isStale('job-A')).toBe(false);
    });

    it('isStale fails open (returns false) on Redis error', async () => {
      // A Redis hiccup must NOT swallow the user's response — fail-open
      // here means a duplicate delivery in pathological restart-then-blip
      // races is preferred over silently dropping every result.
      mockRedis.sismember.mockRejectedValue(new Error('Redis connection lost'));
      expect(await persistence.isStale('job-A')).toBe(false);
    });

    it('clearStale removes the jobId from the set', async () => {
      await persistence.clearStale('job-A');
      expect(mockRedis.srem).toHaveBeenCalledWith(REDIS_KEY_PREFIXES.MULTI_TAG_STALE_JOBS, 'job-A');
    });
  });

  describe('DM backfill sentinel', () => {
    it('markDMBackfillTried writes a TTL sentinel using the default TTL', async () => {
      // Production calls markDMBackfillTried(channelId) with no second arg;
      // exercise that path so the test validates the actual default rather
      // than a value the caller passes.
      await persistence.markDMBackfillTried('dm-channel-1');
      expect(mockRedis.set).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.MULTI_TAG_DM_BACKFILL_TRIED}dm-channel-1`,
        '1',
        'EX',
        expect.any(Number)
      );
      const setCall = mockRedis.set.mock.calls[0];
      expect(setCall[3]).toBeGreaterThan(0);
    });

    it('markDMBackfillTried honors an explicit TTL override', async () => {
      await persistence.markDMBackfillTried('dm-channel-1', 120);
      expect(mockRedis.set).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.MULTI_TAG_DM_BACKFILL_TRIED}dm-channel-1`,
        '1',
        'EX',
        120
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

    it('wasDMBackfillTried fails open (returns false) on Redis error', async () => {
      // Same reasoning as isStale: a Redis blip must NOT throw out of the
      // DM processor chain and swallow the user's message.
      mockRedis.get.mockRejectedValue(new Error('Redis connection lost'));
      expect(await persistence.wasDMBackfillTried('dm-channel-1')).toBe(false);
    });
  });

  describe('slot-delivered marker (recovery idempotency)', () => {
    it('markSlotDelivered writes a TTL marker keyed by jobId', async () => {
      await persistence.markSlotDelivered('job-abc');
      expect(mockRedis.set).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.MULTI_TAG_SLOT_DELIVERED}job-abc`,
        '1',
        'EX',
        expect.any(Number)
      );
      const setCall = mockRedis.set.mock.calls[0];
      expect(setCall[3]).toBeGreaterThan(0);
    });

    it('markSlotDelivered soft-fails on Redis error', async () => {
      // A failed marker write means a subsequent recovery may re-dispatch
      // and produce a duplicate message — exactly the failure mode the
      // marker is designed to prevent. We log it but don't throw, because
      // throwing would propagate up and break the delivery flow's per-slot
      // try/catch contract.
      mockRedis.set.mockRejectedValue(new Error('Redis down'));
      await expect(persistence.markSlotDelivered('job-abc')).resolves.toBeUndefined();
    });

    it('isSlotDelivered returns true when the marker exists', async () => {
      mockRedis.get.mockResolvedValue('1');
      expect(await persistence.isSlotDelivered('job-abc')).toBe(true);
    });

    it('isSlotDelivered returns false when the marker is missing', async () => {
      mockRedis.get.mockResolvedValue(null);
      expect(await persistence.isSlotDelivered('job-abc')).toBe(false);
    });

    it('isSlotDelivered fails closed (returns false) on Redis error', async () => {
      // Fail-closed is the safer side here: a false negative produces at-worst
      // a duplicate message; a false positive permanently drops the user's
      // message. Duplicate is the better failure mode.
      mockRedis.get.mockRejectedValue(new Error('Redis down'));
      expect(await persistence.isSlotDelivered('job-abc')).toBe(false);
    });
  });

  describe('synthetic-timeout recovery marker', () => {
    const ctx = {
      channelId: 'chan-1',
      guildId: 'guild-1',
      clientId: 'bot-1',
      personalitySlug: 'lila',
      recipientUserId: 'user-1',
      isAutoResponse: false,
    };

    it('markSyntheticTimeout writes the JSON context with a TTL', async () => {
      await persistence.markSyntheticTimeout('job-1', ctx);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'multitag:synthetic-timeout:job-1',
        JSON.stringify(ctx),
        'EX',
        expect.any(Number)
      );
    });

    it('getSyntheticTimeout round-trips the context', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(ctx));
      expect(await persistence.getSyntheticTimeout('job-1')).toEqual(ctx);
    });

    it('getSyntheticTimeout returns null when no marker exists', async () => {
      mockRedis.get.mockResolvedValue(null);
      expect(await persistence.getSyntheticTimeout('job-1')).toBeNull();
    });

    it('getSyntheticTimeout fails soft (null) on malformed JSON', async () => {
      mockRedis.get.mockResolvedValue('not-json{');
      expect(await persistence.getSyntheticTimeout('job-1')).toBeNull();
    });

    it('clearSyntheticTimeout deletes the marker key', async () => {
      await persistence.clearSyntheticTimeout('job-1');
      expect(mockRedis.del).toHaveBeenCalledWith('multitag:synthetic-timeout:job-1');
    });

    it('markSyntheticTimeout fails soft on Redis error (no throw)', async () => {
      mockRedis.set.mockRejectedValue(new Error('Redis down'));
      await expect(persistence.markSyntheticTimeout('job-1', ctx)).resolves.toBeUndefined();
    });
  });
});
