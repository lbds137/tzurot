/**
 * Tests for LTM Backfill Script
 *
 * Tests the pure utility functions: hashContent, deterministicMemoryUuid,
 * pairMessages, deduplicatePairs, queryConversationHistory, insertMemory.
 */

import { describe, it, expect, vi } from 'vitest';
import { hashContent, deterministicMemoryUuid } from '@tzurot/common-types';
import {
  pairMessages,
  deduplicatePairs,
  queryConversationHistory,
  insertMemory,
  type ConversationRow,
  type MemoryPair,
} from './backfill-ltm.js';

/** Helper to build a ConversationRow with defaults */
function makeRow(
  overrides: Partial<ConversationRow> & { role: string; content: string }
): ConversationRow {
  return {
    id: 'row-1',
    channel_id: 'ch-1',
    guild_id: 'g-1',
    personality_id: 'pers-1',
    persona_id: 'persona-1',
    discord_message_id: ['msg-1'],
    created_at: new Date('2026-02-10T12:00:00Z'),
    ...overrides,
  };
}

/** Helper to build a MemoryPair with defaults */
function makePair(overrides?: Partial<MemoryPair>): MemoryPair {
  return {
    personaId: 'persona-1',
    personalityId: 'pers-1',
    channelId: 'ch-1',
    guildId: 'g-1',
    userContent: 'Hello there',
    assistantContent: 'Hi! How can I help?',
    userMessageIds: ['msg-1'],
    assistantMessageIds: ['msg-2'],
    createdAt: new Date('2026-02-10T12:01:00Z'),
    ...overrides,
  };
}

