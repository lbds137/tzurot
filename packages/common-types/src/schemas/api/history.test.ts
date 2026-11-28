/**
 * History API Input Schema Tests
 *
 * Validates schemas for history endpoint request bodies.
 */

import { describe, it, expect } from 'vitest';
import {
  ClearHistorySchema,
  UndoHistorySchema,
  HardDeleteHistorySchema,
  HistoryStatsQuerySchema,
  ClearHistoryResponseSchema,
  UndoHistoryResponseSchema,
  HistoryStatsResponseSchema,
  HardDeleteHistoryResponseSchema,
  MessageReasoningResponseSchema,
  EditableMessageResponseSchema,
  EditAssistantMessageRequestSchema,
  EditCheckRequestSchema,
  EditAssistantMessageResponseSchema,
  MemorySyncBlockReasonSchema,
} from './history.js';
import { EDIT_RESPONSE_MAX_CONTENT_LENGTH } from '../../constants/discord.js';

describe('History API Input Schema Tests', () => {
  describe('ClearHistorySchema', () => {
    it('should accept valid personalitySlug', () => {
      const result = ClearHistorySchema.safeParse({ personalitySlug: 'lilith' });
      expect(result.success).toBe(true);
    });

    it('should accept with optional personaId', () => {
      const result = ClearHistorySchema.safeParse({
        personalitySlug: 'lilith',
        personaId: 'persona-123',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty personalitySlug', () => {
      const result = ClearHistorySchema.safeParse({ personalitySlug: '' });
      expect(result.success).toBe(false);
    });

    it('should reject missing personalitySlug', () => {
      const result = ClearHistorySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('UndoHistorySchema', () => {
    it('should accept valid personalitySlug', () => {
      const result = UndoHistorySchema.safeParse({ personalitySlug: 'lilith' });
      expect(result.success).toBe(true);
    });

    it('should accept with optional personaId', () => {
      const result = UndoHistorySchema.safeParse({
        personalitySlug: 'lilith',
        personaId: 'persona-123',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty personalitySlug', () => {
      const result = UndoHistorySchema.safeParse({ personalitySlug: '' });
      expect(result.success).toBe(false);
    });

    it('should reject missing personalitySlug', () => {
      const result = UndoHistorySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('HardDeleteHistorySchema', () => {
    it('should accept valid input', () => {
      const result = HardDeleteHistorySchema.safeParse({
        personalitySlug: 'lilith',
        channelId: '123456789012345678',
      });
      expect(result.success).toBe(true);
    });

    it('should accept with optional personaId', () => {
      const result = HardDeleteHistorySchema.safeParse({
        personalitySlug: 'lilith',
        channelId: '123456789012345678',
        personaId: 'persona-123',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty personalitySlug', () => {
      const result = HardDeleteHistorySchema.safeParse({
        personalitySlug: '',
        channelId: '123456789012345678',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty channelId', () => {
      const result = HardDeleteHistorySchema.safeParse({
        personalitySlug: 'lilith',
        channelId: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing personalitySlug', () => {
      const result = HardDeleteHistorySchema.safeParse({
        channelId: '123456789012345678',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing channelId', () => {
      const result = HardDeleteHistorySchema.safeParse({
        personalitySlug: 'lilith',
      });
      expect(result.success).toBe(false);
    });

    it('defaults scope to own when omitted', () => {
      const result = HardDeleteHistorySchema.safeParse({
        personalitySlug: 'lilith',
        channelId: '123456789012345678',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scope).toBe('own');
      }
    });

    it('accepts scope: everyone', () => {
      const result = HardDeleteHistorySchema.safeParse({
        personalitySlug: 'lilith',
        channelId: '123456789012345678',
        scope: 'everyone',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scope).toBe('everyone');
      }
    });

    it('rejects an unrecognized scope value', () => {
      const result = HardDeleteHistorySchema.safeParse({
        personalitySlug: 'lilith',
        channelId: '123456789012345678',
        scope: 'admins',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('HistoryStatsQuerySchema', () => {
    it('should accept valid query params', () => {
      const result = HistoryStatsQuerySchema.safeParse({
        personalitySlug: 'lilith',
        channelId: '123456789012345678',
      });
      expect(result.success).toBe(true);
    });

    it('should accept with optional personaId', () => {
      const result = HistoryStatsQuerySchema.safeParse({
        personalitySlug: 'lilith',
        channelId: '123456789012345678',
        personaId: 'persona-123',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.personaId).toBe('persona-123');
      }
    });

    it('should reject missing personalitySlug', () => {
      const result = HistoryStatsQuerySchema.safeParse({
        channelId: '123456789012345678',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty personalitySlug', () => {
      const result = HistoryStatsQuerySchema.safeParse({
        personalitySlug: '',
        channelId: '123456789012345678',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing channelId', () => {
      const result = HistoryStatsQuerySchema.safeParse({
        personalitySlug: 'lilith',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty channelId', () => {
      const result = HistoryStatsQuerySchema.safeParse({
        personalitySlug: 'lilith',
        channelId: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ClearHistoryResponseSchema', () => {
    it('accepts valid clear response', () => {
      const data = {
        success: true as const,
        epoch: '2026-05-25T00:00:00.000Z',
        personaId: 'persona-uuid',
        canUndo: true,
        message: 'Conversation context cleared.',
      };
      expect(ClearHistoryResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects missing canUndo', () => {
      const data = {
        success: true as const,
        epoch: '2026-05-25T00:00:00.000Z',
        personaId: 'persona-uuid',
        message: 'msg',
      };
      expect(ClearHistoryResponseSchema.safeParse(data).success).toBe(false);
    });
  });

  describe('UndoHistoryResponseSchema', () => {
    it('accepts response with restoredEpoch', () => {
      const data = {
        success: true as const,
        restoredEpoch: '2026-05-24T00:00:00.000Z',
        personaId: 'persona-uuid',
        restoredCount: 3,
        message: 'Previous context restored.',
      };
      expect(UndoHistoryResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts response with null restoredEpoch', () => {
      const data = {
        success: true as const,
        restoredEpoch: null,
        personaId: 'persona-uuid',
        restoredCount: 0,
        message: 'Previous context restored.',
      };
      expect(UndoHistoryResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects a missing restoredCount', () => {
      const data = {
        success: true as const,
        restoredEpoch: null,
        personaId: 'persona-uuid',
        message: 'Previous context restored.',
      };
      expect(UndoHistoryResponseSchema.safeParse(data).success).toBe(false);
    });

    it('survives the parse with restoredCount intact', () => {
      const result = UndoHistoryResponseSchema.safeParse({
        success: true as const,
        restoredEpoch: '2026-05-24T00:00:00.000Z',
        personaId: 'persona-uuid',
        restoredCount: 3,
        message: 'Previous context restored.',
      });
      expect(result.success).toBe(true);
      expect(result.data?.restoredCount).toBe(3);
    });
  });

  describe('HistoryStatsResponseSchema', () => {
    it('accepts full stats response', () => {
      const data = {
        channelId: '123',
        personalitySlug: 'lilith',
        personaId: 'p1',
        personaName: 'Default',
        visible: {
          totalMessages: 10,
          userMessages: 5,
          assistantMessages: 5,
          oldestMessage: '2026-01-01T00:00:00.000Z',
          newestMessage: '2026-05-25T00:00:00.000Z',
        },
        hidden: { count: 0 },
        total: { totalMessages: 10, oldestMessage: '2026-01-01T00:00:00.000Z' },
        contextEpoch: null,
        canUndo: false,
      };
      expect(HistoryStatsResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts empty visible state with null timestamps', () => {
      const data = {
        channelId: '123',
        personalitySlug: 'lilith',
        personaId: 'p1',
        personaName: 'Default',
        visible: {
          totalMessages: 0,
          userMessages: 0,
          assistantMessages: 0,
          oldestMessage: null,
          newestMessage: null,
        },
        hidden: { count: 0 },
        total: { totalMessages: 0, oldestMessage: null },
        contextEpoch: null,
        canUndo: false,
      };
      expect(HistoryStatsResponseSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('HardDeleteHistoryResponseSchema', () => {
    it('accepts valid hard-delete response', () => {
      const data = {
        success: true as const,
        deletedCount: 42,
        personaId: 'p1',
        message: 'Permanently deleted 42 messages.',
        scope: 'own' as const,
      };
      expect(HardDeleteHistoryResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts zero deletedCount', () => {
      const data = {
        success: true as const,
        deletedCount: 0,
        personaId: 'p1',
        message: 'Permanently deleted 0 messages.',
        scope: 'own' as const,
      };
      expect(HardDeleteHistoryResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects negative deletedCount', () => {
      const data = {
        success: true as const,
        deletedCount: -1,
        personaId: 'p1',
        message: 'msg',
        scope: 'own' as const,
      };
      expect(HardDeleteHistoryResponseSchema.safeParse(data).success).toBe(false);
    });

    it('accepts a null personaId for a channel-wide purge', () => {
      const data = {
        success: true as const,
        deletedCount: 7,
        personaId: null,
        message: 'Permanently deleted 7 messages.',
        scope: 'everyone' as const,
      };
      expect(HardDeleteHistoryResponseSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('MessageReasoningResponseSchema', () => {
    it('accepts a row carrying a reasoning trace', () => {
      const result = MessageReasoningResponseSchema.safeParse({
        thinkingContent: 'The model weighed two options.',
        createdAt: '2026-06-04T12:00:00.000Z',
      });
      expect(result.success).toBe(true);
    });

    /**
     * Null is a MEANINGFUL value here, not an absent one: the turn exists but
     * carries no trace, which the command renders differently from a miss.
     * A schema that rejected null would collapse that distinction.
     */
    it('accepts a null trace (the turn exists, the model produced none)', () => {
      const result = MessageReasoningResponseSchema.safeParse({
        thinkingContent: null,
        createdAt: '2026-06-04T12:00:00.000Z',
      });
      expect(result.success).toBe(true);
      expect(result.data?.thinkingContent).toBeNull();
    });

    it('preserves the trace value through the parse', () => {
      const sentinel = 'SENTINEL-READ-BACK: reasoning survived the response parse.';
      const result = MessageReasoningResponseSchema.safeParse({
        thinkingContent: sentinel,
        createdAt: '2026-06-04T12:00:00.000Z',
      });
      expect(result.data?.thinkingContent).toBe(sentinel);
    });

    it('rejects an omitted thinkingContent (null and absent are not the same)', () => {
      const result = MessageReasoningResponseSchema.safeParse({
        createdAt: '2026-06-04T12:00:00.000Z',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a missing createdAt', () => {
      const result = MessageReasoningResponseSchema.safeParse({ thinkingContent: null });
      expect(result.success).toBe(false);
    });
  });

  describe('EditableMessageResponseSchema', () => {
    it('accepts content with a chunk list and personality id', () => {
      const result = EditableMessageResponseSchema.safeParse({
        content: 'Hello',
        discordMessageIds: ['1', '2'],
        personalityId: 'p-1',
        memorySync: { kind: 'sync' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects an empty chunk list', () => {
      const result = EditableMessageResponseSchema.safeParse({
        content: 'Hello',
        discordMessageIds: [],
        personalityId: 'p-1',
        memorySync: { kind: 'none' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a missing personalityId', () => {
      const result = EditableMessageResponseSchema.safeParse({
        content: 'Hello',
        discordMessageIds: ['1'],
        memorySync: { kind: 'none' },
      });
      expect(result.success).toBe(false);
    });

    it('accepts a blocked memory state with a reason', () => {
      const result = EditableMessageResponseSchema.safeParse({
        content: 'Hello',
        discordMessageIds: ['1'],
        personalityId: 'p-1',
        memorySync: { kind: 'blocked', reason: 'locked' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects a missing memorySync and a blocked state without a reason', () => {
      for (const memorySync of [undefined, { kind: 'blocked' }]) {
        const result = EditableMessageResponseSchema.safeParse({
          content: 'Hello',
          discordMessageIds: ['1'],
          personalityId: 'p-1',
          memorySync,
        });
        expect(result.success).toBe(false);
      }
    });
  });

  describe('EditAssistantMessageRequestSchema', () => {
    it('accepts content at exactly the limit', () => {
      const result = EditAssistantMessageRequestSchema.safeParse({
        content: 'x'.repeat(EDIT_RESPONSE_MAX_CONTENT_LENGTH),
        discordMessageIds: ['111111111111111111'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects content one past the limit', () => {
      const result = EditAssistantMessageRequestSchema.safeParse({
        content: 'x'.repeat(EDIT_RESPONSE_MAX_CONTENT_LENGTH + 1),
        discordMessageIds: ['111111111111111111'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty content', () => {
      const result = EditAssistantMessageRequestSchema.safeParse({
        content: '',
        discordMessageIds: ['111111111111111111'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects an empty chunk list', () => {
      const result = EditAssistantMessageRequestSchema.safeParse({
        content: 'ok',
        discordMessageIds: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects an empty-string chunk id', () => {
      const result = EditAssistantMessageRequestSchema.safeParse({
        content: 'ok',
        discordMessageIds: [''],
      });
      expect(result.success).toBe(false);
    });

    it('rejects more than 20 chunk ids', () => {
      const result = EditAssistantMessageRequestSchema.safeParse({
        content: 'ok',
        discordMessageIds: Array.from({ length: 21 }, (_, i) =>
          String(111111111111111111n + BigInt(i))
        ),
      });
      expect(result.success).toBe(false);
    });

    it('rejects a chunk id that is not a snowflake', () => {
      for (const id of ['1', 'abc', '1'.repeat(16), '1'.repeat(21), '12345678901234567x']) {
        const result = EditAssistantMessageRequestSchema.safeParse({
          content: 'ok',
          discordMessageIds: [id],
        });
        expect(result.success).toBe(false);
      }
    });

    it('accepts snowflakes of 17 and 20 digits', () => {
      const result = EditAssistantMessageRequestSchema.safeParse({
        content: 'ok',
        discordMessageIds: ['1'.repeat(17), '1'.repeat(20)],
      });
      expect(result.success).toBe(true);
    });

    it('rejects whitespace-only content', () => {
      const result = EditAssistantMessageRequestSchema.safeParse({
        content: ' \n\t ',
        discordMessageIds: ['111111111111111111'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects duplicate chunk ids', () => {
      const result = EditAssistantMessageRequestSchema.safeParse({
        content: 'ok',
        discordMessageIds: ['111111111111111111', '222222222222222222', '111111111111111111'],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('EditCheckRequestSchema', () => {
    it('accepts non-blank content', () => {
      expect(EditCheckRequestSchema.safeParse({ content: 'New reply' }).success).toBe(true);
    });

    it.each(['', '   '])('rejects blank content %j', content => {
      expect(EditCheckRequestSchema.safeParse({ content }).success).toBe(false);
    });

    it('rejects content over the edit limit', () => {
      const content = 'a'.repeat(EDIT_RESPONSE_MAX_CONTENT_LENGTH + 1);
      expect(EditCheckRequestSchema.safeParse({ content }).success).toBe(false);
    });
  });

  describe('EditAssistantMessageResponseSchema', () => {
    it('accepts each memory outcome', () => {
      for (const memory of [
        { kind: 'none' },
        { kind: 'synced' },
        { kind: 'failed' },
        { kind: 'blocked', reason: 'locked' },
        { kind: 'blocked', reason: 'reply-off-template' },
      ]) {
        expect(EditAssistantMessageResponseSchema.safeParse({ edited: true, memory }).success).toBe(
          true
        );
      }
    });

    it('rejects a blocked outcome without a reason or with an unknown one', () => {
      for (const memory of [{ kind: 'blocked' }, { kind: 'blocked', reason: 'nope' }]) {
        expect(EditAssistantMessageResponseSchema.safeParse({ edited: true, memory }).success).toBe(
          false
        );
      }
    });

    it('rejects edited false', () => {
      const result = EditAssistantMessageResponseSchema.safeParse({
        edited: false,
        memory: { kind: 'synced' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('MemorySyncBlockReasonSchema', () => {
    it.each([
      'locked',
      'other-locked',
      'chunked',
      'ambiguous',
      'off-template',
      'reply-off-template',
    ])('accepts %s', reason => {
      expect(MemorySyncBlockReasonSchema.safeParse(reason).success).toBe(true);
    });

    it('rejects an unknown reason', () => {
      expect(MemorySyncBlockReasonSchema.safeParse('nope').success).toBe(false);
    });
  });
});
