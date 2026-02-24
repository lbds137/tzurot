/**
 * Unit Tests for PgvectorChannelScoping
 *
 * Tests the waterfall query pattern: channel-scoped first, then global backfill.
 * Uses a mock queryFn instead of constructing full adapter instances.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waterfallMemoryQuery, type QueryMemoriesFn } from './PgvectorChannelScoping.js';
import type { MemoryDocument, MemoryQueryOptions } from './PgvectorTypes.js';

// Valid Discord snowflake IDs for testing (17-19 digit numeric strings)
const VALID_CHANNEL_ID_1 = '123456789012345678';
const VALID_CHANNEL_ID_2 = '234567890123456789';

vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  AI_DEFAULTS: {
    CHANNEL_MEMORY_BUDGET_RATIO: 0.5,
  },
  filterValidDiscordIds: (ids: string[]) => ids.filter(id => /^\d{17,19}$/.test(id)),
}));

describe('waterfallMemoryQuery', () => {
  let mockQueryFn: QueryMemoriesFn & ReturnType<typeof vi.fn>;

  const baseOptions: MemoryQueryOptions = {
    personaId: 'persona-123',
    personalityId: 'personality-456',
    limit: 10,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryFn = vi.fn<QueryMemoriesFn>().mockResolvedValue([]);
  });

  it('should fall back to normal query when no channelIds provided', async () => {
    const mockResults: MemoryDocument[] = [
      { pageContent: 'memory 1', metadata: { id: 'mem-1' } },
      { pageContent: 'memory 2', metadata: { id: 'mem-2' } },
    ];
    mockQueryFn.mockResolvedValue(mockResults);

    const result = await waterfallMemoryQuery(mockQueryFn, 'test query', baseOptions);

    expect(result).toEqual(mockResults);
    expect(mockQueryFn).toHaveBeenCalledTimes(1);
    expect(mockQueryFn).toHaveBeenCalledWith('test query', baseOptions);
  });

  it('should fall back to normal query when channelIds is empty array', async () => {
    const mockResults: MemoryDocument[] = [{ pageContent: 'memory 1', metadata: { id: 'mem-1' } }];
    mockQueryFn.mockResolvedValue(mockResults);

    const options = { ...baseOptions, channelIds: [] };
    const result = await waterfallMemoryQuery(mockQueryFn, 'test query', options);

    expect(result).toEqual(mockResults);
    expect(mockQueryFn).toHaveBeenCalledTimes(1);
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

    mockQueryFn
      .mockResolvedValueOnce(channelResults) // First call: channel-scoped
      .mockResolvedValueOnce(globalResults); // Second call: global backfill

    const options = {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1, VALID_CHANNEL_ID_2],
    };
    const result = await waterfallMemoryQuery(mockQueryFn, 'test query', options);

    // Should combine results with channel-scoped first
    expect(result).toHaveLength(5);
    expect(result).toEqual([...channelResults, ...globalResults]);

    // Verify both queries were made
    expect(mockQueryFn).toHaveBeenCalledTimes(2);

    // First call: channel-scoped with 50% limit (floor(10 * 0.5) = 5)
    expect(mockQueryFn).toHaveBeenNthCalledWith(1, 'test query', {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1, VALID_CHANNEL_ID_2],
      limit: 5, // 50% of 10
    });

    // Second call: global backfill with remaining budget and exclusions
    expect(mockQueryFn).toHaveBeenNthCalledWith(2, 'test query', {
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

    mockQueryFn.mockResolvedValueOnce(channelResults).mockResolvedValueOnce(globalResults);

    const options = {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1],
      channelBudgetRatio: 0.3, // 30% for channel-scoped
    };
    const result = await waterfallMemoryQuery(mockQueryFn, 'test query', options);

    expect(result).toHaveLength(2);

    // First call: 30% of 10 = 3
    expect(mockQueryFn).toHaveBeenNthCalledWith(1, 'test query', {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1],
      channelBudgetRatio: 0.3,
      limit: 3, // floor(10 * 0.3) = 3
    });

    // Second call: remaining budget 10 - 1 = 9
    expect(mockQueryFn).toHaveBeenNthCalledWith(2, 'test query', {
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

    mockQueryFn.mockResolvedValueOnce(channelResults);

    const options = {
      ...baseOptions,
      limit: 10,
      channelIds: [VALID_CHANNEL_ID_1],
      channelBudgetRatio: 1.0, // 100% for channel-scoped
    };
    const result = await waterfallMemoryQuery(mockQueryFn, 'test query', options);

    expect(result).toHaveLength(10);
    expect(result).toEqual(channelResults);

    // Should only call once - no global backfill needed
    expect(mockQueryFn).toHaveBeenCalledTimes(1);
  });

  it('should handle empty channel results and only return global results', async () => {
    const globalResults: MemoryDocument[] = [
      { pageContent: 'global memory 1', metadata: { id: 'gl-1' } },
      { pageContent: 'global memory 2', metadata: { id: 'gl-2' } },
    ];

    mockQueryFn
      .mockResolvedValueOnce([]) // No channel-scoped results
      .mockResolvedValueOnce(globalResults);

    const options = {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1],
    };
    const result = await waterfallMemoryQuery(mockQueryFn, 'test query', options);

    expect(result).toHaveLength(2);
    expect(result).toEqual(globalResults);

    // Second call should have full budget since no channel results
    expect(mockQueryFn).toHaveBeenNthCalledWith(2, 'test query', {
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

    mockQueryFn.mockResolvedValueOnce(channelResults).mockResolvedValueOnce(globalResults);

    const options = {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1],
    };
    const result = await waterfallMemoryQuery(mockQueryFn, 'test query', options);

    expect(result).toHaveLength(4);

    // Should only exclude the one ID that exists
    expect(mockQueryFn).toHaveBeenNthCalledWith(2, 'test query', {
      ...baseOptions,
      channelIds: undefined,
      limit: 7,
      excludeIds: ['ch-2'], // Only the valid ID
    });
  });

  it('should use default limit of 10 when not specified', async () => {
    const channelResults: MemoryDocument[] = [];
    const globalResults: MemoryDocument[] = [];

    mockQueryFn.mockResolvedValueOnce(channelResults).mockResolvedValueOnce(globalResults);

    const options = {
      personaId: 'persona-123',
      channelIds: [VALID_CHANNEL_ID_1],
      // No limit specified
    };
    await waterfallMemoryQuery(mockQueryFn, 'test query', options);

    // Should use default limit of 10
    expect(mockQueryFn).toHaveBeenNthCalledWith(1, 'test query', {
      personaId: 'persona-123',
      channelIds: [VALID_CHANNEL_ID_1],
      limit: 5, // 50% of default 10
    });
  });

  it('should preserve other query options in both calls', async () => {
    mockQueryFn.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const options: MemoryQueryOptions = {
      personaId: 'persona-123',
      personalityId: 'personality-456',
      sessionId: 'session-789',
      scoreThreshold: 0.7,
      excludeNewerThan: 1700000000000,
      channelIds: [VALID_CHANNEL_ID_1],
      limit: 20,
    };
    await waterfallMemoryQuery(mockQueryFn, 'test query', options);

    // Both calls should preserve the other options
    expect(mockQueryFn).toHaveBeenNthCalledWith(1, 'test query', {
      ...options,
      limit: 10, // 50% of 20
    });

    expect(mockQueryFn).toHaveBeenNthCalledWith(2, 'test query', {
      ...options,
      channelIds: undefined,
      limit: 20, // Full remaining budget
      excludeIds: undefined,
    });
  });

  it('should preserve scoreThreshold in both channel and global queries', async () => {
    mockQueryFn.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const options = {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1],
      scoreThreshold: 0.85,
    };
    await waterfallMemoryQuery(mockQueryFn, 'test query', options);

    // Verify both calls received scoreThreshold
    expect(mockQueryFn).toHaveBeenNthCalledWith(
      1,
      'test query',
      expect.objectContaining({ scoreThreshold: 0.85 })
    );
    expect(mockQueryFn).toHaveBeenNthCalledWith(
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

    mockQueryFn.mockResolvedValueOnce(channelResults);

    const options = {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1],
      limit: 1,
      channelBudgetRatio: 0.5, // Would normally give 0 with floor()
    };
    const result = await waterfallMemoryQuery(mockQueryFn, 'test query', options);

    // Should get the channel result even though 50% of 1 = 0.5 → floors to 0
    expect(result).toHaveLength(1);
    expect(result).toEqual(channelResults);

    // Channel-scoped query should have limit: 1 (not 0)
    expect(mockQueryFn).toHaveBeenNthCalledWith(1, 'test query', {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1],
      limit: 1, // Math.max(1, floor(1 * 0.5)) = Math.max(1, 0) = 1
      channelBudgetRatio: 0.5,
    });

    // No global backfill since channel filled the entire budget
    expect(mockQueryFn).toHaveBeenCalledTimes(1);
  });

  it('should clamp channelBudgetRatio to 0-1 range for invalid values', async () => {
    mockQueryFn.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    // Test with ratio > 1 (should clamp to 1.0)
    const options = {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1],
      limit: 10,
      channelBudgetRatio: 1.5, // Invalid: > 1
    };
    await waterfallMemoryQuery(mockQueryFn, 'test query', options);

    // With clamped ratio of 1.0, channel budget should be 10 (100% of limit)
    expect(mockQueryFn).toHaveBeenNthCalledWith(1, 'test query', {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1],
      limit: 10, // Math.max(1, floor(10 * 1.0)) = 10
      channelBudgetRatio: 1.5, // Original value passed through
    });
  });

  it('should clamp negative channelBudgetRatio to 0', async () => {
    mockQueryFn.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const options = {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1],
      limit: 10,
      channelBudgetRatio: -0.5, // Invalid: negative
    };
    await waterfallMemoryQuery(mockQueryFn, 'test query', options);

    // With clamped ratio of 0, Math.max(1, floor(0)) = 1 (minimum budget)
    expect(mockQueryFn).toHaveBeenNthCalledWith(1, 'test query', {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1],
      limit: 1, // Minimum budget enforced
      channelBudgetRatio: -0.5,
    });
  });

  it('should return channel results even when global query fails', async () => {
    const channelResults: MemoryDocument[] = [
      { pageContent: 'channel memory 1', metadata: { id: 'ch-1' } },
      { pageContent: 'channel memory 2', metadata: { id: 'ch-2' } },
    ];

    mockQueryFn
      .mockResolvedValueOnce(channelResults) // Channel query succeeds
      .mockRejectedValueOnce(new Error('Global query failed')); // Global query fails

    const options = {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1],
    };
    const result = await waterfallMemoryQuery(mockQueryFn, 'test query', options);

    // Should return channel results despite global failure
    expect(result).toHaveLength(2);
    expect(result).toEqual(channelResults);
    expect(mockQueryFn).toHaveBeenCalledTimes(2);
  });

  it('should filter invalid channel IDs and proceed with valid ones in waterfall', async () => {
    const channelResults: MemoryDocument[] = [
      { pageContent: 'channel memory', metadata: { id: 'ch-1' } },
    ];
    const globalResults: MemoryDocument[] = [
      { pageContent: 'global memory', metadata: { id: 'gl-1' } },
    ];

    mockQueryFn.mockResolvedValueOnce(channelResults).mockResolvedValueOnce(globalResults);

    const options = {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1, 'invalid-id', '123'], // Mix of valid and invalid
    };
    const result = await waterfallMemoryQuery(mockQueryFn, 'test query', options);

    expect(result).toHaveLength(2);

    // Should only include valid channel ID in the query
    expect(mockQueryFn).toHaveBeenNthCalledWith(1, 'test query', {
      ...baseOptions,
      channelIds: [VALID_CHANNEL_ID_1], // Only valid ID
      limit: 5,
    });
  });

  describe('null value handling', () => {
    it('should handle channel results with null ids when building excludeIds', async () => {
      // Channel results include documents with null/undefined ids
      const channelResults: MemoryDocument[] = [
        { pageContent: 'memory 1', metadata: { id: null as unknown as string } }, // null id
        { pageContent: 'memory 2', metadata: { id: 'ch-2' } }, // valid id
        { pageContent: 'memory 3', metadata: { id: undefined as unknown as string } }, // undefined
        { pageContent: 'memory 4' }, // no metadata
      ];
      const globalResults: MemoryDocument[] = [
        { pageContent: 'global memory', metadata: { id: 'gl-1' } },
      ];

      mockQueryFn.mockResolvedValueOnce(channelResults).mockResolvedValueOnce(globalResults);

      const options = {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1],
      };

      // Should not throw when building excludeIds with null values
      const result = await waterfallMemoryQuery(mockQueryFn, 'test query', options);

      expect(result).toHaveLength(5);

      // Verify excludeIds only contains valid string id
      expect(mockQueryFn).toHaveBeenNthCalledWith(2, 'test query', {
        ...baseOptions,
        channelIds: undefined,
        limit: 6, // 10 - 4 channel results
        excludeIds: ['ch-2'], // Only the valid non-null id
      });
    });
  });
});
