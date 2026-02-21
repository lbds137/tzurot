/**
 * Tests for Memory Command Formatters
 */

import { describe, it, expect } from 'vitest';
import {
  formatSimilarity,
  truncateContent,
  COLLECTOR_TIMEOUT_MS,
  DEFAULT_MAX_CONTENT_LENGTH,
  EMBED_DESCRIPTION_SAFE_LIMIT,
} from './formatters.js';

describe('Memory Formatters', () => {
  describe('constants', () => {
    it('should have 5 minute collector timeout', () => {
      expect(COLLECTOR_TIMEOUT_MS).toBe(5 * 60 * 1000);
    });

    it('should have 200 char default max content length', () => {
      expect(DEFAULT_MAX_CONTENT_LENGTH).toBe(200);
    });

    it('should have safe embed description limit below Discord max (4096)', () => {
      expect(EMBED_DESCRIPTION_SAFE_LIMIT).toBe(3800);
      expect(EMBED_DESCRIPTION_SAFE_LIMIT).toBeLessThan(4096);
    });
  });

  describe('formatSimilarity', () => {
    it('should format null as text match', () => {
      expect(formatSimilarity(null)).toBe('text match');
    });

    it('should format decimal similarity as percentage', () => {
      expect(formatSimilarity(0.85)).toBe('85%');
      expect(formatSimilarity(0.5)).toBe('50%');
      expect(formatSimilarity(1.0)).toBe('100%');
    });

    it('should round to nearest integer', () => {
      expect(formatSimilarity(0.856)).toBe('86%');
      expect(formatSimilarity(0.854)).toBe('85%');
    });
  });

  describe('truncateContent', () => {
    it('should return short content unchanged', () => {
      const content = 'Short content';
      expect(truncateContent(content)).toBe('Short content');
    });

    it('should truncate long content with ellipsis', () => {
      const content = 'A'.repeat(250);
      const result = truncateContent(content);
      expect(result.length).toBe(200);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should remove newlines', () => {
      const content = 'Line 1\nLine 2\n\nLine 3';
      expect(truncateContent(content)).toBe('Line 1 Line 2 Line 3');
    });

    it('should respect custom maxLength', () => {
      const content = 'A'.repeat(100);
      const result = truncateContent(content, 50);
      expect(result.length).toBe(50);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should trim whitespace', () => {
      const content = '  spaced content  ';
      expect(truncateContent(content)).toBe('spaced content');
    });
  });
});
