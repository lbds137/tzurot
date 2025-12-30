import { describe, it, expect, vi } from 'vitest';
import {
  EMBEDDING_DIMENSION,
  isValidId,
  hashContent,
  deterministicMemoryUuid,
  normalizeMetadata,
  mapQueryResultToDocument,
  extractChunkGroups,
  mergeSiblings,
} from './memoryUtils.js';
import type { MemoryMetadata, MemoryQueryResult } from '../services/PgvectorTypes.js';

// Mock promptPlaceholders to avoid complex dependencies
vi.mock('./promptPlaceholders.js', () => ({
  replacePromptPlaceholders: (content: string) => content,
}));

describe('memoryUtils', () => {
  describe('EMBEDDING_DIMENSION', () => {
    it('should be 1536 (text-embedding-3-small dimension)', () => {
      expect(EMBEDDING_DIMENSION).toBe(1536);
    });
  });

  describe('isValidId', () => {
    it('returns true for non-empty string', () => {
      expect(isValidId('abc123')).toBe(true);
      expect(isValidId('a')).toBe(true);
      expect(isValidId('  ')).toBe(true); // Whitespace is valid (not empty)
    });

    it('returns false for empty string', () => {
      expect(isValidId('')).toBe(false);
    });

    it('returns false for null', () => {
      expect(isValidId(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isValidId(undefined)).toBe(false);
    });

    it('narrows type correctly (type guard)', () => {
      const maybeId: string | null | undefined = 'test-id';
      if (isValidId(maybeId)) {
        // TypeScript should know maybeId is string here
        const len: number = maybeId.length;
        expect(len).toBe(7);
      }
    });
  });

  describe('hashContent', () => {
    it('returns deterministic SHA-256 hash truncated to 32 chars', () => {
      const result = hashContent('hello world');
      expect(result).toHaveLength(32);
      expect(result).toBe(hashContent('hello world')); // Deterministic
    });

    it('returns different hashes for different content', () => {
      const hash1 = hashContent('content A');
      const hash2 = hashContent('content B');
      expect(hash1).not.toBe(hash2);
    });

    it('handles empty string', () => {
      const result = hashContent('');
      expect(result).toHaveLength(32);
    });

    it('handles unicode content', () => {
      const result = hashContent('你好世界 🌍');
      expect(result).toHaveLength(32);
    });
  });

  describe('deterministicMemoryUuid', () => {
    it('returns valid UUIDv5 format', () => {
      const uuid = deterministicMemoryUuid('persona-1', 'personality-1', 'test content');
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('returns deterministic results for same inputs', () => {
      const uuid1 = deterministicMemoryUuid('persona-1', 'personality-1', 'test content');
      const uuid2 = deterministicMemoryUuid('persona-1', 'personality-1', 'test content');
      expect(uuid1).toBe(uuid2);
    });

    it('returns different UUIDs for different persona', () => {
      const uuid1 = deterministicMemoryUuid('persona-1', 'personality-1', 'test content');
      const uuid2 = deterministicMemoryUuid('persona-2', 'personality-1', 'test content');
      expect(uuid1).not.toBe(uuid2);
    });

    it('returns different UUIDs for different personality', () => {
      const uuid1 = deterministicMemoryUuid('persona-1', 'personality-1', 'test content');
      const uuid2 = deterministicMemoryUuid('persona-1', 'personality-2', 'test content');
      expect(uuid1).not.toBe(uuid2);
    });

    it('returns different UUIDs for different content', () => {
      const uuid1 = deterministicMemoryUuid('persona-1', 'personality-1', 'content A');
      const uuid2 = deterministicMemoryUuid('persona-1', 'personality-1', 'content B');
      expect(uuid1).not.toBe(uuid2);
    });

    it('handles long content', () => {
      const longContent = 'x'.repeat(10000);
      const uuid = deterministicMemoryUuid('persona-1', 'personality-1', longContent);
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('handles empty content', () => {
      const uuid = deterministicMemoryUuid('persona-1', 'personality-1', '');
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  describe('normalizeMetadata', () => {
    it('normalizes complete metadata', () => {
      const metadata: MemoryMetadata = {
        personaId: 'persona-1',
        personalityId: 'personality-1',
        sessionId: 'session-123',
        canonScope: 'personal',
        summaryType: 'daily',
        channelId: 'channel-1',
        guildId: 'guild-1',
        messageIds: ['msg-1', 'msg-2'],
        senders: ['user-1'],
        createdAt: 1704067200000, // 2024-01-01T00:00:00.000Z
      };

      const result = normalizeMetadata(metadata);

      expect(result.sessionId).toBe('session-123');
      expect(result.canonScope).toBe('personal');
      expect(result.summaryType).toBe('daily');
      expect(result.channelId).toBe('channel-1');
      expect(result.guildId).toBe('guild-1');
      expect(result.messageIds).toEqual(['msg-1', 'msg-2']);
      expect(result.senders).toEqual(['user-1']);
      expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('converts undefined optional fields to null', () => {
      const metadata: MemoryMetadata = {
        personaId: 'persona-1',
        personalityId: 'personality-1',
        canonScope: 'global',
        createdAt: 1704067200000,
      };

      const result = normalizeMetadata(metadata);

      expect(result.sessionId).toBeNull();
      expect(result.summaryType).toBeNull();
      expect(result.channelId).toBeNull();
      expect(result.guildId).toBeNull();
    });

    it('converts empty strings to null', () => {
      const metadata: MemoryMetadata = {
        personaId: 'persona-1',
        personalityId: 'personality-1',
        sessionId: '',
        canonScope: 'personal',
        summaryType: '',
        channelId: '',
        guildId: '',
        createdAt: 1704067200000,
      };

      const result = normalizeMetadata(metadata);

      expect(result.sessionId).toBeNull();
      expect(result.summaryType).toBeNull();
      expect(result.channelId).toBeNull();
      expect(result.guildId).toBeNull();
    });

    it('defaults missing arrays to empty arrays', () => {
      const metadata: MemoryMetadata = {
        personaId: 'persona-1',
        personalityId: 'personality-1',
        canonScope: 'session',
        createdAt: 1704067200000,
      };

      const result = normalizeMetadata(metadata);

      expect(result.messageIds).toEqual([]);
      expect(result.senders).toEqual([]);
    });

    it('defaults missing canonScope to personal', () => {
      const metadata = {
        personaId: 'persona-1',
        personalityId: 'personality-1',
        createdAt: 1704067200000,
      } as MemoryMetadata;

      const result = normalizeMetadata(metadata);

      expect(result.canonScope).toBe('personal');
    });
  });

  describe('mapQueryResultToDocument', () => {
    it('transforms database result to MemoryDocument', () => {
      const queryResult: MemoryQueryResult = {
        id: 'mem-123',
        content: 'Test memory content',
        persona_id: 'persona-1',
        persona_name: 'Test Persona',
        owner_username: 'testuser',
        personality_id: 'personality-1',
        personality_name: 'Test Personality',
        session_id: 'session-1',
        canon_scope: 'personal',
        summary_type: 'daily',
        channel_id: 'channel-1',
        guild_id: 'guild-1',
        message_ids: ['msg-1'],
        senders: ['sender-1'],
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        distance: 0.15,
        chunk_group_id: null,
        chunk_index: null,
        total_chunks: null,
      };

      const result = mapQueryResultToDocument(queryResult);

      expect(result.pageContent).toBe('Test memory content');
      expect(result.metadata).toEqual({
        id: 'mem-123',
        personaId: 'persona-1',
        personalityId: 'personality-1',
        personalityName: 'Test Personality',
        sessionId: 'session-1',
        canonScope: 'personal',
        summaryType: 'daily',
        channelId: 'channel-1',
        guildId: 'guild-1',
        messageIds: ['msg-1'],
        senders: ['sender-1'],
        createdAt: 1704067200000,
        distance: 0.15,
        score: 0.85,
        chunkGroupId: null,
        chunkIndex: null,
        totalChunks: null,
      });
    });

    it('calculates score as 1 - distance', () => {
      const queryResult: MemoryQueryResult = {
        id: 'mem-1',
        content: 'Test',
        persona_id: 'p1',
        persona_name: 'Persona',
        owner_username: 'user',
        personality_id: 'pers1',
        personality_name: 'Personality',
        session_id: null,
        canon_scope: 'global',
        summary_type: null,
        channel_id: null,
        guild_id: null,
        message_ids: null,
        senders: null,
        created_at: new Date(),
        distance: 0.3,
        chunk_group_id: null,
        chunk_index: null,
        total_chunks: null,
      };

      const result = mapQueryResultToDocument(queryResult);

      expect(result.metadata?.distance).toBe(0.3);
      expect(result.metadata?.score).toBe(0.7);
    });

    it('handles chunked memories', () => {
      const queryResult: MemoryQueryResult = {
        id: 'mem-chunk',
        content: 'Chunk content',
        persona_id: 'p1',
        persona_name: 'Persona',
        owner_username: 'user',
        personality_id: 'pers1',
        personality_name: 'Personality',
        session_id: null,
        canon_scope: 'personal',
        summary_type: null,
        channel_id: null,
        guild_id: null,
        message_ids: null,
        senders: null,
        created_at: new Date(),
        distance: 0.1,
        chunk_group_id: 'group-uuid-123',
        chunk_index: 2,
        total_chunks: 5,
      };

      const result = mapQueryResultToDocument(queryResult);

      expect(result.metadata?.chunkGroupId).toBe('group-uuid-123');
      expect(result.metadata?.chunkIndex).toBe(2);
      expect(result.metadata?.totalChunks).toBe(5);
    });

    it('handles string date from database', () => {
      const queryResult: MemoryQueryResult = {
        id: 'mem-1',
        content: 'Test',
        persona_id: 'p1',
        persona_name: 'Persona',
        owner_username: 'user',
        personality_id: 'pers1',
        personality_name: 'Personality',
        session_id: null,
        canon_scope: 'global',
        summary_type: null,
        channel_id: null,
        guild_id: null,
        message_ids: null,
        senders: null,
        created_at: '2024-06-15T12:30:00.000Z',
        distance: 0.2,
        chunk_group_id: null,
        chunk_index: null,
        total_chunks: null,
      };

      const result = mapQueryResultToDocument(queryResult);

      expect(result.metadata?.createdAt).toBe(new Date('2024-06-15T12:30:00.000Z').getTime());
    });
  });

  describe('extractChunkGroups', () => {
    it('extracts unique chunk groups from documents', () => {
      const documents = [
        { pageContent: 'doc1', metadata: { id: 'id1', chunkGroupId: 'group-a' } },
        { pageContent: 'doc2', metadata: { id: 'id2', chunkGroupId: 'group-a' } },
        { pageContent: 'doc3', metadata: { id: 'id3', chunkGroupId: 'group-b' } },
      ];

      const { chunkGroups, seenIds } = extractChunkGroups(documents);

      expect(chunkGroups.size).toBe(2);
      expect(chunkGroups.has('group-a')).toBe(true);
      expect(chunkGroups.has('group-b')).toBe(true);
      expect(seenIds.size).toBe(3);
    });

    it('returns empty sets for documents without chunk groups', () => {
      const documents = [
        { pageContent: 'doc1', metadata: { id: 'id1' } },
        { pageContent: 'doc2', metadata: { id: 'id2' } },
      ];

      const { chunkGroups, seenIds } = extractChunkGroups(documents);

      expect(chunkGroups.size).toBe(0);
      expect(seenIds.size).toBe(2);
    });

    it('handles null chunkGroupId values', () => {
      const documents = [
        { pageContent: 'doc1', metadata: { id: 'id1', chunkGroupId: null } },
        { pageContent: 'doc2', metadata: { id: 'id2', chunkGroupId: 'group-a' } },
      ];

      const { chunkGroups } = extractChunkGroups(documents);

      expect(chunkGroups.size).toBe(1);
      expect(chunkGroups.has('group-a')).toBe(true);
    });

    it('handles documents without metadata', () => {
      const documents = [{ pageContent: 'doc1' }, { pageContent: 'doc2', metadata: { id: 'id2' } }];

      const { chunkGroups, seenIds } = extractChunkGroups(documents);

      expect(chunkGroups.size).toBe(0);
      expect(seenIds.size).toBe(1);
    });
  });

  describe('mergeSiblings', () => {
    it('adds new siblings to document list', () => {
      const documents = [{ pageContent: 'doc1', metadata: { id: 'id1' } }];
      const siblings = [
        { pageContent: 'sibling1', metadata: { id: 'id2' } },
        { pageContent: 'sibling2', metadata: { id: 'id3' } },
      ];
      const seenIds = new Set(['id1']);

      const result = mergeSiblings(documents, siblings, seenIds);

      expect(result.length).toBe(3);
      expect(seenIds.size).toBe(3);
    });

    it('does not add duplicate siblings', () => {
      const documents = [{ pageContent: 'doc1', metadata: { id: 'id1' } }];
      const siblings = [
        { pageContent: 'sibling1', metadata: { id: 'id1' } }, // duplicate
        { pageContent: 'sibling2', metadata: { id: 'id2' } },
      ];
      const seenIds = new Set(['id1']);

      const result = mergeSiblings(documents, siblings, seenIds);

      expect(result.length).toBe(2);
      expect(seenIds.size).toBe(2);
    });

    it('handles siblings without id in metadata', () => {
      const documents = [{ pageContent: 'doc1', metadata: { id: 'id1' } }];
      const siblings = [
        { pageContent: 'sibling1', metadata: {} },
        { pageContent: 'sibling2', metadata: { id: 'id2' } },
      ];
      const seenIds = new Set(['id1']);

      const result = mergeSiblings(documents, siblings, seenIds);

      expect(result.length).toBe(2); // Only sibling2 added
    });

    it('handles empty siblings array', () => {
      const documents = [{ pageContent: 'doc1', metadata: { id: 'id1' } }];
      const seenIds = new Set(['id1']);

      const result = mergeSiblings(documents, [], seenIds);

      expect(result.length).toBe(1);
    });
  });
});
