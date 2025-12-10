/**
 * Tests for Response Cleanup Utilities
 *
 * Tests the cleanup of AI-generated responses that may contain
 * learned artifacts from XML-formatted conversation history.
 */

import { describe, it, expect } from 'vitest';
import { stripPersonalityPrefix } from './responseCleanup.js';

describe('stripPersonalityPrefix', () => {
  describe('XML trailing tag stripping', () => {
    it('should strip trailing </message> tag', () => {
      expect(stripPersonalityPrefix('Hello there!</message>', 'Emily')).toBe('Hello there!');
    });

    it('should strip trailing </message> with whitespace', () => {
      expect(stripPersonalityPrefix('Hello!</message>\n', 'Emily')).toBe('Hello!');
      expect(stripPersonalityPrefix('Hello!</message>  ', 'Emily')).toBe('Hello!');
      expect(stripPersonalityPrefix('Hello!</message>\n\n', 'Emily')).toBe('Hello!');
    });

    it('should strip multiple trailing </message> tags', () => {
      expect(stripPersonalityPrefix('Hello!</message></message>', 'Emily')).toBe('Hello!');
    });

    it('should be case-insensitive for tag', () => {
      expect(stripPersonalityPrefix('Hello!</MESSAGE>', 'Emily')).toBe('Hello!');
      expect(stripPersonalityPrefix('Hello!</Message>', 'Emily')).toBe('Hello!');
    });

    it('should NOT strip </message> in middle of content', () => {
      const content = 'The </message> tag is used for XML';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe(content);
    });
  });

  describe('XML leading tag stripping', () => {
    it('should strip leading <message> tag with speaker', () => {
      expect(stripPersonalityPrefix('<message speaker="Emily">Hello', 'Emily')).toBe('Hello');
    });

    it('should strip <message> tag with additional attributes', () => {
      expect(stripPersonalityPrefix('<message speaker="Emily" time="now">Hello', 'Emily')).toBe(
        'Hello'
      );
      expect(stripPersonalityPrefix('<message speaker="Emily" time="2m ago">Hello', 'Emily')).toBe(
        'Hello'
      );
    });

    it('should handle single quotes in attributes', () => {
      expect(stripPersonalityPrefix("<message speaker='Emily'>Hello", 'Emily')).toBe('Hello');
    });

    it('should be case-insensitive for personality name in tag', () => {
      expect(stripPersonalityPrefix('<message speaker="EMILY">Hello', 'Emily')).toBe('Hello');
      expect(stripPersonalityPrefix('<message speaker="emily">Hello', 'Emily')).toBe('Hello');
    });

    it('should NOT strip if speaker name does not match', () => {
      const content = '<message speaker="Lilith">Hello';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe(content);
    });

    it('should NOT strip <message> in middle of content', () => {
      const content = 'Use <message speaker="test"> for XML';
      expect(stripPersonalityPrefix(content, 'test')).toBe(content);
    });
  });

  describe('Combined XML artifacts', () => {
    it('should strip both leading and trailing XML tags', () => {
      expect(stripPersonalityPrefix('<message speaker="Emily">Hello!</message>', 'Emily')).toBe(
        'Hello!'
      );
    });

    it('should strip leading tag, trailing tag, and preserve content', () => {
      const input = '<message speaker="Emily" time="now">How are you?</message>\n';
      expect(stripPersonalityPrefix(input, 'Emily')).toBe('How are you?');
    });

    it('should strip mixed artifact types (name prefix + trailing XML)', () => {
      // LLM might add legacy "Name:" prefix AND trailing </message>
      expect(stripPersonalityPrefix('Emily: Hello!</message>', 'Emily')).toBe('Hello!');
      expect(stripPersonalityPrefix('Emily: [now] Hi there!</message>', 'Emily')).toBe('Hi there!');
    });
  });

  describe('Simple name prefix stripping (legacy)', () => {
    it('should strip basic Name: prefix', () => {
      expect(stripPersonalityPrefix('Emily: hello', 'Emily')).toBe('hello');
    });

    it('should strip prefix with timestamp', () => {
      expect(stripPersonalityPrefix('Emily: [now] hello', 'Emily')).toBe('hello');
      expect(stripPersonalityPrefix('Lilith: [2 minutes ago] hey', 'Lilith')).toBe('hey');
    });

    it('should be case-insensitive for name', () => {
      expect(stripPersonalityPrefix('EMILY: hello', 'Emily')).toBe('hello');
      expect(stripPersonalityPrefix('emily: hello', 'Emily')).toBe('hello');
    });

    it('should NOT strip if name does not match', () => {
      expect(stripPersonalityPrefix('Emily: hello', 'Lilith')).toBe('Emily: hello');
    });

    it('should NOT strip name in middle of content', () => {
      const content = 'Hello! Emily: is my name';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe(content);
    });
  });

  describe('Standalone timestamps', () => {
    it('should strip standalone timestamp at start', () => {
      expect(stripPersonalityPrefix('[2m ago] content here', 'Emily')).toBe('content here');
      expect(stripPersonalityPrefix('[now] hello', 'Emily')).toBe('hello');
    });

    it('should NOT strip timestamps in middle of content', () => {
      expect(stripPersonalityPrefix('I replied [2m ago] to you', 'Emily')).toBe(
        'I replied [2m ago] to you'
      );
    });
  });

  describe('Special characters in names', () => {
    it('should handle names with special regex characters', () => {
      expect(stripPersonalityPrefix('C++Bot: hello', 'C++Bot')).toBe('hello');
      expect(stripPersonalityPrefix('Test.Name: hi', 'Test.Name')).toBe('hi');
    });

    it('should handle multi-word names', () => {
      expect(stripPersonalityPrefix('Bambi Prime: hello', 'Bambi Prime')).toBe('hello');
    });

    it('should handle unicode names', () => {
      expect(stripPersonalityPrefix('Amélie: hello', 'Amélie')).toBe('hello');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content after stripping', () => {
      expect(stripPersonalityPrefix('Emily: ', 'Emily')).toBe('');
      expect(stripPersonalityPrefix('</message>', 'Emily')).toBe('');
    });

    it('should handle empty string input', () => {
      expect(stripPersonalityPrefix('', 'Emily')).toBe('');
    });

    it('should return original if no artifacts', () => {
      const content = 'This is regular content';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe(content);
    });

    it('should preserve multi-line content', () => {
      const content = 'Emily: Line 1\n\nLine 2\n\nLine 3';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe('Line 1\n\nLine 2\n\nLine 3');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle LLM adding </message> to roleplay', () => {
      const content = '*waves hello* Nice to meet you!</message>';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe('*waves hello* Nice to meet you!');
    });

    it('should handle full XML wrap around response', () => {
      const content = '<message speaker="Lilith" time="just now">Hey there!</message>';
      expect(stripPersonalityPrefix(content, 'Lilith')).toBe('Hey there!');
    });

    it('should handle models that follow instructions (no cleanup needed)', () => {
      const content = 'Hello! How can I help you today?';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe(content);
    });

    it('should clean for storage in conversation_history', () => {
      const rawResponse = '<message speaker="Emily">Hello! How are you?</message>';
      const cleaned = stripPersonalityPrefix(rawResponse, 'Emily');
      expect(cleaned).toBe('Hello! How are you?');
      expect(cleaned).not.toContain('<message');
      expect(cleaned).not.toContain('</message>');
    });
  });
});
