import { describe, it, expect } from 'vitest';
import {
  DbSyncResponseSchema,
  AdminCleanupResponseSchema,
  InvalidateCacheResponseSchema,
} from './admin-operations.js';

describe('DbSyncResponseSchema', () => {
  it('accepts the minimal success shape', () => {
    expect(
      DbSyncResponseSchema.safeParse({ success: true, timestamp: '2026-05-23T12:00:00Z' }).success
    ).toBe(true);
  });

  it('accepts arbitrary extra fields (passthrough)', () => {
    const withExtras = {
      success: true,
      timestamp: '2026-05-23T12:00:00Z',
      tablesCreated: 3,
      indexesCreated: 5,
      arbitraryFutureField: { nested: 'stuff' },
    };
    const parsed = DbSyncResponseSchema.safeParse(withExtras);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Extras survive parsing (passthrough)
      expect(parsed.data).toMatchObject({ tablesCreated: 3, indexesCreated: 5 });
    }
  });

  it('rejects success: false (literal true required)', () => {
    expect(
      DbSyncResponseSchema.safeParse({ success: false, timestamp: '2026-05-23T12:00:00Z' }).success
    ).toBe(false);
  });
});

describe('AdminCleanupResponseSchema', () => {
  it('accepts the minimal cleanup ack', () => {
    expect(
      AdminCleanupResponseSchema.safeParse({
        success: true,
        message: 'Cleaned 5 history rows',
      }).success
    ).toBe(true);
  });

  it('accepts extra counters via passthrough', () => {
    expect(
      AdminCleanupResponseSchema.safeParse({
        success: true,
        message: 'Cleaned',
        historyDeleted: 10,
        tombstonesDeleted: 2,
        daysToKeep: 30,
      }).success
    ).toBe(true);
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
