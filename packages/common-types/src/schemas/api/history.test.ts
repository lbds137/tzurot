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
} from './history.js';

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
        message: 'Previous context restored.',
      };
      expect(UndoHistoryResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts response with null restoredEpoch', () => {
      const data = {
        success: true as const,
        restoredEpoch: null,
        personaId: 'persona-uuid',
        message: 'Previous context restored.',
      };
      expect(UndoHistoryResponseSchema.safeParse(data).success).toBe(true);
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
      };
      expect(HardDeleteHistoryResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts zero deletedCount', () => {
      const data = {
        success: true as const,
        deletedCount: 0,
        personaId: 'p1',
        message: 'Permanently deleted 0 messages.',
      };
      expect(HardDeleteHistoryResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects negative deletedCount', () => {
      const data = {
        success: true as const,
        deletedCount: -1,
        personaId: 'p1',
        message: 'msg',
      };
      expect(HardDeleteHistoryResponseSchema.safeParse(data).success).toBe(false);
    });
  });
});
