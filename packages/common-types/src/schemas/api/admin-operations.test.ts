import { describe, it, expect } from 'vitest';
import {
  DbSyncResponseSchema,
  AdminCleanupResponseSchema,
  InvalidateCacheResponseSchema,
} from './admin-operations.js';

describe('DbSyncResponseSchema', () => {
  const validResponse = {
    success: true,
    timestamp: '2026-05-23T12:00:00Z',
    schemaVersion: '20260523120000',
    stats: { users: { devToProd: 2, prodToDev: 0, conflicts: 1, deleted: 0 } },
    warnings: ['table foo skipped'],
    info: ['table bar excluded by config'],
  };

  it('accepts the full enumerated sync result', () => {
    expect(DbSyncResponseSchema.safeParse(validResponse).success).toBe(true);
  });

  it('accepts an optional dry-run changes preview', () => {
    const withChanges = { ...validResponse, changes: { users: { willInsert: 2 } } };
    expect(DbSyncResponseSchema.safeParse(withChanges).success).toBe(true);
  });

  it('rejects the old minimal shape (stats/warnings/info now required)', () => {
    // The schema is tightened: the gateway always spreads the full SyncResult,
    // so the bare { success, timestamp } shape is no longer a valid contract.
    expect(
      DbSyncResponseSchema.safeParse({ success: true, timestamp: '2026-05-23T12:00:00Z' }).success
    ).toBe(false);
  });

  it('deleted survives the parse (strip-mode pin — the embed renders it)', () => {
    const parsed = DbSyncResponseSchema.safeParse({
      ...validResponse,
      stats: { llm_configs: { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 3 } },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.stats.llm_configs.deleted).toBe(3);
    }
  });

  it('an old-gateway response WITHOUT deleted still parses (deploy-window default)', () => {
    const parsed = DbSyncResponseSchema.safeParse({
      ...validResponse,
      stats: { users: { devToProd: 2, prodToDev: 0, conflicts: 1 } },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.stats.users.deleted).toBe(0);
    }
  });

  it('rejects malformed stats entries', () => {
    const badStats = { ...validResponse, stats: { users: { devToProd: 'two' } } };
    expect(DbSyncResponseSchema.safeParse(badStats).success).toBe(false);
  });

  it('rejects success: false (literal true required)', () => {
    expect(DbSyncResponseSchema.safeParse({ ...validResponse, success: false }).success).toBe(
      false
    );
  });
});

describe('AdminCleanupResponseSchema', () => {
  it('accepts the full cleanup ack with all required counter fields', () => {
    expect(
      AdminCleanupResponseSchema.safeParse({
        success: true,
        message: 'Cleaned 10 history rows and 2 tombstones',
        historyDeleted: 10,
        tombstonesDeleted: 2,
        daysKept: 30,
        timestamp: '2026-01-01T00:00:00.000Z',
      }).success
    ).toBe(true);
  });

  it('rejects payloads missing the counter fields (load-bearing for bot-client embed)', () => {
    expect(
      AdminCleanupResponseSchema.safeParse({
        success: true,
        message: 'Cleaned 5 history rows',
      }).success
    ).toBe(false);
  });
});

describe('InvalidateCacheResponseSchema', () => {
  it('accepts the bot-wide invalidation shape (no personalityId)', () => {
    expect(
      InvalidateCacheResponseSchema.safeParse({
        success: true,
        invalidated: 'all',
        message: 'All personality caches invalidated across all services',
      }).success
    ).toBe(true);
  });

  it('accepts the single-personality invalidation shape', () => {
    expect(
      InvalidateCacheResponseSchema.safeParse({
        success: true,
        invalidated: 'caches',
        message: 'Invalidated 3 caches',
        personalityId: 'personality-uuid',
      }).success
    ).toBe(true);
  });

  it('rejects missing invalidated field', () => {
    expect(
      InvalidateCacheResponseSchema.safeParse({
        success: true,
        message: 'something happened',
      }).success
    ).toBe(false);
  });
});
