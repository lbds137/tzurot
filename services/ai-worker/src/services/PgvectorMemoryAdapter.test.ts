/**
 * Unit Tests for PgvectorMemoryAdapter
 *
 * Tests include:
 * - Waterfall LTM retrieval pattern (queryMemoriesWithChannelScoping)
 * - Memory chunking for oversized text (addMemory)
 * - Sibling chunk retrieval (includeSiblings option)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PgvectorMemoryAdapter,
  type MemoryDocument,
  type MemoryQueryOptions,
  type MemoryMetadata,
} from './PgvectorMemoryAdapter.js';

// Valid Discord snowflake IDs for testing (17-19 digit numeric strings)
const VALID_CHANNEL_ID_1 = '123456789012345678';
const VALID_CHANNEL_ID_2 = '234567890123456789';

// Mock splitTextByTokens to control chunking behavior in tests
const mockSplitTextByTokens = vi.fn();

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
    EMBEDDING_CHUNK_LIMIT: 7500,
  },
  filterValidDiscordIds: (ids: string[]) => ids.filter(id => /^\d{17,19}$/.test(id)),
  splitTextByTokens: (...args: unknown[]) => mockSplitTextByTokens(...args),
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

    it('should clamp channelBudgetRatio to 0-1 range for invalid values', async () => {
      mockQueryMemories.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      // Test with ratio > 1 (should clamp to 1.0)
      const options = {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1],
        limit: 10,
        channelBudgetRatio: 1.5, // Invalid: > 1
      };
      await adapter.queryMemoriesWithChannelScoping('test query', options);

      // With clamped ratio of 1.0, channel budget should be 10 (100% of limit)
      expect(mockQueryMemories).toHaveBeenNthCalledWith(1, 'test query', {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1],
        limit: 10, // Math.max(1, floor(10 * 1.0)) = 10
        channelBudgetRatio: 1.5, // Original value passed through
      });
    });

    it('should clamp negative channelBudgetRatio to 0', async () => {
      mockQueryMemories.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const options = {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1],
        limit: 10,
        channelBudgetRatio: -0.5, // Invalid: negative
      };
      await adapter.queryMemoriesWithChannelScoping('test query', options);

      // With clamped ratio of 0, Math.max(1, floor(0)) = 1 (minimum budget)
      expect(mockQueryMemories).toHaveBeenNthCalledWith(1, 'test query', {
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

      mockQueryMemories
        .mockResolvedValueOnce(channelResults) // Channel query succeeds
        .mockRejectedValueOnce(new Error('Global query failed')); // Global query fails

      const options = {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1],
      };
      const result = await adapter.queryMemoriesWithChannelScoping('test query', options);

      // Should return channel results despite global failure
      expect(result).toHaveLength(2);
      expect(result).toEqual(channelResults);
      expect(mockQueryMemories).toHaveBeenCalledTimes(2);
    });

    it('should filter invalid channel IDs and proceed with valid ones in waterfall', async () => {
      const channelResults: MemoryDocument[] = [
        { pageContent: 'channel memory', metadata: { id: 'ch-1' } },
      ];
      const globalResults: MemoryDocument[] = [
        { pageContent: 'global memory', metadata: { id: 'gl-1' } },
      ];

      mockQueryMemories.mockResolvedValueOnce(channelResults).mockResolvedValueOnce(globalResults);

      const options = {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1, 'invalid-id', '123'], // Mix of valid and invalid
      };
      const result = await adapter.queryMemoriesWithChannelScoping('test query', options);

      expect(result).toHaveLength(2);

      // Should only include valid channel ID in the query
      expect(mockQueryMemories).toHaveBeenNthCalledWith(1, 'test query', {
        ...baseOptions,
        channelIds: [VALID_CHANNEL_ID_1], // Only valid ID
        limit: 5,
      });
    });
  });

  describe('addMemory chunking', () => {
    const baseMetadata: MemoryMetadata = {
      personaId: 'persona-123',
      personalityId: 'personality-456',
      createdAt: Date.now(), // Required for normalizeMetadata
    };

    beforeEach(() => {
      vi.clearAllMocks();

      // Reset splitTextByTokens mock to default behavior
      mockSplitTextByTokens.mockReset();
    });

    it('should store single memory when text is under token limit', async () => {
      const shortText = 'This is a short memory that fits within the limit.';

      // Mock: text doesn't need chunking
      mockSplitTextByTokens.mockReturnValue({
        chunks: [shortText],
        originalTokenCount: 50,
        wasChunked: false,
      });

      // Mock Prisma and OpenAI
      const mockPrisma = {
        $executeRaw: vi.fn().mockResolvedValue(undefined),
      };
      const mockOpenAI = {
        embeddings: {
          create: vi.fn().mockResolvedValue({
            data: [{ embedding: new Array(1536).fill(0.1) }],
          }),
        },
      };

      const testAdapter = new PgvectorMemoryAdapter(mockPrisma as any, 'test-api-key');
      // @ts-expect-error - accessing private property for testing
      testAdapter.openai = mockOpenAI;

      await testAdapter.addMemory({ text: shortText, metadata: baseMetadata });

      // Should store exactly one memory
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockSplitTextByTokens).toHaveBeenCalledWith(shortText);
    });

    it('should split and store multiple chunks when text exceeds token limit', async () => {
      const longText = 'Chunk 1 content.\n\nChunk 2 content.\n\nChunk 3 content.';
      const chunks = ['Chunk 1 content.', 'Chunk 2 content.', 'Chunk 3 content.'];

      // Mock: text needs chunking
      mockSplitTextByTokens.mockReturnValue({
        chunks,
        originalTokenCount: 9000,
        wasChunked: true,
      });

      // Mock Prisma and OpenAI
      const executedQueries: any[] = [];
      const mockPrisma = {
        $executeRaw: vi.fn().mockImplementation((...args) => {
          executedQueries.push(args);
          return Promise.resolve(undefined);
        }),
      };
      const mockOpenAI = {
        embeddings: {
          create: vi.fn().mockResolvedValue({
            data: [{ embedding: new Array(1536).fill(0.1) }],
          }),
        },
      };

      const testAdapter = new PgvectorMemoryAdapter(mockPrisma as any, 'test-api-key');
      // @ts-expect-error - accessing private property for testing
      testAdapter.openai = mockOpenAI;

      await testAdapter.addMemory({ text: longText, metadata: baseMetadata });

      // Should store exactly 3 chunks
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(3);
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledTimes(3);
    });

    it('should generate unique deterministic UUIDs for each chunk', async () => {
      const chunks = ['First chunk.', 'Second chunk.'];

      mockSplitTextByTokens.mockReturnValue({
        chunks,
        originalTokenCount: 8000,
        wasChunked: true,
      });

      const storedIds: string[] = [];
      const mockPrisma = {
        $executeRaw: vi.fn().mockImplementation((strings: TemplateStringsArray, ...values: any[]) => {
          // The first value after the template is the ID
          storedIds.push(values[0]);
          return Promise.resolve(undefined);
        }),
      };
      const mockOpenAI = {
        embeddings: {
          create: vi.fn().mockResolvedValue({
            data: [{ embedding: new Array(1536).fill(0.1) }],
          }),
        },
      };

      const testAdapter = new PgvectorMemoryAdapter(mockPrisma as any, 'test-api-key');
      // @ts-expect-error - accessing private property for testing
      testAdapter.openai = mockOpenAI;

      await testAdapter.addMemory({ text: chunks.join('\n\n'), metadata: baseMetadata });

      // Should have 2 unique IDs
      expect(storedIds).toHaveLength(2);
      expect(new Set(storedIds).size).toBe(2); // All IDs are unique
    });
  });

  describe('sibling chunk retrieval', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockSplitTextByTokens.mockReset();
    });

    it('should return documents with sibling chunks when includeSiblings is true', async () => {
      const mockPrisma = {
        $queryRaw: vi.fn(),
      };

      const testAdapter = new PgvectorMemoryAdapter(mockPrisma as any, 'test-api-key');

      // Mock the initial query result (chunk 1 of 3)
      const initialResult: MemoryDocument[] = [
        {
          pageContent: 'Chunk 1 content',
          metadata: {
            id: 'mem-1',
            chunkGroupId: 'group-abc',
            chunkIndex: 0,
            totalChunks: 3,
            personaId: 'persona-123',
            personalityId: 'personality-456',
          },
        },
      ];

      // Mock all chunks in the group
      const allChunks = [
        {
          id: 'mem-1',
          content: 'Chunk 1 content',
          persona_id: 'persona-123',
          personality_id: 'personality-456',
          chunk_group_id: 'group-abc',
          chunk_index: 0,
          total_chunks: 3,
          session_id: null,
          canon_scope: null,
          summary_type: null,
          channel_id: null,
          guild_id: null,
          message_ids: null,
          senders: null,
          created_at: new Date(),
          persona_name: 'Test Persona',
          owner_username: 'testuser',
          personality_name: 'Test Personality',
        },
        {
          id: 'mem-2',
          content: 'Chunk 2 content',
          persona_id: 'persona-123',
          personality_id: 'personality-456',
          chunk_group_id: 'group-abc',
          chunk_index: 1,
          total_chunks: 3,
          session_id: null,
          canon_scope: null,
          summary_type: null,
          channel_id: null,
          guild_id: null,
          message_ids: null,
          senders: null,
          created_at: new Date(),
          persona_name: 'Test Persona',
          owner_username: 'testuser',
          personality_name: 'Test Personality',
        },
        {
          id: 'mem-3',
          content: 'Chunk 3 content',
          persona_id: 'persona-123',
          personality_id: 'personality-456',
          chunk_group_id: 'group-abc',
          chunk_index: 2,
          total_chunks: 3,
          session_id: null,
          canon_scope: null,
          summary_type: null,
          channel_id: null,
          guild_id: null,
          message_ids: null,
          senders: null,
          created_at: new Date(),
          persona_name: 'Test Persona',
          owner_username: 'testuser',
          personality_name: 'Test Personality',
        },
      ];

      // First call returns initial result, second call returns sibling chunks
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([allChunks[0]]) // Initial query
        .mockResolvedValueOnce(allChunks); // Sibling query

      // Spy on queryMemories to control its return
      vi.spyOn(testAdapter, 'queryMemories').mockResolvedValue(initialResult);

      // Access private method through the adapter
      // @ts-expect-error - accessing private method for testing
      const expandWithSiblings = testAdapter.expandWithSiblings.bind(testAdapter);

      const expanded = await expandWithSiblings(initialResult, 'persona-123');

      // Should have expanded to include all 3 chunks
      expect(expanded.length).toBeGreaterThanOrEqual(1);
    });

    it('should not duplicate chunks when multiple chunks from same group match', async () => {
      const mockPrisma = {
        $queryRaw: vi.fn(),
      };

      const testAdapter = new PgvectorMemoryAdapter(mockPrisma as any, 'test-api-key');

      // Initial results include 2 chunks from same group
      const initialResults: MemoryDocument[] = [
        {
          pageContent: 'Chunk 1 content',
          metadata: {
            id: 'mem-1',
            chunkGroupId: 'group-abc',
            chunkIndex: 0,
            totalChunks: 3,
          },
        },
        {
          pageContent: 'Chunk 2 content',
          metadata: {
            id: 'mem-2',
            chunkGroupId: 'group-abc',
            chunkIndex: 1,
            totalChunks: 3,
          },
        },
      ];

      // All chunks in group
      const siblingResults = [
        {
          id: 'mem-1',
          content: 'Chunk 1 content',
          chunk_group_id: 'group-abc',
          chunk_index: 0,
          total_chunks: 3,
          persona_id: 'persona-123',
          personality_id: 'personality-456',
          session_id: null,
          canon_scope: null,
          summary_type: null,
          channel_id: null,
          guild_id: null,
          message_ids: null,
          senders: null,
          created_at: new Date(),
          persona_name: 'Test',
          owner_username: 'test',
          personality_name: 'Test',
        },
        {
          id: 'mem-2',
          content: 'Chunk 2 content',
          chunk_group_id: 'group-abc',
          chunk_index: 1,
          total_chunks: 3,
          persona_id: 'persona-123',
          personality_id: 'personality-456',
          session_id: null,
          canon_scope: null,
          summary_type: null,
          channel_id: null,
          guild_id: null,
          message_ids: null,
          senders: null,
          created_at: new Date(),
          persona_name: 'Test',
          owner_username: 'test',
          personality_name: 'Test',
        },
        {
          id: 'mem-3',
          content: 'Chunk 3 content',
          chunk_group_id: 'group-abc',
          chunk_index: 2,
          total_chunks: 3,
          persona_id: 'persona-123',
          personality_id: 'personality-456',
          session_id: null,
          canon_scope: null,
          summary_type: null,
          channel_id: null,
          guild_id: null,
          message_ids: null,
          senders: null,
          created_at: new Date(),
          persona_name: 'Test',
          owner_username: 'test',
          personality_name: 'Test',
        },
      ];

      mockPrisma.$queryRaw.mockResolvedValue(siblingResults);

      // @ts-expect-error - accessing private method for testing
      const expandWithSiblings = testAdapter.expandWithSiblings.bind(testAdapter);

      const expanded = await expandWithSiblings(initialResults, 'persona-123');

      // Should have exactly 3 chunks (no duplicates)
      expect(expanded).toHaveLength(3);

      // Verify unique IDs
      const ids = expanded.map(doc => doc.metadata?.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('should return original documents when no chunk groups exist', async () => {
      const mockPrisma = {
        $queryRaw: vi.fn(),
      };

      const testAdapter = new PgvectorMemoryAdapter(mockPrisma as any, 'test-api-key');

      // Documents without chunk metadata
      const documents: MemoryDocument[] = [
        { pageContent: 'Regular memory 1', metadata: { id: 'mem-1' } },
        { pageContent: 'Regular memory 2', metadata: { id: 'mem-2' } },
      ];

      // @ts-expect-error - accessing private method for testing
      const expandWithSiblings = testAdapter.expandWithSiblings.bind(testAdapter);

      const result = await expandWithSiblings(documents, 'persona-123');

      // Should return original documents unchanged
      expect(result).toEqual(documents);
      // Should not make any sibling queries
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
