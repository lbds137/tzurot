/**
 * Unit Tests for PgvectorMemoryAdapter
 *
 * Tests include:
 * - Memory chunking for oversized text (addMemory)
 *
 * Channel scoping tests: PgvectorChannelScoping.test.ts
 * Sibling expansion tests: PgvectorSiblingExpander.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgvectorMemoryAdapter, type MemoryMetadata } from './PgvectorMemoryAdapter.js';
import type { IEmbeddingService } from '@tzurot/embeddings';

// Mock splitTextByTokens to control chunking behavior in tests
const mockSplitTextByTokens = vi.fn();

/**
 * Create a mock embedding service for testing
 * Returns 384-dimensional embeddings (same as BGE-small-en-v1.5)
 */
function createMockEmbeddingService(): IEmbeddingService {
  return {
    initialize: vi.fn().mockResolvedValue(true),
    getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
    getDimensions: vi.fn().mockReturnValue(384),
    isServiceReady: vi.fn().mockReturnValue(true),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

// Mock dependencies
vi.mock('@tzurot/common-types/constants/ai', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/ai')>(
    '@tzurot/common-types/constants/ai'
  );
  return {
    ...actual,
    MODEL_DEFAULTS: {
      EMBEDDING: 'Xenova/bge-small-en-v1.5',
    },
    AI_DEFAULTS: {
      CHANNEL_MEMORY_BUDGET_RATIO: 0.5,
      EMBEDDING_CHUNK_LIMIT: 7500,
      EMBEDDING_MAX_TOKENS: 8191,
    },
  };
});

vi.mock('@tzurot/common-types/constants/discord', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/discord')>(
    '@tzurot/common-types/constants/discord'
  );
  return {
    ...actual,
    filterValidDiscordIds: (ids: string[]) => ids.filter(id => /^\d{17,19}$/.test(id)),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('@tzurot/common-types/utils/textChunker', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/textChunker')>(
    '@tzurot/common-types/utils/textChunker'
  );
  return {
    ...actual,
    splitTextByTokens: (...args: unknown[]) => mockSplitTextByTokens(...args),
  };
});

vi.mock('@tzurot/common-types/utils/tokenCounter', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/tokenCounter')>(
    '@tzurot/common-types/utils/tokenCounter'
  );
  return {
    ...actual,
    countTextTokens: () => 100,
  };
});

vi.mock('../utils/promptPlaceholders.js', () => ({
  replacePromptPlaceholders: (content: string) => content,
}));