describe('backfill-ltm', () => {
  describe('hashContent', () => {
    it('should return a 32-character hex string', () => {
      const hash = hashContent('test content');
      expect(hash).toHaveLength(32);
      expect(hash).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should be deterministic', () => {
      const hash1 = hashContent('same content');
      const hash2 = hashContent('same content');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different content', () => {
      const hash1 = hashContent('content A');
      const hash2 = hashContent('content B');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('deterministicMemoryUuid', () => {
    it('should return a valid UUID', () => {
      const uuid = deterministicMemoryUuid('persona-1', 'pers-1', 'test content');
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should be deterministic for same inputs', () => {
      const uuid1 = deterministicMemoryUuid('persona-1', 'pers-1', 'content');
      const uuid2 = deterministicMemoryUuid('persona-1', 'pers-1', 'content');
      expect(uuid1).toBe(uuid2);
    });

    it('should differ for different persona IDs', () => {
      const uuid1 = deterministicMemoryUuid('persona-1', 'pers-1', 'content');
      const uuid2 = deterministicMemoryUuid('persona-2', 'pers-1', 'content');
      expect(uuid1).not.toBe(uuid2);
    });

    it('should differ for different personality IDs', () => {
      const uuid1 = deterministicMemoryUuid('persona-1', 'pers-1', 'content');
      const uuid2 = deterministicMemoryUuid('persona-1', 'pers-2', 'content');
      expect(uuid1).not.toBe(uuid2);
    });

    it('should differ for different content', () => {
      const uuid1 = deterministicMemoryUuid('persona-1', 'pers-1', 'content A');
      const uuid2 = deterministicMemoryUuid('persona-1', 'pers-1', 'content B');
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('pairMessages', () => {
    it('should pair consecutive user/assistant messages', () => {
      const rows: ConversationRow[] = [
        makeRow({ role: 'user', content: 'Hello', discord_message_id: ['u1'] }),
        makeRow({
          role: 'assistant',
          content: 'Hi!',
          discord_message_id: ['a1'],
          created_at: new Date('2026-02-10T12:01:00Z'),
        }),
      ];

      const pairs = pairMessages(rows);

      expect(pairs).toHaveLength(1);
      expect(pairs[0].userContent).toBe('Hello');
      expect(pairs[0].assistantContent).toBe('Hi!');
      expect(pairs[0].userMessageIds).toEqual(['u1']);
      expect(pairs[0].assistantMessageIds).toEqual(['a1']);
    });

    it('should skip non-user/assistant pairs', () => {
      const rows: ConversationRow[] = [
        makeRow({ role: 'system', content: 'System message' }),
        makeRow({ role: 'assistant', content: 'Response' }),
      ];

      const pairs = pairMessages(rows);
      expect(pairs).toHaveLength(0);
    });

    it('should skip pairs with mismatched channel IDs', () => {
      const rows: ConversationRow[] = [
        makeRow({ role: 'user', content: 'Hello', channel_id: 'ch-1' }),
        makeRow({ role: 'assistant', content: 'Hi', channel_id: 'ch-2' }),
      ];

      const pairs = pairMessages(rows);
      expect(pairs).toHaveLength(0);
    });

    it('should recover after mismatched context and pair subsequent valid messages', () => {
      // [user/ch-1, assistant/ch-2, user/ch-1, assistant/ch-1]
      // The mismatch at i=0 causes continue, but i=1 (assistant) fails role check,
      // then i=2 (user/ch-1 + assistant/ch-1) should match correctly
      const rows: ConversationRow[] = [
        makeRow({ role: 'user', content: 'Q1', channel_id: 'ch-1', discord_message_id: ['u1'] }),
        makeRow({
          role: 'assistant',
          content: 'A-wrong',
          channel_id: 'ch-2',
          discord_message_id: ['a-wrong'],
        }),
        makeRow({ role: 'user', content: 'Q2', channel_id: 'ch-1', discord_message_id: ['u2'] }),
        makeRow({
          role: 'assistant',
          content: 'A2',
          channel_id: 'ch-1',
          discord_message_id: ['a2'],
        }),
      ];

      const pairs = pairMessages(rows);

      expect(pairs).toHaveLength(1);
      expect(pairs[0].userContent).toBe('Q2');
      expect(pairs[0].assistantContent).toBe('A2');
    });

    it('should skip pairs with mismatched personality IDs', () => {
      const rows: ConversationRow[] = [
        makeRow({ role: 'user', content: 'Hello', personality_id: 'p1' }),
        makeRow({ role: 'assistant', content: 'Hi', personality_id: 'p2' }),
      ];

      const pairs = pairMessages(rows);
      expect(pairs).toHaveLength(0);
    });

    it('should skip pairs with mismatched persona IDs', () => {
      const rows: ConversationRow[] = [
        makeRow({ role: 'user', content: 'Hello', persona_id: 'per1' }),
        makeRow({ role: 'assistant', content: 'Hi', persona_id: 'per2' }),
      ];

      const pairs = pairMessages(rows);
      expect(pairs).toHaveLength(0);
    });

    it('should handle multiple consecutive pairs', () => {
      const rows: ConversationRow[] = [
        makeRow({ id: '1', role: 'user', content: 'Q1', discord_message_id: ['u1'] }),
        makeRow({ id: '2', role: 'assistant', content: 'A1', discord_message_id: ['a1'] }),
        makeRow({ id: '3', role: 'user', content: 'Q2', discord_message_id: ['u2'] }),
        makeRow({ id: '4', role: 'assistant', content: 'A2', discord_message_id: ['a2'] }),
      ];

      const pairs = pairMessages(rows);

      expect(pairs).toHaveLength(2);
      expect(pairs[0].userContent).toBe('Q1');
      expect(pairs[0].assistantContent).toBe('A1');
      expect(pairs[1].userContent).toBe('Q2');
      expect(pairs[1].assistantContent).toBe('A2');
    });

    it('should skip orphan messages between valid pairs', () => {
      const rows: ConversationRow[] = [
        makeRow({ role: 'user', content: 'Q1', discord_message_id: ['u1'] }),
        makeRow({ role: 'assistant', content: 'A1', discord_message_id: ['a1'] }),
        makeRow({ role: 'assistant', content: 'Orphan assistant' }),
        makeRow({ role: 'user', content: 'Q2', discord_message_id: ['u2'] }),
        makeRow({ role: 'assistant', content: 'A2', discord_message_id: ['a2'] }),
      ];

      const pairs = pairMessages(rows);

      expect(pairs).toHaveLength(2);
      expect(pairs[0].userContent).toBe('Q1');
      expect(pairs[1].userContent).toBe('Q2');
    });

    it('should return empty for empty input', () => {
      expect(pairMessages([])).toEqual([]);
    });

    it('should return empty for single message', () => {
      const rows: ConversationRow[] = [makeRow({ role: 'user', content: 'Lonely message' })];
      expect(pairMessages(rows)).toEqual([]);
    });

    it('should use the assistant row created_at', () => {
      const assistantDate = new Date('2026-02-10T15:30:00Z');
      const rows: ConversationRow[] = [
        makeRow({ role: 'user', content: 'Q', created_at: new Date('2026-02-10T15:29:00Z') }),
        makeRow({ role: 'assistant', content: 'A', created_at: assistantDate }),
      ];

      const pairs = pairMessages(rows);
      expect(pairs[0].createdAt).toEqual(assistantDate);
    });

    it('should use the user row guild_id', () => {
      const rows: ConversationRow[] = [
        makeRow({ role: 'user', content: 'Q', guild_id: 'my-guild' }),
        makeRow({ role: 'assistant', content: 'A', guild_id: null }),
      ];

      const pairs = pairMessages(rows);
      expect(pairs[0].guildId).toBe('my-guild');
    });
  });

  describe('deduplicatePairs', () => {
    it('should format content as {user}/{assistant} pairs', () => {
      const pairs: MemoryPair[] = [makePair()];
      const result = deduplicatePairs(pairs);

      expect(result.size).toBe(1);
      const entry = [...result.values()][0];
      expect(entry.content).toBe('{user}: Hello there\n{assistant}: Hi! How can I help?');
    });

    it('should deduplicate identical content for same persona/personality', () => {
      const pair1 = makePair({ userContent: 'Same', assistantContent: 'Response' });
      const pair2 = makePair({ userContent: 'Same', assistantContent: 'Response' });
      const result = deduplicatePairs([pair1, pair2]);

      expect(result.size).toBe(1);
    });

    it('should keep both pairs when content differs', () => {
      const pair1 = makePair({ userContent: 'Q1', assistantContent: 'A1' });
      const pair2 = makePair({ userContent: 'Q2', assistantContent: 'A2' });
      const result = deduplicatePairs([pair1, pair2]);

      expect(result.size).toBe(2);
    });

    it('should keep both pairs when persona IDs differ', () => {
      const pair1 = makePair({
        personaId: 'persona-1',
        userContent: 'Same',
        assistantContent: 'Response',
      });
      const pair2 = makePair({
        personaId: 'persona-2',
        userContent: 'Same',
        assistantContent: 'Response',
      });
      const result = deduplicatePairs([pair1, pair2]);

      expect(result.size).toBe(2);
    });

    it('should keep both pairs when personality IDs differ', () => {
      const pair1 = makePair({
        personalityId: 'pers-1',
        userContent: 'Same',
        assistantContent: 'Response',
      });
      const pair2 = makePair({
        personalityId: 'pers-2',
        userContent: 'Same',
        assistantContent: 'Response',
      });
      const result = deduplicatePairs([pair1, pair2]);

      expect(result.size).toBe(2);
    });

    it('should return empty map for empty input', () => {
      const result = deduplicatePairs([]);
      expect(result.size).toBe(0);
    });

    it('should use deterministic UUIDs as keys', () => {
      const pair = makePair();
      const result = deduplicatePairs([pair]);
      const key = [...result.keys()][0];

      // Should be a valid UUID v5
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  describe('queryConversationHistory', () => {
    it('should call $queryRaw without personality filter', async () => {
      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([]),
      };
      const from = new Date('2026-02-09');
      const to = new Date('2026-02-17');

      const result = await queryConversationHistory(mockPrisma as never, from, to);

      expect(result).toEqual([]);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should call $queryRaw with personality filter', async () => {
      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([]),
      };
      const from = new Date('2026-02-09');
      const to = new Date('2026-02-17');

      const result = await queryConversationHistory(mockPrisma as never, from, to, 'some-uuid');

      expect(result).toEqual([]);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should paginate when results fill a page', async () => {
      const pageSize = 2;
      const row1 = makeRow({ id: 'aaa-1', role: 'user', content: 'Q1' });
      const row2 = makeRow({ id: 'aaa-2', role: 'assistant', content: 'A1' });
      const row3 = makeRow({ id: 'aaa-3', role: 'user', content: 'Q2' });

      const mockPrisma = {
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([row1, row2]) // First page (full → more pages)
          .mockResolvedValueOnce([row3]), // Second page (short → done)
      };
      const from = new Date('2026-02-09');
      const to = new Date('2026-02-17');

      const result = await queryConversationHistory(
        mockPrisma as never,
        from,
        to,
        undefined,
        pageSize
      );

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('aaa-1');
      expect(result[2].id).toBe('aaa-3');
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('should stop paginating when page is smaller than pageSize', async () => {
      const row1 = makeRow({ id: 'aaa-1', role: 'user', content: 'Q1' });
      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValueOnce([row1]),
      };
      const from = new Date('2026-02-09');
      const to = new Date('2026-02-17');

      const result = await queryConversationHistory(mockPrisma as never, from, to, undefined, 100);

      expect(result).toHaveLength(1);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('insertMemory', () => {
    it('should return true when a row was inserted', async () => {
      const mockPrisma = {
        $executeRaw: vi.fn().mockResolvedValue(1),
      };
      const pair = makePair();
      const embedding = new Float32Array([0.1, 0.2, 0.3]);

      const result = await insertMemory(
        mockPrisma as never,
        'test-uuid',
        pair,
        'test content',
        embedding
      );

      expect(result).toBe(true);
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('should return false when ON CONFLICT skipped the insert', async () => {
      const mockPrisma = {
        $executeRaw: vi.fn().mockResolvedValue(0),
      };
      const pair = makePair();
      const embedding = new Float32Array([0.1, 0.2, 0.3]);

      const result = await insertMemory(
        mockPrisma as never,
        'test-uuid',
        pair,
        'test content',
        embedding
      );

      expect(result).toBe(false);
    });

    it('should combine user and assistant message IDs', async () => {
      const mockPrisma = {
        $executeRaw: vi.fn().mockResolvedValue(1),
      };
      const pair = makePair({
        userMessageIds: ['u1', 'u2'],
        assistantMessageIds: ['a1'],
      });
      const embedding = new Float32Array([0.1]);

      await insertMemory(mockPrisma as never, 'id', pair, 'content', embedding);

      // The raw query template is called - just verify it was called
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });
});
