/**
 * Unit Tests for PgvectorMemoryAdapter - Waterfall Query Logic
 *
 * Tests the queryMemoriesWithChannelScoping method which implements
 * the waterfall LTM retrieval pattern:
 * 1. Query channel-scoped memories first (up to budget ratio)
 * 2. Backfill with global semantic search (excluding already-found IDs)
 * 3. Return combined results
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PgvectorMemoryAdapter,
  type MemoryDocument,
  type MemoryQueryOptions,
} from './PgvectorMemoryAdapter.js';

// Valid Discord snowflake IDs for testing (17-19 digit numeric strings)
const VALID_CHANNEL_ID_1 = '123456789012345678';
const VALID_CHANNEL_ID_2 = '234567890123456789';

// Mock dependencies
vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  MODEL_DEFAULTS: {
    EMBEDDING: 'text-embedding-3-small',
  },
  AI_DEFAULTS: {
    CHANNEL_MEMORY_BUDGET_RATIO: 0.5,
  },
  filterValidDiscordIds: (ids: string[]) => ids.filter(id => /^\d{17,19}$/.test(id)),
}));

vi.mock('../utils/promptPlaceholders.js', () => ({
  replacePromptPlaceholders: (content: string) => content,
}));

describe('PgvectorMemoryAdapter', () => {
  let adapter: PgvectorMemoryAdapter;
  let mockQueryMemories: ReturnType<typeof vi.fn>;
  let mockPrisma: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Prisma client
    mockPrisma = {
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn(),
    };

    // Create adapter instance
    adapter = new PgvectorMemoryAdapter(mockPrisma, 'test-api-key');

    // Spy on queryMemories to control its return values
    mockQueryMemories = vi.fn();
    adapter.queryMemories = mockQueryMemories;
  });

  describe('queryMemoriesWithChannelScoping', () => {
    const baseOptions: MemoryQueryOptions = {
      personaId: 'persona-123',
      personalityId: 'personality-456',
      limit: 10,
    };

    it('should fall back to normal query when no channelIds provided', async () => {
      const mockResults: MemoryDocument[] = [
        { pageContent: 'memory 1', metadata: { id: 'mem-1' } },
        { pageContent: 'memory 2', metadata: { id: 'mem-2' } },
      ];
      mockQueryMemories.mockResolvedValue(mockResults);

      const result = await adapter.queryMemoriesWithChannelScoping('test query', baseOptions);

      expect(result).toEqual(mockResults);
      expect(mockQueryMemories).toHaveBeenCalledTimes(1);
      expect(mockQueryMemories).toHaveBeenCalledWith('test query', baseOptions);
    });

    it('should fall back to normal query when channelIds is empty array', async () => {
      const mockResults: MemoryDocument[] = [
        { pageContent: 'memory 1', metadata: { id: 'mem-1' } },
      ];
      mockQueryMemories.mockResolvedValue(mockResults);

      const options = { ...baseOptions, channelIds: [] };
      const result = await adapter.queryMemoriesWithChannelScoping('test query', options);

      expect(result).toEqual(mockResults);
      expect(mockQueryMemories).toHaveBeenCalledTimes(1);
    });

    it('should perform waterfall query with default 50% budget ratio', async () => {
      // Channel-scoped results (5 memories - 50% of 10)
      const channelResults: MemoryDocument[] = [
        { pageContent: 'channel memory 1', metadata: { id: 'ch-1' } },
        { pageContent: 'channel memory 2', metadata: { id: 'ch-2' } },
        { pageContent: 'channel memory 3', metadata: { id: 'ch-3' } },
      ];
      // Global backfill results (remaining budget: 10 - 3 = 7)
      const globalResults: MemoryDocument[] = [
        { pageContent: 'global memory 1', metadata: { id: 'gl-1' } },
        { pageContent: 'global memory 2', metadata: { id: 'gl-2' } },
      ];

      mockQueryMemories
        .mockResolvedValueOnce(channelResults) // First call: channel-scoped
        .mockResolvedValueOnce(globalResults); // Second call: global backfill

      const options = {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1, VALID_CHANNEL_ID_2],
      };
      const result = await adapter.queryMemoriesWithChannelScoping('test query', options);

      // Should combine results with channel-scoped first
      expect(result).toHaveLength(5);
      expect(result).toEqual([...channelResults, ...globalResults]);

      // Verify both queries were made
      expect(mockQueryMemories).toHaveBeenCalledTimes(2);

      // First call: channel-scoped with 50% limit (floor(10 * 0.5) = 5)
      expect(mockQueryMemories).toHaveBeenNthCalledWith(1, 'test query', {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1, VALID_CHANNEL_ID_2],
        limit: 5, // 50% of 10
      });

      // Second call: global backfill with remaining budget and exclusions
      expect(mockQueryMemories).toHaveBeenNthCalledWith(2, 'test query', {
        ...baseOptions,
        channelIds: undefined, // No channel filter for global
        limit: 7, // 10 - 3 channel results = 7
        excludeIds: ['ch-1', 'ch-2', 'ch-3'],
      });
    });

    it('should respect custom channelBudgetRatio', async () => {
      const channelResults: MemoryDocument[] = [
        { pageContent: 'channel memory', metadata: { id: 'ch-1' } },
      ];
      const globalResults: MemoryDocument[] = [
        { pageContent: 'global memory', metadata: { id: 'gl-1' } },
      ];

      mockQueryMemories.mockResolvedValueOnce(channelResults).mockResolvedValueOnce(globalResults);

      const options = {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1],
        channelBudgetRatio: 0.3, // 30% for channel-scoped
      };
      const result = await adapter.queryMemoriesWithChannelScoping('test query', options);

      expect(result).toHaveLength(2);

      // First call: 30% of 10 = 3
      expect(mockQueryMemories).toHaveBeenNthCalledWith(1, 'test query', {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1],
        channelBudgetRatio: 0.3,
        limit: 3, // floor(10 * 0.3) = 3
      });

      // Second call: remaining budget 10 - 1 = 9
      expect(mockQueryMemories).toHaveBeenNthCalledWith(2, 'test query', {
        ...baseOptions,
        channelIds: undefined,
        channelBudgetRatio: 0.3,
        limit: 9,
        excludeIds: ['ch-1'],
      });
    });

    it('should skip global backfill when channel results fill the budget', async () => {
      // Channel-scoped returns exactly the full limit worth
      const channelResults: MemoryDocument[] = Array.from({ length: 10 }, (_, i) => ({
        pageContent: `channel memory ${i}`,
        metadata: { id: `ch-${i}` },
      }));

      mockQueryMemories.mockResolvedValueOnce(channelResults);

      const options = {
        ...baseOptions,
        limit: 10,
        channelIds: [VALID_CHANNEL_ID_1],
        channelBudgetRatio: 1.0, // 100% for channel-scoped
      };
      const result = await adapter.queryMemoriesWithChannelScoping('test query', options);

      expect(result).toHaveLength(10);
      expect(result).toEqual(channelResults);

      // Should only call once - no global backfill needed
      expect(mockQueryMemories).toHaveBeenCalledTimes(1);
    });

    it('should handle empty channel results and only return global results', async () => {
      const globalResults: MemoryDocument[] = [
        { pageContent: 'global memory 1', metadata: { id: 'gl-1' } },
        { pageContent: 'global memory 2', metadata: { id: 'gl-2' } },
      ];

      mockQueryMemories
        .mockResolvedValueOnce([]) // No channel-scoped results
        .mockResolvedValueOnce(globalResults);

      const options = {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1],
      };
      const result = await adapter.queryMemoriesWithChannelScoping('test query', options);

      expect(result).toHaveLength(2);
      expect(result).toEqual(globalResults);

      // Second call should have full budget since no channel results
      expect(mockQueryMemories).toHaveBeenNthCalledWith(2, 'test query', {
        ...baseOptions,
        channelIds: undefined,
        limit: 10, // Full budget available
        excludeIds: undefined, // No IDs to exclude
      });
    });

    it('should handle memories without IDs in metadata', async () => {
      const channelResults: MemoryDocument[] = [
        { pageContent: 'channel memory 1', metadata: { score: 0.9 } }, // No id
        { pageContent: 'channel memory 2', metadata: { id: 'ch-2' } },
        { pageContent: 'channel memory 3' }, // No metadata at all
      ];
      const globalResults: MemoryDocument[] = [
        { pageContent: 'global memory', metadata: { id: 'gl-1' } },
      ];

      mockQueryMemories.mockResolvedValueOnce(channelResults).mockResolvedValueOnce(globalResults);

      const options = {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1],
      };
      const result = await adapter.queryMemoriesWithChannelScoping('test query', options);

      expect(result).toHaveLength(4);

      // Should only exclude the one ID that exists
      expect(mockQueryMemories).toHaveBeenNthCalledWith(2, 'test query', {
        ...baseOptions,
        channelIds: undefined,
        limit: 7,
        excludeIds: ['ch-2'], // Only the valid ID
      });
    });

    it('should use default limit of 10 when not specified', async () => {
      const channelResults: MemoryDocument[] = [];
      const globalResults: MemoryDocument[] = [];

      mockQueryMemories.mockResolvedValueOnce(channelResults).mockResolvedValueOnce(globalResults);

      const options = {
        personaId: 'persona-123',
        channelIds: [VALID_CHANNEL_ID_1],
        // No limit specified
      };
      await adapter.queryMemoriesWithChannelScoping('test query', options);

      // Should use default limit of 10
      expect(mockQueryMemories).toHaveBeenNthCalledWith(1, 'test query', {
        personaId: 'persona-123',
        channelIds: [VALID_CHANNEL_ID_1],
        limit: 5, // 50% of default 10
      });
    });

    it('should preserve other query options in both calls', async () => {
      mockQueryMemories.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const options: MemoryQueryOptions = {
        personaId: 'persona-123',
        personalityId: 'personality-456',
        sessionId: 'session-789',
        scoreThreshold: 0.7,
        excludeNewerThan: 1700000000000,
        channelIds: [VALID_CHANNEL_ID_1],
        limit: 20,
      };
      await adapter.queryMemoriesWithChannelScoping('test query', options);

      // Both calls should preserve the other options
      expect(mockQueryMemories).toHaveBeenNthCalledWith(1, 'test query', {
        ...options,
        limit: 10, // 50% of 20
      });

      expect(mockQueryMemories).toHaveBeenNthCalledWith(2, 'test query', {
        ...options,
        channelIds: undefined,
        limit: 20, // Full remaining budget
        excludeIds: undefined,
      });
    });

    it('should preserve scoreThreshold in both channel and global queries', async () => {
      mockQueryMemories.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const options = {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1],
        scoreThreshold: 0.85,
      };
      await adapter.queryMemoriesWithChannelScoping('test query', options);

      // Verify both calls received scoreThreshold
      expect(mockQueryMemories).toHaveBeenNthCalledWith(
        1,
        'test query',
        expect.objectContaining({ scoreThreshold: 0.85 })
      );
      expect(mockQueryMemories).toHaveBeenNthCalledWith(
        2,
        'test query',
        expect.objectContaining({ scoreThreshold: 0.85 })
      );
    });

    it('should ensure minimum channel budget of 1 even with small limit', async () => {
      // Edge case: totalLimit=1, ratio=0.5 → should still get channelBudget=1, not 0
      const channelResults: MemoryDocument[] = [
        { pageContent: 'channel memory', metadata: { id: 'ch-1' } },
      ];

      mockQueryMemories.mockResolvedValueOnce(channelResults);

      const options = {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1],
        limit: 1,
        channelBudgetRatio: 0.5, // Would normally give 0 with floor()
      };
      const result = await adapter.queryMemoriesWithChannelScoping('test query', options);

      // Should get the channel result even though 50% of 1 = 0.5 → floors to 0
      expect(result).toHaveLength(1);
      expect(result).toEqual(channelResults);

      // Channel-scoped query should have limit: 1 (not 0)
      expect(mockQueryMemories).toHaveBeenNthCalledWith(1, 'test query', {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1],
        limit: 1, // Math.max(1, floor(1 * 0.5)) = Math.max(1, 0) = 1
        channelBudgetRatio: 0.5,
      });

      // No global backfill since channel filled the entire budget
      expect(mockQueryMemories).toHaveBeenCalledTimes(1);
    });
  });
});