describe('PgvectorMemoryAdapter', () => {
  describe('addMemory chunking', () => {
    const baseMetadata: MemoryMetadata = {
      personaId: 'persona-123',
      personalityId: 'personality-456',
      canonScope: 'personal',
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

      // Mock Prisma - embedding service is injected via constructor
      const mockPrisma = {
        $executeRaw: vi.fn().mockResolvedValue(undefined),
      };

      const testAdapter = new PgvectorMemoryAdapter(
        mockPrisma as any,
        createMockEmbeddingService()
      );

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

      // Mock Prisma - embedding service is injected via constructor
      const mockPrisma = {
        $executeRaw: vi.fn().mockResolvedValue(undefined),
      };
      const mockService = createMockEmbeddingService();

      const testAdapter = new PgvectorMemoryAdapter(mockPrisma as any, mockService);

      await testAdapter.addMemory({ text: longText, metadata: baseMetadata });

      // Should store exactly 3 chunks
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(3);
      expect(mockService.getEmbedding).toHaveBeenCalledTimes(3);
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
        $executeRaw: vi
          .fn()
          .mockImplementation((_strings: TemplateStringsArray, ...values: unknown[]) => {
            // The first value after the template is the ID
            storedIds.push(values[0] as string);
            return Promise.resolve(undefined);
          }),
      };

      const testAdapter = new PgvectorMemoryAdapter(
        mockPrisma as any,
        createMockEmbeddingService()
      );

      await testAdapter.addMemory({ text: chunks.join('\n\n'), metadata: baseMetadata });

      // Should have 2 unique IDs
      expect(storedIds).toHaveLength(2);
      expect(new Set(storedIds).size).toBe(2); // All IDs are unique
    });

    it('should generate same chunk group ID on retry (deterministic)', async () => {
      const longText = 'First paragraph content here.\n\nSecond paragraph content here.';
      const chunks = ['First paragraph content here.', 'Second paragraph content here.'];

      mockSplitTextByTokens.mockReturnValue({
        chunks,
        originalTokenCount: 8500,
        wasChunked: true,
      });

      // Track chunkGroupIds from both calls
      const chunkGroupIds: (string | null)[] = [];
      const mockPrisma = {
        $executeRaw: vi
          .fn()
          .mockImplementation((_strings: TemplateStringsArray, ...values: unknown[]) => {
            // chunkGroupId is at index 16 in the VALUES (0-indexed)
            // Based on SQL: id, persona_id, personality_id, source_system, content, embedding,
            //               session_id, canon_scope, summary_type, channel_id, guild_id,
            //               message_ids, senders, is_summarized, created_at,
            //               legacy_shapes_user_id, chunk_group_id, ...
            chunkGroupIds.push(values[16] as string | null);
            return Promise.resolve(undefined);
          }),
      };

      const testAdapter = new PgvectorMemoryAdapter(
        mockPrisma as any,
        createMockEmbeddingService()
      );

      // Call addMemory twice with same input (simulating retry)
      await testAdapter.addMemory({ text: longText, metadata: baseMetadata });
      await testAdapter.addMemory({ text: longText, metadata: baseMetadata });

      // Should have 4 chunk group IDs (2 chunks × 2 calls)
      expect(chunkGroupIds).toHaveLength(4);

      // First two (from first call) should be same as last two (from retry)
      // All 4 should be the same chunkGroupId
      const uniqueGroupIds = new Set(chunkGroupIds);
      expect(uniqueGroupIds.size).toBe(1); // All have same group ID (deterministic)
    });
  });

  describe('queryMemories', () => {
    // Covers the read path: validation short-circuit, storage→RAG mapping,
    // and graceful DB-failure degradation. PgvectorChannelScoping.test.ts and
    // PgvectorSiblingExpander.test.ts own the helper-level assertions.

    /**
     * Build a `MemoryQueryResult` row matching the shape `prisma.$queryRaw`
     * returns. Overrides are typed against the snake_case row shape so a
     * typo like `persona_idd` fails the type check rather than silently
     * overwriting nothing.
     */
    interface MemoryQueryResultRowOverrides {
      id?: string;
      content?: string;
      persona_id?: string;
      persona_name?: string;
      owner_username?: string;
      personality_id?: string;
      personality_name?: string;
      session_id?: string | null;
      canon_scope?: string;
      summary_type?: string | null;
      channel_id?: string | null;
      guild_id?: string | null;
      message_ids?: string[] | null;
      senders?: string[] | null;
      created_at?: Date | string;
      distance?: number;
      chunk_group_id?: string | null;
      chunk_index?: number | null;
      total_chunks?: number | null;
    }
    function buildQueryResultRow(overrides: MemoryQueryResultRowOverrides = {}): unknown {
      return {
        id: 'mem-1',
        content: 'Test memory content',
        persona_id: 'persona-123',
        persona_name: 'Test Persona',
        owner_username: 'testuser',
        personality_id: 'personality-456',
        personality_name: 'Test Personality',
        session_id: null,
        canon_scope: 'personal',
        summary_type: null,
        channel_id: null,
        guild_id: null,
        message_ids: null,
        senders: null,
        created_at: new Date('2026-04-30T12:00:00Z'),
        distance: 0.1,
        chunk_group_id: null,
        chunk_index: null,
        total_chunks: null,
        ...overrides,
      };
    }

    it('returns empty array for an empty query string (validation short-circuit)', async () => {
      const mockPrisma = {
        $queryRaw: vi.fn(),
      };

      const adapter = new PgvectorMemoryAdapter(mockPrisma as never, createMockEmbeddingService());

      const result = await adapter.queryMemories('', {
        personaId: 'persona-123',
      });

      expect(result).toEqual([]);
      // The validation gate runs before any DB call — confirms we never
      // burn an embedding-API request on a known-bad input.
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('maps prisma rows into PgvectorMemoryDocument[] with normalized metadata', async () => {
      const mockPrisma = {
        $queryRaw: vi
          .fn()
          .mockResolvedValue([
            buildQueryResultRow({ id: 'mem-1', content: 'First memory', distance: 0.05 }),
            buildQueryResultRow({ id: 'mem-2', content: 'Second memory', distance: 0.2 }),
          ]),
      };

      const adapter = new PgvectorMemoryAdapter(mockPrisma as never, createMockEmbeddingService());

      const result = await adapter.queryMemories('what did we discuss yesterday', {
        personaId: 'persona-123',
        // Disable sibling expansion to keep the test scope tight to
        // queryMemories itself; PgvectorSiblingExpander.test.ts owns
        // the expansion-path assertions.
        includeSiblings: false,
      });

      expect(result).toHaveLength(2);
      expect(result[0].pageContent).toBe('First memory');
      expect(result[0].metadata?.id).toBe('mem-1');
      // `score = 1 - distance` per `mapQueryResultToDocument`, locking in
      // the storage-layer normalization that downstream RAG context relies on.
      expect(result[0].metadata?.score).toBeCloseTo(0.95);
      // `createdAt` is normalized from the row's `created_at` Date/string into
      // a number-of-ms-since-epoch — `MemoryFormatter` reads this field for
      // timestamp display, so the contract matters at the storage→RAG seam.
      expect(result[0].metadata?.createdAt).toBe(new Date('2026-04-30T12:00:00Z').getTime());
      expect(result[1].pageContent).toBe('Second memory');
      expect(result[1].metadata?.score).toBeCloseTo(0.8);
    });

    it('returns empty array when prisma query throws (graceful degradation)', async () => {
      const mockPrisma = {
        $queryRaw: vi.fn().mockRejectedValue(new Error('Connection refused')),
      };

      const adapter = new PgvectorMemoryAdapter(mockPrisma as never, createMockEmbeddingService());

      const result = await adapter.queryMemories('any query', {
        personaId: 'persona-123',
        includeSiblings: false,
      });

      // The catch path returns [] rather than propagating — DB unavailability
      // should never block the LLM response, just result in no retrieved
      // memories for that turn.
      expect(result).toEqual([]);
    });
  });

  describe('queryMemoriesWithChannelScoping', () => {
    // Pins delegation wiring — confirms this method routes through the
    // adapter's own queryMemories rather than a separate code path.

    it('delegates to waterfallMemoryQuery using its own queryMemories', async () => {
      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([]),
      };

      const adapter = new PgvectorMemoryAdapter(mockPrisma as never, createMockEmbeddingService());
      // Spy on `queryMemories` so we can confirm the delegator routes
      // through it rather than skipping the adapter's own validation
      // and mapping logic.
      const queryMemoriesSpy = vi.spyOn(adapter, 'queryMemories');

      const result = await adapter.queryMemoriesWithChannelScoping('test query', {
        personaId: 'persona-123',
        // No channelIds → waterfall falls back to a single normal query
        // through the delegated function (kept simple for this unit test;
        // the full waterfall behavior is covered in
        // PgvectorChannelScoping.test.ts).
        includeSiblings: false,
      });

      expect(result).toEqual([]);
      expect(queryMemoriesSpy).toHaveBeenCalledTimes(1);
    });
  });
});
