/**
 * Memory API Input Schema Tests
 *
 * Validates schemas for memory endpoint request bodies.
 */

import { describe, it, expect } from 'vitest';
import {
  PreviewTokenSchema,
  PurgeTokenSchema,
  SetMemoryLockSchema,
  MemoryUpdateSchema,
  BatchDeletePreviewSchema,
  BatchDeleteSchema,
  IssuePurgeTokenSchema,
  PurgeMemoriesSchema,
  MemorySearchSchema,
  MemoryItemSchema,
  MemoryStatsResponseSchema,
  MemoryListResponseSchema,
  MemorySearchResultSchema,
  MemorySearchResponseSchema,
  BatchDeletePreviewResponseSchema,
  BatchDeleteResponseSchema,
  IssuePurgeTokenResponseSchema,
  PurgeMemoriesResponseSchema,
  SingleMemoryResponseSchema,
  DeleteMemoryResponseSchema,
} from './memory.js';

describe('Memory API Input Schema Tests', () => {
  describe('SetMemoryLockSchema', () => {
    it('accepts locked: true', () => {
      const result = SetMemoryLockSchema.safeParse({ locked: true });
      expect(result.success).toBe(true);
    });

    it('accepts locked: false', () => {
      const result = SetMemoryLockSchema.safeParse({ locked: false });
      expect(result.success).toBe(true);
    });

    it('rejects missing locked', () => {
      const result = SetMemoryLockSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects non-boolean locked', () => {
      const result = SetMemoryLockSchema.safeParse({ locked: 'true' });
      expect(result.success).toBe(false);
    });
  });

  describe('MemoryUpdateSchema', () => {
    it('should accept valid content', () => {
      const result = MemoryUpdateSchema.safeParse({ content: 'Updated memory' });
      expect(result.success).toBe(true);
    });

    it('should trim whitespace', () => {
      const result = MemoryUpdateSchema.safeParse({ content: '  hello  ' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe('hello');
      }
    });

    it('should reject empty content', () => {
      const result = MemoryUpdateSchema.safeParse({ content: '' });
      expect(result.success).toBe(false);
    });

    it('should reject whitespace-only content', () => {
      const result = MemoryUpdateSchema.safeParse({ content: '   ' });
      expect(result.success).toBe(false);
    });

    it('should reject missing content', () => {
      const result = MemoryUpdateSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject content over 2000 characters', () => {
      const result = MemoryUpdateSchema.safeParse({ content: 'a'.repeat(2001) });
      expect(result.success).toBe(false);
    });

    it('should accept content at exactly 2000 characters', () => {
      const result = MemoryUpdateSchema.safeParse({ content: 'a'.repeat(2000) });
      expect(result.success).toBe(true);
    });
  });

  describe('BatchDeletePreviewSchema', () => {
    it('accepts minimal input (personalityId only)', () => {
      const result = BatchDeletePreviewSchema.safeParse({ personalityId: 'abc-123' });
      expect(result.success).toBe(true);
    });

    it('accepts full input with timeframe and personaId', () => {
      const result = BatchDeletePreviewSchema.safeParse({
        personalityId: 'abc-123',
        personaId: 'persona-1',
        timeframe: '7d',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty personalityId', () => {
      const result = BatchDeletePreviewSchema.safeParse({ personalityId: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing personalityId', () => {
      const result = BatchDeletePreviewSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('BatchDeleteSchema', () => {
    it('accepts a valid preview_-prefixed token', () => {
      const result = BatchDeleteSchema.safeParse({
        previewToken: 'preview_test0000test0000',
      });
      expect(result.success).toBe(true);
    });

    it('rejects a purge_-prefixed token (wrong brand)', () => {
      const result = BatchDeleteSchema.safeParse({
        previewToken: 'purge_test0000test0000',
      });
      expect(result.success).toBe(false);
    });

    it("rejects an arbitrary string that doesn't match the token regex", () => {
      const result = BatchDeleteSchema.safeParse({ previewToken: 'not-a-token' });
      expect(result.success).toBe(false);
    });

    it('rejects missing previewToken', () => {
      const result = BatchDeleteSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('IssuePurgeTokenSchema', () => {
    it('accepts personalityId + confirmation phrase', () => {
      const result = IssuePurgeTokenSchema.safeParse({
        personalityId: 'abc-123',
        confirmationPhrase: 'DELETE LILITH MEMORIES',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty personalityId', () => {
      const result = IssuePurgeTokenSchema.safeParse({
        personalityId: '',
        confirmationPhrase: 'X',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing confirmationPhrase', () => {
      const result = IssuePurgeTokenSchema.safeParse({ personalityId: 'abc-123' });
      expect(result.success).toBe(false);
    });

    it('rejects empty confirmationPhrase', () => {
      const result = IssuePurgeTokenSchema.safeParse({
        personalityId: 'abc-123',
        confirmationPhrase: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('PurgeMemoriesSchema', () => {
    it('accepts a valid purge_-prefixed token', () => {
      const result = PurgeMemoriesSchema.safeParse({
        purgeToken: 'purge_test0000test0000',
      });
      expect(result.success).toBe(true);
    });

    it('rejects a preview_-prefixed token (wrong brand)', () => {
      const result = PurgeMemoriesSchema.safeParse({
        purgeToken: 'preview_test0000test0000',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing purgeToken', () => {
      const result = PurgeMemoriesSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('MemorySearchSchema', () => {
    it('should accept minimal input', () => {
      const result = MemorySearchSchema.safeParse({ query: 'search term' });
      expect(result.success).toBe(true);
    });

    it('should accept full input', () => {
      const result = MemorySearchSchema.safeParse({
        query: 'search term',
        personalityId: 'abc-123',
        limit: 20,
        offset: 10,
        // ISO-8601 datetime with offset (schema requires .datetime({ offset: true }))
        dateFrom: '2025-01-01T00:00:00.000Z',
        dateTo: '2025-12-31T23:59:59.999Z',
        preferTextSearch: true,
      });
      expect(result.success).toBe(true);
    });

    it('should reject bare-date strings (schema requires ISO-8601 datetime)', () => {
      const result = MemorySearchSchema.safeParse({
        query: 'search term',
        dateFrom: '2025-01-01', // bare date — no time component
      });
      expect(result.success).toBe(false);
    });

    it('should reject offset-less datetime strings (offset is required)', () => {
      const result = MemorySearchSchema.safeParse({
        query: 'search term',
        dateFrom: '2025-01-01T00:00:00', // no Z, no ±HH:MM
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty query', () => {
      const result = MemorySearchSchema.safeParse({ query: '' });
      expect(result.success).toBe(false);
    });

    it('should reject missing query', () => {
      const result = MemorySearchSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject query over 500 characters', () => {
      const result = MemorySearchSchema.safeParse({ query: 'a'.repeat(501) });
      expect(result.success).toBe(false);
    });

    it('should accept query at exactly 500 characters', () => {
      const result = MemorySearchSchema.safeParse({ query: 'a'.repeat(500) });
      expect(result.success).toBe(true);
    });

    it('should reject limit > 50', () => {
      const result = MemorySearchSchema.safeParse({ query: 'test', limit: 51 });
      expect(result.success).toBe(false);
    });

    it('should reject limit < 1', () => {
      const result = MemorySearchSchema.safeParse({ query: 'test', limit: 0 });
      expect(result.success).toBe(false);
    });

    it('should reject negative offset', () => {
      const result = MemorySearchSchema.safeParse({ query: 'test', offset: -1 });
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // Response schemas (audit-ratchet coverage; the route-handler tests cover
  // the round-trip shapes — these tests just confirm the schemas parse
  // representative payloads and reject obvious shape errors).
  // ==========================================================================

  describe('MemoryItemSchema', () => {
    const sample = {
      id: 'mem-1',
      content: 'hello',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      personalityId: 'p1',
      personalityName: 'Test',
      isLocked: false,
    };

    it('accepts a complete memory item', () => {
      expect(MemoryItemSchema.safeParse(sample).success).toBe(true);
    });

    it('rejects missing required fields', () => {
      const { isLocked: _isLocked, ...partial } = sample;
      expect(MemoryItemSchema.safeParse(partial).success).toBe(false);
    });

    it('rejects non-boolean isLocked', () => {
      expect(MemoryItemSchema.safeParse({ ...sample, isLocked: 'yes' }).success).toBe(false);
    });
  });

  describe('MemoryStatsResponseSchema', () => {
    it('accepts a valid stats response', () => {
      const result = MemoryStatsResponseSchema.safeParse({
        personalityId: 'p1',
        personalityName: 'Test',
        personaId: 'persona-1',
        totalCount: 10,
        lockedCount: 2,
        oldestMemory: '2025-01-01T00:00:00Z',
        newestMemory: '2026-01-01T00:00:00Z',
        freshModeEnabled: false,
      });
      expect(result.success).toBe(true);
    });

    it('accepts null personaId / oldestMemory / newestMemory', () => {
      const result = MemoryStatsResponseSchema.safeParse({
        personalityId: 'p1',
        personalityName: 'Test',
        personaId: null,
        totalCount: 0,
        lockedCount: 0,
        oldestMemory: null,
        newestMemory: null,
        freshModeEnabled: false,
      });
      expect(result.success).toBe(true);
    });

    it('rejects non-number totalCount', () => {
      const result = MemoryStatsResponseSchema.safeParse({
        personalityId: 'p1',
        personalityName: 'Test',
        personaId: null,
        totalCount: '10',
        lockedCount: 0,
        oldestMemory: null,
        newestMemory: null,
        freshModeEnabled: false,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('MemoryListResponseSchema', () => {
    it('accepts an empty list', () => {
      const result = MemoryListResponseSchema.safeParse({
        memories: [],
        total: 0,
        limit: 15,
        offset: 0,
        hasMore: false,
      });
      expect(result.success).toBe(true);
    });

    it('rejects a memories array with malformed items', () => {
      const result = MemoryListResponseSchema.safeParse({
        memories: [{ id: 'x' }], // missing required fields
        total: 1,
        limit: 15,
        offset: 0,
        hasMore: false,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('MemorySearchResultSchema', () => {
    it('accepts a result with similarity', () => {
      const result = MemorySearchResultSchema.safeParse({
        id: 'mem-1',
        content: 'hello',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        personalityId: 'p1',
        personalityName: 'Test',
        isLocked: false,
        similarity: 0.85,
      });
      expect(result.success).toBe(true);
    });

    it('accepts null similarity (text search fallback)', () => {
      const result = MemorySearchResultSchema.safeParse({
        id: 'mem-1',
        content: 'hello',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        personalityId: 'p1',
        personalityName: 'Test',
        isLocked: false,
        similarity: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('MemorySearchResponseSchema', () => {
    it('accepts a response without searchType', () => {
      const result = MemorySearchResponseSchema.safeParse({
        results: [],
        count: 0,
        hasMore: false,
      });
      expect(result.success).toBe(true);
    });

    it('accepts a response with searchType=text', () => {
      const result = MemorySearchResponseSchema.safeParse({
        results: [],
        count: 0,
        hasMore: false,
        searchType: 'text',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid searchType', () => {
      const result = MemorySearchResponseSchema.safeParse({
        results: [],
        count: 0,
        hasMore: false,
        searchType: 'fuzzy',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('BatchDeletePreviewResponseSchema', () => {
    it('accepts a valid preview response', () => {
      const result = BatchDeletePreviewResponseSchema.safeParse({
        wouldDelete: 5,
        lockedWouldSkip: 1,
        personalityId: 'p1',
        personalityName: 'Test',
        timeframe: 'all',
        previewToken: 'preview_test0000test0000',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing previewToken', () => {
      const result = BatchDeletePreviewResponseSchema.safeParse({
        wouldDelete: 5,
        lockedWouldSkip: 1,
        personalityId: 'p1',
        personalityName: 'Test',
        timeframe: 'all',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('BatchDeleteResponseSchema', () => {
    it('accepts a response with personality fields', () => {
      const result = BatchDeleteResponseSchema.safeParse({
        deletedCount: 5,
        skippedLocked: 1,
        personalityId: 'p1',
        personalityName: 'Test',
        message: 'Deleted 5 memories.',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a zero-count response without personality fields', () => {
      const result = BatchDeleteResponseSchema.safeParse({
        deletedCount: 0,
        skippedLocked: 0,
        message: 'No memories found matching the criteria',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('IssuePurgeTokenResponseSchema', () => {
    it('accepts a valid token-issue response', () => {
      const result = IssuePurgeTokenResponseSchema.safeParse({
        purgeToken: 'purge_test0000test0000',
        personalityId: 'p1',
        personalityName: 'Test',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('PurgeMemoriesResponseSchema', () => {
    it('accepts a valid purge response', () => {
      const result = PurgeMemoriesResponseSchema.safeParse({
        deletedCount: 10,
        lockedPreserved: 2,
        personalityId: 'p1',
        personalityName: 'Test',
        message: 'Purged 10 memories.',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('SingleMemoryResponseSchema', () => {
    it('accepts a valid envelope', () => {
      const result = SingleMemoryResponseSchema.safeParse({
        memory: {
          id: 'mem-1',
          content: 'hello',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          personalityId: 'p1',
          personalityName: 'Test',
          isLocked: false,
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing memory key', () => {
      expect(SingleMemoryResponseSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('DeleteMemoryResponseSchema', () => {
    it('accepts { success: true }', () => {
      expect(DeleteMemoryResponseSchema.safeParse({ success: true }).success).toBe(true);
    });

    it('rejects { success: "true" }', () => {
      expect(DeleteMemoryResponseSchema.safeParse({ success: 'true' }).success).toBe(false);
    });
  });

  describe('PreviewTokenSchema', () => {
    it('accepts a properly-formatted token', () => {
      expect(PreviewTokenSchema.safeParse('preview_test0000test0000test0000').success).toBe(true);
    });

    it('rejects an arbitrary string', () => {
      expect(PreviewTokenSchema.safeParse('not-a-token').success).toBe(false);
      expect(PreviewTokenSchema.safeParse('').success).toBe(false);
    });

    it('rejects a string lacking the preview_ prefix', () => {
      expect(PreviewTokenSchema.safeParse('purge_test0000test0000test0000').success).toBe(false);
    });

    it('rejects a token that is too short (no payload)', () => {
      expect(PreviewTokenSchema.safeParse('preview_x').success).toBe(false);
    });
  });

  describe('PurgeTokenSchema', () => {
    it('accepts a properly-formatted token', () => {
      expect(PurgeTokenSchema.safeParse('purge_test0000test0000test0000').success).toBe(true);
    });

    it('rejects a preview-prefixed token (distinct brand)', () => {
      expect(PurgeTokenSchema.safeParse('preview_test0000test0000test0000').success).toBe(false);
    });

    it('rejects unbranded raw strings', () => {
      expect(PurgeTokenSchema.safeParse('test0000test0000test0000').success).toBe(false);
    });
  });
});
