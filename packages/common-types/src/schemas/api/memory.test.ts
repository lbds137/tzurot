/**
 * Memory API Input Schema Tests
 *
 * Validates schemas for memory endpoint request bodies.
 */

import { describe, it, expect } from 'vitest';
import {
  FocusModeSchema,
  MemoryUpdateSchema,
  BatchDeleteSchema,
  PurgeMemoriesSchema,
  MemorySearchSchema,
} from './memory.js';

describe('Memory API Input Schema Tests', () => {
  describe('FocusModeSchema', () => {
    it('should accept valid input', () => {
      const result = FocusModeSchema.safeParse({
        personalityId: 'abc-123',
        enabled: true,
      });
      expect(result.success).toBe(true);
    });

    it('should accept enabled: false', () => {
      const result = FocusModeSchema.safeParse({
        personalityId: 'abc-123',
        enabled: false,
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty personalityId', () => {
      const result = FocusModeSchema.safeParse({
        personalityId: '',
        enabled: true,
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing personalityId', () => {
      const result = FocusModeSchema.safeParse({ enabled: true });
      expect(result.success).toBe(false);
    });

    it('should reject missing enabled', () => {
      const result = FocusModeSchema.safeParse({ personalityId: 'abc' });
      expect(result.success).toBe(false);
    });

    it('should reject non-boolean enabled', () => {
      const result = FocusModeSchema.safeParse({
        personalityId: 'abc',
        enabled: 'true',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('MemoryUpdateSchema', () => {
    it('should accept valid content', () => {
      const result = MemoryUpdateSchema.safeParse({ content: 'Updated memory' });
      expect(result.success).toBe(true);
    });

    it('should trim whitespace', () => {
      const result = MemoryUpdateSchema.safeParse({ content: '  hello  ' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe('hello');
      }
    });

    it('should reject empty content', () => {
      const result = MemoryUpdateSchema.safeParse({ content: '' });
      expect(result.success).toBe(false);
    });

    it('should reject whitespace-only content', () => {
      const result = MemoryUpdateSchema.safeParse({ content: '   ' });
      expect(result.success).toBe(false);
    });

    it('should reject missing content', () => {
      const result = MemoryUpdateSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject content over 2000 characters', () => {
      const result = MemoryUpdateSchema.safeParse({ content: 'a'.repeat(2001) });
      expect(result.success).toBe(false);
    });

    it('should accept content at exactly 2000 characters', () => {
      const result = MemoryUpdateSchema.safeParse({ content: 'a'.repeat(2000) });
      expect(result.success).toBe(true);
    });
  });

  describe('BatchDeleteSchema', () => {
    it('should accept minimal input', () => {
      const result = BatchDeleteSchema.safeParse({ personalityId: 'abc-123' });
      expect(result.success).toBe(true);
    });

    it('should accept full input with timeframe and personaId', () => {
      const result = BatchDeleteSchema.safeParse({
        personalityId: 'abc-123',
        personaId: 'persona-1',
        timeframe: '7d',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty personalityId', () => {
      const result = BatchDeleteSchema.safeParse({ personalityId: '' });
      expect(result.success).toBe(false);
    });

    it('should reject missing personalityId', () => {
      const result = BatchDeleteSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('PurgeMemoriesSchema', () => {
    it('should accept personalityId with confirmation', () => {
      const result = PurgeMemoriesSchema.safeParse({
        personalityId: 'abc-123',
        confirmationPhrase: 'DELETE LILITH MEMORIES',
      });
      expect(result.success).toBe(true);
    });

    it('should accept personalityId without confirmation (validation happens in route)', () => {
      const result = PurgeMemoriesSchema.safeParse({ personalityId: 'abc-123' });
      expect(result.success).toBe(true);
    });

    it('should reject empty personalityId', () => {
      const result = PurgeMemoriesSchema.safeParse({ personalityId: '' });
      expect(result.success).toBe(false);
    });

    it('should reject missing personalityId', () => {
      const result = PurgeMemoriesSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('MemorySearchSchema', () => {
    it('should accept minimal input', () => {
      const result = MemorySearchSchema.safeParse({ query: 'search term' });
      expect(result.success).toBe(true);
    });

    it('should accept full input', () => {
      const result = MemorySearchSchema.safeParse({
        query: 'search term',
        personalityId: 'abc-123',
        limit: 20,
        offset: 10,
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
        preferTextSearch: true,
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty query', () => {
      const result = MemorySearchSchema.safeParse({ query: '' });
      expect(result.success).toBe(false);
    });

    it('should reject missing query', () => {
      const result = MemorySearchSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject query over 500 characters', () => {
      const result = MemorySearchSchema.safeParse({ query: 'a'.repeat(501) });
      expect(result.success).toBe(false);
    });

    it('should accept query at exactly 500 characters', () => {
      const result = MemorySearchSchema.safeParse({ query: 'a'.repeat(500) });
      expect(result.success).toBe(true);
    });

    it('should reject limit > 50', () => {
      const result = MemorySearchSchema.safeParse({ query: 'test', limit: 51 });
      expect(result.success).toBe(false);
    });

    it('should reject limit < 1', () => {
      const result = MemorySearchSchema.safeParse({ query: 'test', limit: 0 });
      expect(result.success).toBe(false);
    });

    it('should reject negative offset', () => {
      const result = MemorySearchSchema.safeParse({ query: 'test', offset: -1 });
      expect(result.success).toBe(false);
    });
  });
});
