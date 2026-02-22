/**
 * Tests for Memory Search Handler
 *
 * Tests handleSearch and the private validateDateFilters helper (via mirrored copy).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { PrismaClient } from '@tzurot/common-types';
import type { AuthenticatedRequest } from '../../types.js';

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

// Mock memory helpers
vi.mock('./memoryHelpers.js', () => ({
  getUserByDiscordId: vi.fn(),
  getDefaultPersonaId: vi.fn(),
}));

// Mock embedding service
vi.mock('../../services/EmbeddingService.js', () => ({
  isEmbeddingServiceAvailable: vi.fn(),
  generateEmbedding: vi.fn(),
  formatAsVector: vi.fn(),
}));

import { handleSearch } from './memorySearch.js';
import { getUserByDiscordId, getDefaultPersonaId } from './memoryHelpers.js';
import {
  isEmbeddingServiceAvailable,
  generateEmbedding,
  formatAsVector,
} from '../../services/EmbeddingService.js';

const mockGetUserByDiscordId = vi.mocked(getUserByDiscordId);
const mockGetDefaultPersonaId = vi.mocked(getDefaultPersonaId);
const mockIsEmbeddingAvailable = vi.mocked(isEmbeddingServiceAvailable);
const mockGenerateEmbedding = vi.mocked(generateEmbedding);
const mockFormatAsVector = vi.mocked(formatAsVector);

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_PERSONA_ID = '00000000-0000-0000-0000-000000000002';
const TEST_PERSONALITY_ID = '00000000-0000-0000-0000-000000000003';
const TEST_DISCORD_USER_ID = 'discord-user-123';

const mockPrisma = {
  $queryRaw: vi.fn(),
} as unknown as PrismaClient;

function createMockReq(body: Record<string, unknown> = {}): AuthenticatedRequest {
  return {
    userId: TEST_DISCORD_USER_ID,
    body,
  } as unknown as AuthenticatedRequest;
}

function createMockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('memorySearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEmbeddingAvailable.mockReturnValue(true);
  });

  describe('handleSearch', () => {
    it('should return 503 when embedding service is unavailable', async () => {
      mockIsEmbeddingAvailable.mockReturnValue(false);
      const res = createMockRes();

      await handleSearch(mockPrisma, createMockReq({ query: 'test' }), res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'SERVICE_UNAVAILABLE' })
      );
    });

    it('should return validation error for missing query', async () => {
      const res = createMockRes();

      await handleSearch(mockPrisma, createMockReq({}), res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when user not found', async () => {
      mockGetUserByDiscordId.mockResolvedValue(null);
      const res = createMockRes();

      await handleSearch(mockPrisma, createMockReq({ query: 'test' }), res);

      expect(mockGetUserByDiscordId).toHaveBeenCalledWith(mockPrisma, TEST_DISCORD_USER_ID, res);
    });

    it('should return empty results when user has no default persona', async () => {
      mockGetUserByDiscordId.mockResolvedValue({ id: TEST_USER_ID });
      mockGetDefaultPersonaId.mockResolvedValue(null);
      const res = createMockRes();

      await handleSearch(mockPrisma, createMockReq({ query: 'test' }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ results: [], count: 0, hasMore: false })
      );
    });

    it('should return validation error for invalid date filters', async () => {
      mockGetUserByDiscordId.mockResolvedValue({ id: TEST_USER_ID });
      mockGetDefaultPersonaId.mockResolvedValue(TEST_PERSONA_ID);
      const res = createMockRes();

      await handleSearch(mockPrisma, createMockReq({ query: 'test', dateFrom: 'not-a-date' }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should perform text search when preferTextSearch is true', async () => {
      mockGetUserByDiscordId.mockResolvedValue({ id: TEST_USER_ID });
      mockGetDefaultPersonaId.mockResolvedValue(TEST_PERSONA_ID);
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'mem-1',
          content: 'test memory',
          created_at: new Date('2026-01-01'),
          updated_at: new Date('2026-01-01'),
          personality_name: 'Test Bot',
          personality_id: TEST_PERSONALITY_ID,
          is_locked: false,
        },
      ]);
      const res = createMockRes();

      await handleSearch(mockPrisma, createMockReq({ query: 'test', preferTextSearch: true }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          searchType: 'text',
          count: 1,
          results: expect.arrayContaining([
            expect.objectContaining({ id: 'mem-1', content: 'test memory', similarity: null }),
          ]),
        })
      );
      expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    });

    it('should perform semantic search and fall back to text on empty results', async () => {
      mockGetUserByDiscordId.mockResolvedValue({ id: TEST_USER_ID });
      mockGetDefaultPersonaId.mockResolvedValue(TEST_PERSONA_ID);
      mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
      mockFormatAsVector.mockReturnValue('[0.1,0.2,0.3]');
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]) // Semantic search returns empty
        .mockResolvedValueOnce([
          {
            id: 'mem-2',
            content: 'fallback result',
            created_at: new Date('2026-01-01'),
            updated_at: new Date('2026-01-01'),
            personality_name: 'Test Bot',
            personality_id: TEST_PERSONALITY_ID,
            is_locked: false,
          },
        ]); // Text fallback returns results
      const res = createMockRes();

      await handleSearch(mockPrisma, createMockReq({ query: 'test' }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ searchType: 'text', count: 1 })
      );
    });

    it('should return error when embedding generation fails', async () => {
      mockGetUserByDiscordId.mockResolvedValue({ id: TEST_USER_ID });
      mockGetDefaultPersonaId.mockResolvedValue(TEST_PERSONA_ID);
      mockGenerateEmbedding.mockRejectedValue(new Error('embedding error'));
      const res = createMockRes();

      await handleSearch(mockPrisma, createMockReq({ query: 'test' }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should return error when embedding returns null', async () => {
      mockGetUserByDiscordId.mockResolvedValue({ id: TEST_USER_ID });
      mockGetDefaultPersonaId.mockResolvedValue(TEST_PERSONA_ID);
      mockGenerateEmbedding.mockResolvedValue(null);
      const res = createMockRes();

      await handleSearch(mockPrisma, createMockReq({ query: 'test' }), res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('should return semantic results with similarity scores', async () => {
      mockGetUserByDiscordId.mockResolvedValue({ id: TEST_USER_ID });
      mockGetDefaultPersonaId.mockResolvedValue(TEST_PERSONA_ID);
      mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
      mockFormatAsVector.mockReturnValue('[0.1,0.2,0.3]');
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'mem-3',
          content: 'semantic hit',
          distance: 0.15,
          created_at: new Date('2026-01-01'),
          updated_at: new Date('2026-01-01'),
          personality_name: 'Test Bot',
          personality_id: TEST_PERSONALITY_ID,
          is_locked: true,
        },
      ]);
      const res = createMockRes();

      await handleSearch(mockPrisma, createMockReq({ query: 'test' }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          searchType: 'semantic',
          results: expect.arrayContaining([
            expect.objectContaining({
              id: 'mem-3',
              similarity: 0.85,
              isLocked: true,
            }),
          ]),
        })
      );
    });

    it('should set hasMore when results exceed limit', async () => {
      mockGetUserByDiscordId.mockResolvedValue({ id: TEST_USER_ID });
      mockGetDefaultPersonaId.mockResolvedValue(TEST_PERSONA_ID);
      // Generate limit + 1 results to trigger hasMore
      const results = Array.from({ length: 11 }, (_, i) => ({
        id: `mem-${i}`,
        content: `memory ${i}`,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
        personality_name: 'Test Bot',
        personality_id: TEST_PERSONALITY_ID,
        is_locked: false,
      }));
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue(results);
      const res = createMockRes();

      await handleSearch(mockPrisma, createMockReq({ query: 'test', preferTextSearch: true }), res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hasMore: true, count: 10 }));
    });
  });

  // Mirror-based tests for the private validateDateFilters helper
  describe('validateDateFilters (mirrored)', () => {
    // Mirror the validateDateFilters logic for testing
    // (it's a private helper in the module)
    function validateDateFilters(
      dateFrom: string | undefined,
      dateTo: string | undefined
    ): { dateFrom?: string; dateTo?: string } | { error: string } {
      const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

      const isValidDate = (str: string): boolean => {
        if (!ISO_DATE_REGEX.test(str)) {
          return false;
        }
        const date = new Date(str);
        if (Number.isNaN(date.getTime())) {
          return false;
        }
        const year = date.getUTCFullYear();
        return year >= 1900 && year <= 2200;
      };

      const hasValue = (str: string | undefined): str is string =>
        str !== undefined && str.length > 0;

      if (hasValue(dateFrom) && !isValidDate(dateFrom)) {
        return {
          error: 'dateFrom must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
        };
      }
      if (hasValue(dateTo) && !isValidDate(dateTo)) {
        return {
          error: 'dateTo must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
        };
      }

      return {
        dateFrom: hasValue(dateFrom) ? dateFrom : undefined,
        dateTo: hasValue(dateTo) ? dateTo : undefined,
      };
    }

    it('returns undefined for both when inputs are undefined', () => {
      const result = validateDateFilters(undefined, undefined);
      expect(result).toEqual({ dateFrom: undefined, dateTo: undefined });
    });

    it('returns undefined for empty strings', () => {
      const result = validateDateFilters('', '');
      expect(result).toEqual({ dateFrom: undefined, dateTo: undefined });
    });

    it('accepts valid ISO 8601 dates', () => {
      const result = validateDateFilters('2024-01-15', '2024-02-15');
      expect(result).toEqual({ dateFrom: '2024-01-15', dateTo: '2024-02-15' });
    });

    it('accepts valid ISO 8601 datetime', () => {
      const result = validateDateFilters('2024-01-15T10:30:00Z', undefined);
      expect(result).toEqual({ dateFrom: '2024-01-15T10:30:00Z', dateTo: undefined });
    });

    it('accepts valid ISO 8601 datetime with timezone offset', () => {
      const result = validateDateFilters(undefined, '2024-01-15T10:30:00+05:00');
      expect(result).toEqual({ dateFrom: undefined, dateTo: '2024-01-15T10:30:00+05:00' });
    });

    it('returns error for invalid dateFrom', () => {
      const result = validateDateFilters('not-a-date', '2024-01-15');
      expect(result).toEqual({
        error: 'dateFrom must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      });
    });

    it('returns error for invalid dateTo', () => {
      const result = validateDateFilters('2024-01-15', 'not-a-date');
      expect(result).toEqual({
        error: 'dateTo must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      });
    });

    it('returns error for malformed dateFrom', () => {
      const result = validateDateFilters('2024-13-45', undefined);
      expect(result).toEqual({
        error: 'dateFrom must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      });
    });

    it('returns error for SQL injection attempts', () => {
      const result = validateDateFilters("'; DROP TABLE memories; --", undefined);
      expect(result).toEqual({
        error: 'dateFrom must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      });
    });

    it('rejects partial dates (requires full YYYY-MM-DD)', () => {
      const result = validateDateFilters('2024-01', undefined);
      expect(result).toEqual({
        error: 'dateFrom must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      });
    });

    it('rejects dates with years outside PostgreSQL-safe range', () => {
      const pastResult = validateDateFilters('1800-01-01', undefined);
      expect(pastResult).toEqual({
        error: 'dateFrom must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      });

      const futureResult = validateDateFilters('2300-01-01', undefined);
      expect(futureResult).toEqual({
        error: 'dateFrom must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      });
    });

    it('accepts dates within reasonable year range', () => {
      const result = validateDateFilters('1900-01-01', '2200-12-31');
      expect(result).toEqual({ dateFrom: '1900-01-01', dateTo: '2200-12-31' });
    });
  });
});
