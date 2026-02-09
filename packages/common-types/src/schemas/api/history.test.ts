/**
 * History API Input Schema Tests
 *
 * Validates schemas for history endpoint request bodies.
 */

import { describe, it, expect } from 'vitest';
import { ClearHistorySchema, UndoHistorySchema, HardDeleteHistorySchema } from './history.js';

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
});
