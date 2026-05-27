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
