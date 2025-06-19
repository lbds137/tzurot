const {
  sanitizeContent,
  sanitizeApiText,
  needsSanitization,
  sanitizeWithInfo,
} = require('../../../src/utils/contentSanitizer');

// Mock the logger
jest.mock('../../../src/logger', () => ({
  warn: jest.fn(),
  debug: jest.fn(),
}));

const logger = require('../../../src/logger');

describe('Content Sanitizer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sanitizeContent', () => {
    it('should return empty string for null or undefined input', () => {
      expect(sanitizeContent(null)).toBe('');
      expect(sanitizeContent(undefined)).toBe('');
      expect(sanitizeContent('')).toBe('');
    });

    it('should remove null bytes and control characters', () => {
      const input = 'Hello\x00World\x01Test\x1F';
      const expected = 'HelloWorldTest';
      expect(sanitizeContent(input)).toBe(expected);
    });

    it('should preserve newlines and tabs', () => {
      const input = 'Hello\nWorld\tTest';
      expect(sanitizeContent(input)).toBe(input);
    });

    it('should remove unicode escape sequences', () => {
      const input = 'Test\\u0000Message\\u001FEnd';
      const expected = 'TestMessageEnd';
      expect(sanitizeContent(input)).toBe(expected);
    });

    it('should remove non-printable characters', () => {
      const input = 'Hello\x7FWorld\x80Test';
      const expected = 'HelloWorldTest';
      expect(sanitizeContent(input)).toBe(expected);
    });

    it('should preserve regular unicode characters', () => {
      const input = 'Hello 世界 🌍 Émojis';
      expect(sanitizeContent(input)).toBe(input);
    });

    it('should handle complex mixed content', () => {
      const input = 'Normal\x00Text\nWith\\u0000Escapes\tAnd\x1FControl\rChars';
      const expected = 'NormalText\nWithEscapes\tAndControl\rChars';
      expect(sanitizeContent(input)).toBe(expected);
    });

    it('should log warning on sanitization error', () => {
      // Create an object that throws when toString is called
      const problematicContent = {
        toString: () => {
          throw new Error('toString failed');
        },
        length: 10,
      };

      const result = sanitizeContent(problematicContent);
      expect(result).toBe('');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Text sanitization failed'));
    });

    it('should handle very long strings efficiently', () => {
      const longString = 'A'.repeat(10000) + '\x00' + 'B'.repeat(10000);
      const expected = 'A'.repeat(10000) + 'B'.repeat(10000);
      expect(sanitizeContent(longString)).toBe(expected);
    });
  });

  describe('sanitizeApiText', () => {
    it('should return empty string for null or undefined input', () => {
      expect(sanitizeApiText(null)).toBe('');
      expect(sanitizeApiText(undefined)).toBe('');
      expect(sanitizeApiText('')).toBe('');
    });

    it('should remove control characters but preserve most content', () => {
      const input = 'Hello\x00World\x01Test\x1F';
      const expected = 'HelloWorldTest';
      expect(sanitizeApiText(input)).toBe(expected);
    });

    it('should preserve newlines, tabs, and carriage returns', () => {
      const input = 'Hello\nWorld\tTest\rEnd';
      expect(sanitizeApiText(input)).toBe(input);
    });

    it('should NOT remove unicode escape sequences', () => {
      const input = 'Test\\u0000Message';
      expect(sanitizeApiText(input)).toBe(input);
    });

    it('should preserve all printable and extended characters', () => {
      const input = 'Hello 世界 🌍 Émojis €£¥';
      expect(sanitizeApiText(input)).toBe(input);
    });

    it('should handle mixed content appropriately', () => {
      const input = 'Normal\x00Text\nWith\x08Backspace\tAnd\x1FUnit';
      const expected = 'NormalText\nWithBackspace\tAndUnit';
      expect(sanitizeApiText(input)).toBe(expected);
    });
  });

  describe('needsSanitization', () => {
    it('should return false for null, undefined, or non-string input', () => {
      expect(needsSanitization(null)).toBe(false);
      expect(needsSanitization(undefined)).toBe(false);
      expect(needsSanitization(123)).toBe(false);
      expect(needsSanitization({})).toBe(false);
      expect(needsSanitization([])).toBe(false);
    });

    it('should return false for clean content', () => {
      expect(needsSanitization('Hello World')).toBe(false);
      expect(needsSanitization('Hello\nWorld\tTest')).toBe(false);
      expect(needsSanitization('世界 🌍 Émojis')).toBe(false);
    });

    it('should return true for content with control characters', () => {
      expect(needsSanitization('Hello\x00World')).toBe(true);
      expect(needsSanitization('Test\x1FEnd')).toBe(true);
      expect(needsSanitization('With\x7FDelete')).toBe(true);
    });

    it('should return true for content with escape sequences', () => {
      expect(needsSanitization('Test\\u0000Message')).toBe(true);
      expect(needsSanitization('Has\\u001FEscape')).toBe(true);
    });

    it('should return true for content with non-printable characters', () => {
      expect(needsSanitization('Hello\x80World')).toBe(true);
      expect(needsSanitization('Test\x9FEnd')).toBe(true);
    });
  });

  describe('sanitizeWithInfo', () => {
    it('should handle null or undefined input', () => {
      const result = sanitizeWithInfo(null);
      expect(result).toEqual({
        content: '',
        changed: false,
        removedChars: 0,
      });
    });

    it('should indicate no changes for clean content', () => {
      const input = 'Hello World';
      const result = sanitizeWithInfo(input);
      expect(result).toEqual({
        content: 'Hello World',
        changed: false,
        removedChars: 0,
      });
    });

    it('should provide info about sanitization changes', () => {
      const input = 'Hello\x00\x00World\x1F!';
      const result = sanitizeWithInfo(input);
      expect(result).toEqual({
        content: 'HelloWorld!',
        changed: true,
        removedChars: 3,
      });
    });

    it('should handle unicode escape sequences', () => {
      const input = 'Test\\u0000\\u001FMessage';
      const result = sanitizeWithInfo(input);
      expect(result).toEqual({
        content: 'TestMessage',
        changed: true,
        removedChars: 12, // Removed "\\u0000\\u001F"
      });
    });

    it('should provide accurate count for complex content', () => {
      const input = 'A\x00B\\u0000C\x1F\x7FD';
      const result = sanitizeWithInfo(input);
      expect(result).toEqual({
        content: 'ABCD',
        changed: true,
        removedChars: 9,
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle strings with only control characters', () => {
      expect(sanitizeContent('\x00\x01\x1F')).toBe('');
      expect(sanitizeApiText('\x00\x01\x1F')).toBe('');
    });

    it('should handle strings with only escape sequences', () => {
      expect(sanitizeContent('\\u0000\\u001F\\u007F')).toBe('');
    });

    it('should handle empty strings after sanitization', () => {
      const result = sanitizeWithInfo('\x00\x01\x1F');
      expect(result).toEqual({
        content: '',
        changed: true,
        removedChars: 3,
      });
    });

    it('should handle very long escape sequences', () => {
      const input = '\\u0000'.repeat(1000);
      const result = sanitizeContent(input);
      expect(result).toBe('');
    });

    it('should preserve space characters', () => {
      const input = 'Hello   World\u00A0Test'; // Regular spaces and non-breaking space
      expect(sanitizeContent(input)).toBe(input);
      expect(sanitizeApiText(input)).toBe(input);
    });
  });
});
