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
vi.mock('@tzurot/common-types', async () => {
  const actual =
    await vi.importActual<typeof import('@tzurot/common-types')>('@tzurot/common-types');
  return {
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    MODEL_DEFAULTS: {
      EMBEDDING: 'Xenova/bge-small-en-v1.5',
    },
    AI_DEFAULTS: {
      CHANNEL_MEMORY_BUDGET_RATIO: 0.5,
      EMBEDDING_CHUNK_LIMIT: 7500,
      EMBEDDING_MAX_TOKENS: 8191,
    },
    filterValidDiscordIds: (ids: string[]) => ids.filter(id => /^\d{17,19}$/.test(id)),
    splitTextByTokens: (...args: unknown[]) => mockSplitTextByTokens(...args),
    // Use actual deterministic UUID generators for testing idempotency
    generateMemoryChunkGroupUuid: actual.generateMemoryChunkGroupUuid,
    hashContent: actual.hashContent,
    deterministicMemoryUuid: actual.deterministicMemoryUuid,
    // Mock countTextTokens for defensive validation check
    countTextTokens: () => 100, // Return safe value under limit
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
});
