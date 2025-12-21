/**
 * Tests for escapeMarkdown utility function
 *
 * These tests ensure proper escaping of markdown special characters,
 * particularly addressing the CodeQL concern about incomplete string escaping.
 */

import { describe, it, expect } from 'vitest';
import { escapeMarkdown } from './markdownUtils.js';

describe('escapeMarkdown', () => {
  describe('basic escaping', () => {
    it('should escape asterisks', () => {
      expect(escapeMarkdown('*bold*')).toBe('\\*bold\\*');
    });

    it('should escape backslashes', () => {
      expect(escapeMarkdown('path\\to\\file')).toBe('path\\\\to\\\\file');
    });

    it('should return empty string for empty input', () => {
      expect(escapeMarkdown('')).toBe('');
    });

    it('should return text unchanged if no special characters', () => {
      expect(escapeMarkdown('Hello World')).toBe('Hello World');
    });
  });

  describe('backslash-asterisk combinations (CodeQL concern)', () => {
    it('should escape backslash before asterisk correctly', () => {
      // Input: \* (backslash followed by asterisk)
      // Should become: \\* (escaped backslash, then escaped asterisk)
      expect(escapeMarkdown('\\*')).toBe('\\\\\\*');
    });

    it('should handle multiple backslash-asterisk combinations', () => {
      expect(escapeMarkdown('\\*text\\*')).toBe('\\\\\\*text\\\\\\*');
    });

    it('should handle backslash at end of string', () => {
      expect(escapeMarkdown('text\\')).toBe('text\\\\');
    });

    it('should handle double backslash', () => {
      expect(escapeMarkdown('text\\\\')).toBe('text\\\\\\\\');
    });

    it('should handle backslash not followed by asterisk', () => {
      expect(escapeMarkdown('\\n newline')).toBe('\\\\n newline');
    });
  });

  describe('complex strings', () => {
    it('should handle mixed content', () => {
      expect(escapeMarkdown('Hello *world* with \\path')).toBe('Hello \\*world\\* with \\\\path');
    });

    it('should handle character names with asterisks', () => {
      expect(escapeMarkdown('***Super Star***')).toBe('\\*\\*\\*Super Star\\*\\*\\*');
    });

    it('should handle realistic character names', () => {
      expect(escapeMarkdown('John "The *Beast*" Doe')).toBe('John "The \\*Beast\\*" Doe');
    });

    it('should preserve other special characters', () => {
      expect(escapeMarkdown('Text with _underscores_ and `code`')).toBe(
        'Text with _underscores_ and `code`'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle string of only asterisks', () => {
      expect(escapeMarkdown('***')).toBe('\\*\\*\\*');
    });

    it('should handle string of only backslashes', () => {
      expect(escapeMarkdown('\\\\\\')).toBe('\\\\\\\\\\\\');
    });

    it('should handle alternating special characters', () => {
      expect(escapeMarkdown('\\*\\*\\*')).toBe('\\\\\\*\\\\\\*\\\\\\*');
    });

    it('should handle unicode characters without escaping', () => {
      expect(escapeMarkdown('🎭 Character *Name*')).toBe('🎭 Character \\*Name\\*');
    });
  });
});
