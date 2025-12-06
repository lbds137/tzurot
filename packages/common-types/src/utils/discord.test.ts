/**
 * Tests for Discord utility functions
 */

import { describe, it, expect } from 'vitest';
import { truncateText, splitMessage } from './discord.js';

describe('discord utils', () => {
  describe('truncateText', () => {
    it('should return original text if within limit', () => {
      expect(truncateText('Hello', 10)).toBe('Hello');
    });

    it('should truncate and add ellipsis when exceeding limit', () => {
      expect(truncateText('Hello World', 8)).toBe('Hello W…');
    });

    it('should handle exact length (no truncation needed)', () => {
      expect(truncateText('Hello', 5)).toBe('Hello');
    });

    it('should use custom ellipsis', () => {
      expect(truncateText('Hello World', 10, '...')).toBe('Hello W...');
    });

    it('should handle empty string', () => {
      expect(truncateText('', 10)).toBe('');
    });

    it('should handle maxLength smaller than ellipsis', () => {
      expect(truncateText('Hello', 1)).toBe('…');
    });

    it('should handle maxLength equal to ellipsis length', () => {
      expect(truncateText('Hello', 1)).toBe('…');
      expect(truncateText('Hello', 3, '...')).toBe('...');
    });

    it('should handle null/undefined input defensively', () => {
      expect(truncateText(null as unknown as string, 10)).toBe('');
      expect(truncateText(undefined as unknown as string, 10)).toBe('');
    });

    it('should preserve emoji (note: emoji length varies)', () => {
      // Emoji 👋 has .length of 2 in JS, so 'Hello 👋' is 8 chars
      // maxLength 10 - 1 (ellipsis) = 9 chars available
      expect(truncateText('Hello 👋 World', 10)).toBe('Hello 👋 …');
    });

    it('should work with Discord modal title limit', () => {
      const longTitle = 'A'.repeat(50);
      const result = truncateText(longTitle, 45);
      expect(result).toBe('A'.repeat(44) + '…');
      expect(result.length).toBe(45);
    });
  });

  describe('splitMessage', () => {
    it('should return single chunk for short content', () => {
      const result = splitMessage('Hello World');
      expect(result).toEqual(['Hello World']);
    });

    it('should return empty array for empty/null input', () => {
      expect(splitMessage('')).toEqual([]);
      expect(splitMessage(null as unknown as string)).toEqual([]);
      expect(splitMessage(undefined as unknown as string)).toEqual([]);
    });

    it('should split long content at natural boundaries', () => {
      const longContent = 'A'.repeat(2500);
      const result = splitMessage(longContent);
      expect(result.length).toBeGreaterThan(1);
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      });
    });

    it('should respect custom max length', () => {
      const content = 'Hello World! This is a test message.';
      const result = splitMessage(content, 15);
      expect(result.length).toBeGreaterThan(1);
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(15);
      });
    });
  });
});
