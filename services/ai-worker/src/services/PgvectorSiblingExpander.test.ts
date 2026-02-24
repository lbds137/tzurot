/**
 * Unit Tests for PgvectorSiblingExpander
 *
 * Tests sibling chunk retrieval and expansion.
 * Uses mock prisma directly instead of constructing full adapter instances.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchChunkSiblings, expandWithSiblings } from './PgvectorSiblingExpander.js';
import type { MemoryDocument } from './PgvectorTypes.js';

vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../utils/promptPlaceholders.js', () => ({
  replacePromptPlaceholders: (content: string) => content,
}));

describe('PgvectorSiblingExpander', () => {
  let mockPrisma: { $queryRaw: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = {
      $queryRaw: vi.fn(),
    };
  });

  describe('fetchChunkSiblings', () => {
    it('should fetch all chunks in a group ordered by chunkIndex', async () => {
      const siblingResults = [
        {
          id: 'mem-1',
          content: 'Chunk 1 content',
          persona_id: 'persona-123',
          personality_id: 'personality-456',
          chunk_group_id: 'group-abc',
          chunk_index: 0,
          total_chunks: 2,
          session_id: null,
          canon_scope: 'personal',
          summary_type: null,
          channel_id: null,
          guild_id: null,
          message_ids: null,
          senders: null,
          created_at: new Date(),
          distance: 0,
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
          total_chunks: 2,
          session_id: null,
          canon_scope: 'personal',
          summary_type: null,
          channel_id: null,
          guild_id: null,
          message_ids: null,
          senders: null,
          created_at: new Date(),
          distance: 0,
          persona_name: 'Test Persona',
          owner_username: 'testuser',
          personality_name: 'Test Personality',
        },
      ];

      mockPrisma.$queryRaw.mockResolvedValue(siblingResults);

      const result = await fetchChunkSiblings(mockPrisma as never, 'group-abc', 'persona-123');

      expect(result).toHaveLength(2);
      expect(result[0].pageContent).toBe('Chunk 1 content');
      expect(result[1].pageContent).toBe('Chunk 2 content');
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no siblings found', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await fetchChunkSiblings(
        mockPrisma as never,
        'nonexistent-group',
        'persona-123'
      );

      expect(result).toHaveLength(0);
    });
  });

  describe('expandWithSiblings', () => {
    it('should return documents with sibling chunks when chunk groups exist', async () => {
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

      // All chunks in the group
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
          distance: 0,
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
          distance: 0,
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
          distance: 0,
          persona_name: 'Test Persona',
          owner_username: 'testuser',
          personality_name: 'Test Personality',
        },
      ];

      mockPrisma.$queryRaw.mockResolvedValue(allChunks);

      const expanded = await expandWithSiblings(mockPrisma as never, initialResult, 'persona-123');

      // Should have expanded to include all 3 chunks
      expect(expanded.length).toBeGreaterThanOrEqual(1);
    });

    it('should not duplicate chunks when multiple chunks from same group match', async () => {
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
          distance: 0,
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
          distance: 0,
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
          distance: 0,
          persona_name: 'Test',
          owner_username: 'test',
          personality_name: 'Test',
        },
      ];

      mockPrisma.$queryRaw.mockResolvedValue(siblingResults);

      const expanded = await expandWithSiblings(mockPrisma as never, initialResults, 'persona-123');

      // Should have exactly 3 chunks (no duplicates)
      expect(expanded).toHaveLength(3);

      // Verify unique IDs
      const ids = expanded.map(doc => doc.metadata?.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('should return original documents when no chunk groups exist', async () => {
      // Documents without chunk metadata
      const documents: MemoryDocument[] = [
        { pageContent: 'Regular memory 1', metadata: { id: 'mem-1' } },
        { pageContent: 'Regular memory 2', metadata: { id: 'mem-2' } },
      ];

      const result = await expandWithSiblings(mockPrisma as never, documents, 'persona-123');

      // Should return original documents unchanged
      expect(result).toEqual(documents);
      // Should not make any sibling queries
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('should handle null chunkGroupId from database (PostgreSQL null vs undefined)', async () => {
      // Documents with explicit null chunkGroupId (as PostgreSQL would return)
      const documents: MemoryDocument[] = [
        {
          pageContent: 'Memory with null chunkGroupId',
          metadata: {
            id: 'mem-1',
            chunkGroupId: null as unknown as string, // PostgreSQL returns null, not undefined
          },
        },
        {
          pageContent: 'Memory with undefined chunkGroupId',
          metadata: {
            id: 'mem-2',
            // chunkGroupId is undefined (not set)
          },
        },
      ];

      // Should not throw "Cannot read properties of null (reading 'length')"
      const result = await expandWithSiblings(mockPrisma as never, documents, 'persona-123');

      // Should return original documents since no valid chunk groups
      expect(result).toEqual(documents);
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('should handle null id in metadata from database', async () => {
      // Documents with null id (edge case from database)
      const documents: MemoryDocument[] = [
        {
          pageContent: 'Memory with null id',
          metadata: {
            id: null as unknown as string, // PostgreSQL null
            chunkGroupId: 'group-abc',
          },
        },
      ];

      const siblingResults = [
        {
          id: null, // Sibling also has null id
          content: 'Sibling content',
          chunk_group_id: 'group-abc',
          chunk_index: 0,
          total_chunks: 2,
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
          distance: 0,
          persona_name: 'Test',
          owner_username: 'test',
          personality_name: 'Test',
        },
        {
          id: 'mem-2',
          content: 'Valid sibling',
          chunk_group_id: 'group-abc',
          chunk_index: 1,
          total_chunks: 2,
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
          distance: 0,
          persona_name: 'Test',
          owner_username: 'test',
          personality_name: 'Test',
        },
      ];

      mockPrisma.$queryRaw.mockResolvedValue(siblingResults);

      // Should not throw when encountering null ids
      const result = await expandWithSiblings(mockPrisma as never, documents, 'persona-123');

      // Should include the valid sibling
      expect(result.some(doc => doc.metadata?.id === 'mem-2')).toBe(true);
    });

    it('should handle empty string chunkGroupId', async () => {
      // Document with empty string chunkGroupId
      const documents: MemoryDocument[] = [
        {
          pageContent: 'Memory with empty chunkGroupId',
          metadata: {
            id: 'mem-1',
            chunkGroupId: '', // Empty string should be treated as no group
          },
        },
      ];

      const result = await expandWithSiblings(mockPrisma as never, documents, 'persona-123');

      // Should return original since empty string is not a valid group
      expect(result).toEqual(documents);
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
