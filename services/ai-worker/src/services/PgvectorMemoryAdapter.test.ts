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
import { deterministicMemoryUuid } from '@tzurot/common-types/constants/memory';
import type { ArchiveSummaryTrigger } from './archiveSummary/ArchiveSummaryTrigger.js';

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
    filterValidDiscordIds: (ids: string[]) => ids.filter(id => /^\d{17,20}$/.test(id)),
  };
});

const { mockLoggerWarn, mockLoggerDebug } = vi.hoisted(() => ({
  mockLoggerWarn: vi.fn(),
  mockLoggerDebug: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: mockLoggerDebug,
      warn: mockLoggerWarn,
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

  describe('archive-summary trigger seam', () => {
    const baseMetadata: MemoryMetadata = {
      personaId: 'persona-123',
      personalityId: 'personality-456',
      canonScope: 'personal',
      createdAt: Date.now(),
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockSplitTextByTokens.mockReset();
    });

    function makeTrigger(): ArchiveSummaryTrigger {
      return { enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as ArchiveSummaryTrigger;
    }

    it('C013: a non-chunked memory enqueues with the deterministic memory id', async () => {
      const text = 'A short stored memory.';
      mockSplitTextByTokens.mockReturnValue({
        chunks: [text],
        originalTokenCount: 50,
        wasChunked: false,
      });
      const mockPrisma = { $executeRaw: vi.fn().mockResolvedValue(undefined) };
      const trigger = makeTrigger();
      const adapter = new PgvectorMemoryAdapter(
        mockPrisma as any,
        createMockEmbeddingService(),
        trigger
      );

      await adapter.addMemory({ text, metadata: baseMetadata });

      const expectedId = deterministicMemoryUuid(
        baseMetadata.personaId,
        baseMetadata.personalityId,
        text
      );
      expect(trigger.enqueue).toHaveBeenCalledWith({
        memoryId: expectedId,
        personalityId: baseMetadata.personalityId,
        reason: 'write',
      });
    });

    it('C013: a chunked memory enqueues nothing', async () => {
      const chunks = ['Chunk 1.', 'Chunk 2.'];
      mockSplitTextByTokens.mockReturnValue({ chunks, originalTokenCount: 9000, wasChunked: true });
      const mockPrisma = { $executeRaw: vi.fn().mockResolvedValue(undefined) };
      const trigger = makeTrigger();
      const adapter = new PgvectorMemoryAdapter(
        mockPrisma as any,
        createMockEmbeddingService(),
        trigger
      );

      await adapter.addMemory({ text: chunks.join('\n\n'), metadata: baseMetadata });

      expect(trigger.enqueue).not.toHaveBeenCalled();
    });

    it('C-tail: addMemory resolves even when the trigger never resolves (fire-and-forget)', async () => {
      const text = 'A short stored memory.';
      mockSplitTextByTokens.mockReturnValue({
        chunks: [text],
        originalTokenCount: 50,
        wasChunked: false,
      });
      const mockPrisma = { $executeRaw: vi.fn().mockResolvedValue(undefined) };
      // A trigger whose enqueue() never settles — if addMemory awaited it,
      // this test would time out instead of failing cleanly.
      const trigger = {
        enqueue: vi.fn(() => new Promise(() => {})),
      } as unknown as ArchiveSummaryTrigger;
      const adapter = new PgvectorMemoryAdapter(
        mockPrisma as any,
        createMockEmbeddingService(),
        trigger
      );

      await expect(adapter.addMemory({ text, metadata: baseMetadata })).resolves.toBeUndefined();
      expect(trigger.enqueue).toHaveBeenCalledTimes(1);
    });

    it('an adapter constructed without a trigger still stores', async () => {
      const text = 'A short stored memory.';
      mockSplitTextByTokens.mockReturnValue({
        chunks: [text],
        originalTokenCount: 50,
        wasChunked: false,
      });
      const mockPrisma = { $executeRaw: vi.fn().mockResolvedValue(undefined) };
      const adapter = new PgvectorMemoryAdapter(mockPrisma as any, createMockEmbeddingService());

      await expect(adapter.addMemory({ text, metadata: baseMetadata })).resolves.toBeUndefined();
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('getArchiveSummaryTrigger returns the injected trigger', () => {
      const mockPrisma = { $executeRaw: vi.fn().mockResolvedValue(undefined) };
      const trigger = makeTrigger();
      const adapter = new PgvectorMemoryAdapter(
        mockPrisma as any,
        createMockEmbeddingService(),
        trigger
      );

      expect(adapter.getArchiveSummaryTrigger()).toBe(trigger);
    });

    it('getArchiveSummaryTrigger returns undefined when constructed without one', () => {
      const mockPrisma = { $executeRaw: vi.fn().mockResolvedValue(undefined) };
      const adapter = new PgvectorMemoryAdapter(mockPrisma as any, createMockEmbeddingService());

      expect(adapter.getArchiveSummaryTrigger()).toBeUndefined();
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
        $executeRaw: vi.fn().mockResolvedValue(undefined),
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
        $executeRaw: vi.fn().mockResolvedValue(undefined),
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
        $executeRaw: vi.fn().mockResolvedValue(undefined),
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

    // The four tests below pin the retrieval-stamp seam: the stamp fires with
    // the returned ids, never blocks the retrieval, survives its own
    // rejection, and stays silent when nothing was returned.

    it('MEM-ARCH-028: stamps every retrieved memory id in one UPDATE', async () => {
      const executeRawMock = vi.fn().mockResolvedValue(undefined);
      const mockPrisma = {
        $queryRaw: vi
          .fn()
          .mockResolvedValue([
            buildQueryResultRow({ id: 'mem-1', content: 'First memory', distance: 0.05 }),
            buildQueryResultRow({ id: 'mem-2', content: 'Second memory', distance: 0.2 }),
          ]),
        $executeRaw: executeRawMock,
      };

      const adapter = new PgvectorMemoryAdapter(mockPrisma as never, createMockEmbeddingService());

      const result = await adapter.queryMemories('what did we discuss yesterday', {
        personaId: 'persona-123',
        includeSiblings: false,
      });

      expect(executeRawMock).toHaveBeenCalledTimes(1);
      const [strings, ...values] = executeRawMock.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      const sql = (strings as unknown as string[]).join('');
      expect(sql).toContain('last_retrieved_at');
      expect(sql).toContain('retrieval_count + 1');
      expect(values[0]).toEqual(result.map(d => d.metadata?.id));
    });

    it('MEM-ARCH-028: does not await the stamp', async () => {
      const mockPrisma = {
        $queryRaw: vi
          .fn()
          .mockResolvedValue([
            buildQueryResultRow({ id: 'mem-1', content: 'First memory', distance: 0.05 }),
            buildQueryResultRow({ id: 'mem-2', content: 'Second memory', distance: 0.2 }),
          ]),
        // Never settles — if the implementation awaited the stamp, this test
        // would hang instead of resolving.
        $executeRaw: vi.fn().mockReturnValue(new Promise(() => {})),
      };

      const adapter = new PgvectorMemoryAdapter(mockPrisma as never, createMockEmbeddingService());

      const result = await adapter.queryMemories('what did we discuss yesterday', {
        personaId: 'persona-123',
        includeSiblings: false,
      });

      expect(result).toHaveLength(2);
    });

    it('MEM-ARCH-028: a stamp failure never fails the retrieval', async () => {
      const mockPrisma = {
        $queryRaw: vi
          .fn()
          .mockResolvedValue([
            buildQueryResultRow({ id: 'mem-1', content: 'First memory', distance: 0.05 }),
          ]),
        $executeRaw: vi.fn().mockRejectedValue(new Error('stamp exploded')),
      };

      const adapter = new PgvectorMemoryAdapter(mockPrisma as never, createMockEmbeddingService());

      const result = await adapter.queryMemories('what did we discuss yesterday', {
        personaId: 'persona-123',
        includeSiblings: false,
      });

      expect(result).toHaveLength(1);
      // Let the rejected stamp promise's .catch tail settle so it doesn't
      // surface as an unhandled rejection after this test completes.
      await new Promise(resolve => setImmediate(resolve));
    });

    // Mirrors the throttle shape B1 uses for its route-error log
    // (ArchiveSummaryProcessor's ROUTE_ERROR_LOG_INTERVAL_MS): counts only
    // calls tagged with the stamp-failure message, since every retrieval
    // also emits unrelated debug lines ("Querying memories...", "Retrieved
    // memories...") that would otherwise pollute the count.
    const STAMP_FAILURE_MESSAGE = 'Retrieval stamp tail rejected';
    function countStampFailureCalls(mock: typeof mockLoggerWarn): number {
      return mock.mock.calls.filter(call => call[1] === STAMP_FAILURE_MESSAGE).length;
    }

    it('MEM-ARCH-028: a stamp failure warns once per interval and logs debug in between', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      mockLoggerWarn.mockClear();
      mockLoggerDebug.mockClear();

      const mockPrisma = {
        $queryRaw: vi
          .fn()
          .mockResolvedValue([
            buildQueryResultRow({ id: 'mem-1', content: 'First memory', distance: 0.05 }),
          ]),
        $executeRaw: vi.fn().mockRejectedValue(new Error('stamp exploded')),
      };

      const adapter = new PgvectorMemoryAdapter(mockPrisma as never, createMockEmbeddingService());

      // First rejection: no warn has fired yet on this adapter — warns.
      await adapter.queryMemories('query one', {
        personaId: 'persona-123',
        includeSiblings: false,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(countStampFailureCalls(mockLoggerWarn)).toBe(1);
      expect(countStampFailureCalls(mockLoggerDebug)).toBe(0);

      // Second rejection immediately after: still inside the interval — debug only.
      await adapter.queryMemories('query two', {
        personaId: 'persona-123',
        includeSiblings: false,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(countStampFailureCalls(mockLoggerWarn)).toBe(1);
      expect(countStampFailureCalls(mockLoggerDebug)).toBe(1);

      // Advance past the interval: warns again.
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z').getTime() + 60 * 60_000);
      await adapter.queryMemories('query three', {
        personaId: 'persona-123',
        includeSiblings: false,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(countStampFailureCalls(mockLoggerWarn)).toBe(2);
      expect(countStampFailureCalls(mockLoggerDebug)).toBe(1);

      vi.useRealTimers();
    });

    it('MEM-ARCH-028: a synchronous throw from the stamp never fails the retrieval', async () => {
      mockLoggerWarn.mockClear();
      mockLoggerDebug.mockClear();

      const mockPrisma = {
        $queryRaw: vi
          .fn()
          .mockResolvedValue([
            buildQueryResultRow({ id: 'mem-1', content: 'First memory', distance: 0.05 }),
          ]),
        // Throws synchronously when the tagged-template call is issued,
        // before it ever produces a promise to `.catch`.
        $executeRaw: vi.fn(() => {
          throw new Error('stamp threw synchronously');
        }),
      };

      const adapter = new PgvectorMemoryAdapter(mockPrisma as never, createMockEmbeddingService());

      const result = await adapter.queryMemories('what did we discuss yesterday', {
        personaId: 'persona-123',
        includeSiblings: false,
      });

      expect(result).toHaveLength(1);
      expect(countStampFailureCalls(mockLoggerWarn)).toBe(1);
    });

    it('MEM-ARCH-028: an empty result stamps nothing', async () => {
      const executeRawMock = vi.fn().mockResolvedValue(undefined);
      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        $executeRaw: executeRawMock,
      };

      const adapter = new PgvectorMemoryAdapter(mockPrisma as never, createMockEmbeddingService());

      const result = await adapter.queryMemories('what did we discuss yesterday', {
        personaId: 'persona-123',
        includeSiblings: false,
      });

      expect(result).toEqual([]);
      expect(executeRawMock).not.toHaveBeenCalled();
    });

    it('MEM-ARCH-028: recordRetrieval false skips the stamp', async () => {
      const executeRawMock = vi.fn().mockResolvedValue(undefined);
      const mockPrisma = {
        $queryRaw: vi
          .fn()
          .mockResolvedValue([
            buildQueryResultRow({ id: 'mem-1', content: 'First memory', distance: 0.05 }),
          ]),
        $executeRaw: executeRawMock,
      };

      const adapter = new PgvectorMemoryAdapter(mockPrisma as never, createMockEmbeddingService());

      const result = await adapter.queryMemories('what did we discuss yesterday', {
        personaId: 'persona-123',
        includeSiblings: false,
        recordRetrieval: false,
      });

      expect(result).toHaveLength(1);
      expect(executeRawMock).not.toHaveBeenCalled();
    });
  });

  describe('queryMemoriesWithChannelScoping', () => {
    // Pins delegation wiring — confirms this method routes through the
    // adapter's own queryMemories rather than a separate code path.

    /** Minimal row builder for this describe block — mirrors the shape
     * `buildQueryResultRow` above builds, scoped separately since that
     * helper lives inside the `queryMemories` describe closure. */
    function buildRow(overrides: {
      id: string;
      chunk_group_id: string;
      chunk_index: number;
    }): unknown {
      return {
        id: overrides.id,
        content: `content of ${overrides.id}`,
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
        chunk_group_id: overrides.chunk_group_id,
        chunk_index: overrides.chunk_index,
        total_chunks: 3,
      };
    }

    it('delegates to waterfallMemoryQuery using its own queryMemories', async () => {
      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        $executeRaw: vi.fn().mockResolvedValue(undefined),
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

    it('MEM-ARCH-028: the channel-scoped waterfall stamps each memory once even when a chunk sibling straddles the passes', async () => {
      const groupId = 'group-g';
      const rowA = buildRow({ id: 'mem-a', chunk_group_id: groupId, chunk_index: 0 });
      const rowB = buildRow({ id: 'mem-b', chunk_group_id: groupId, chunk_index: 1 });
      const rowC = buildRow({ id: 'mem-c', chunk_group_id: groupId, chunk_index: 2 });

      const executeRawMock = vi.fn().mockResolvedValue(undefined);
      const queryRawMock = vi
        .fn()
        // Channel-scoped pass: primary search finds chunk A; sibling expansion
        // for group G (independent of the global pass) pulls in A and B.
        .mockResolvedValueOnce([rowA])
        .mockResolvedValueOnce([rowA, rowB])
        // Global backfill pass: primary search finds chunk C; sibling
        // expansion for group G pulls in A and C — the straddle, since A was
        // already returned by the channel pass above.
        .mockResolvedValueOnce([rowC])
        .mockResolvedValueOnce([rowA, rowC]);

      const mockPrisma = {
        $queryRaw: queryRawMock,
        $executeRaw: executeRawMock,
      };

      const adapter = new PgvectorMemoryAdapter(mockPrisma as never, createMockEmbeddingService());

      const result = await adapter.queryMemoriesWithChannelScoping('test query', {
        personaId: 'persona-123',
        channelIds: ['123456789012345678'],
        includeSiblings: true,
      });

      const resultIds = result.map(d => d.metadata?.id as string);
      // Confirm the straddle actually happened in this fixture (mem-a
      // returned by both passes) before trusting the stamp assertion below.
      expect(new Set(resultIds).size).toBeLessThan(resultIds.length);

      expect(executeRawMock).toHaveBeenCalledTimes(1);
      const [, idsArg] = executeRawMock.mock.calls[0] as [TemplateStringsArray, string[]];
      expect(new Set(idsArg).size).toBe(idsArg.length);
      expect([...idsArg].sort()).toEqual(['mem-a', 'mem-b', 'mem-c']);
    });
  });
});
