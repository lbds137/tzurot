import { describe, it, expect } from 'vitest';
import { sanitizeForJsonb } from './jsonSanitizer.js';

describe('sanitizeForJsonb', () => {
  describe('primitive handling', () => {
    it('returns null unchanged', () => {
      expect(sanitizeForJsonb(null)).toBe(null);
    });

    it('returns undefined unchanged', () => {
      expect(sanitizeForJsonb(undefined)).toBe(undefined);
    });

    it('returns numbers unchanged', () => {
      expect(sanitizeForJsonb(42)).toBe(42);
      expect(sanitizeForJsonb(3.14)).toBe(3.14);
      expect(sanitizeForJsonb(-100)).toBe(-100);
    });

    it('returns booleans unchanged', () => {
      expect(sanitizeForJsonb(true)).toBe(true);
      expect(sanitizeForJsonb(false)).toBe(false);
    });

    it('returns normal strings unchanged', () => {
      expect(sanitizeForJsonb('hello world')).toBe('hello world');
      expect(sanitizeForJsonb('')).toBe('');
    });
  });

  describe('string sanitization', () => {
    it('removes null bytes from strings', () => {
      expect(sanitizeForJsonb('hello\u0000world')).toBe('helloworld');
      expect(sanitizeForJsonb('\u0000start')).toBe('start');
      expect(sanitizeForJsonb('end\u0000')).toBe('end');
    });

    it('replaces lone high surrogates with replacement character', () => {
      // Lone high surrogate (U+D800) without a following low surrogate
      const loneHighSurrogate = 'text\uD800end';
      const result = sanitizeForJsonb(loneHighSurrogate);
      expect(result).toBe('text\uFFFDend');
    });

    it('replaces lone low surrogates with replacement character', () => {
      // Lone low surrogate (U+DC00) without a preceding high surrogate
      const loneLowSurrogate = 'text\uDC00end';
      const result = sanitizeForJsonb(loneLowSurrogate);
      expect(result).toBe('text\uFFFDend');
    });

    it('preserves valid surrogate pairs (emoji)', () => {
      // Valid surrogate pair for emoji (e.g., 😀 = U+1F600)
      const emoji = 'hello 😀 world';
      expect(sanitizeForJsonb(emoji)).toBe('hello 😀 world');
    });

    it('handles multiple problematic characters', () => {
      const messy = 'start\u0000\uD800middle\uDC00\u0000end';
      const result = sanitizeForJsonb(messy);
      // Null bytes removed, lone surrogates replaced with U+FFFD
      expect(result).toBe('start\uFFFDmiddle\uFFFDend');
    });

    it('handles strings with mixed valid and invalid content', () => {
      const mixed = 'Valid emoji 🎉 then bad\uD800 then good again';
      const result = sanitizeForJsonb(mixed);
      expect(result).toBe('Valid emoji 🎉 then bad\uFFFD then good again');
    });
  });

  describe('array handling', () => {
    it('recursively sanitizes arrays', () => {
      const input = ['normal', 'has\u0000null', 42, true];
      const result = sanitizeForJsonb(input);
      expect(result).toEqual(['normal', 'hasnull', 42, true]);
    });

    it('handles nested arrays', () => {
      const input = [['deep\u0000', 'normal'], ['another']];
      const result = sanitizeForJsonb(input);
      expect(result).toEqual([['deep', 'normal'], ['another']]);
    });
  });

  describe('object handling', () => {
    it('recursively sanitizes objects', () => {
      const input = {
        clean: 'normal string',
        dirty: 'has\u0000null',
        number: 123,
      };
      const result = sanitizeForJsonb(input);
      expect(result).toEqual({
        clean: 'normal string',
        dirty: 'hasnull',
        number: 123,
      });
    });

    it('handles deeply nested objects', () => {
      const input = {
        level1: {
          level2: {
            value: 'deep\uD800value',
          },
        },
      };
      const result = sanitizeForJsonb(input);
      expect(result).toEqual({
        level1: {
          level2: {
            value: 'deep\uFFFDvalue',
          },
        },
      });
    });

    it('converts Date objects to ISO strings', () => {
      const date = new Date('2025-01-22T12:00:00.000Z');
      const input = { timestamp: date };
      const result = sanitizeForJsonb(input);
      expect(result).toEqual({ timestamp: '2025-01-22T12:00:00.000Z' });
    });

    it('handles mixed objects and arrays', () => {
      const input = {
        messages: [
          { role: 'user', content: 'hello\u0000' },
          { role: 'assistant', content: 'bad\uD800char' },
        ],
        meta: { count: 2 },
      };
      const result = sanitizeForJsonb(input);
      expect(result).toEqual({
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'bad\uFFFDchar' },
        ],
        meta: { count: 2 },
      });
    });
  });

  describe('real-world diagnostic payload simulation', () => {
    it('sanitizes a structure similar to DiagnosticPayload', () => {
      const payload = {
        meta: {
          requestId: 'test-123',
          personalityName: 'Test Bot',
        },
        assembledPrompt: {
          messages: [
            { role: 'system', content: 'You are helpful.\u0000' },
            { role: 'user', content: 'Hi! 😊 How are you?\uD800' },
          ],
        },
        llmResponse: {
          rawContent: 'I am doing well!\uDC00 Thanks for asking.',
          finishReason: 'stop',
        },
      };

      const result = sanitizeForJsonb(payload);

      expect(result).toEqual({
        meta: {
          requestId: 'test-123',
          personalityName: 'Test Bot',
        },
        assembledPrompt: {
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Hi! 😊 How are you?\uFFFD' },
          ],
        },
        llmResponse: {
          rawContent: 'I am doing well!\uFFFD Thanks for asking.',
          finishReason: 'stop',
        },
      });
    });
  });
});
