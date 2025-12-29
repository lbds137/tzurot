/**
 * Tests for Response Cleanup Utilities
 *
 * Tests the cleanup of AI-generated responses that may contain
 * learned artifacts from XML-formatted conversation history.
 */

import { describe, it, expect } from 'vitest';
import { stripResponseArtifacts } from './responseCleanup.js';

describe('stripResponseArtifacts', () => {
  describe('XML trailing tag stripping', () => {
    it('should strip trailing </message> tag', () => {
      expect(stripResponseArtifacts('Hello there!</message>', 'Emily')).toBe('Hello there!');
    });

    it('should strip trailing </message> with whitespace', () => {
      expect(stripResponseArtifacts('Hello!</message>\n', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</message>  ', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</message>\n\n', 'Emily')).toBe('Hello!');
    });

    it('should strip multiple trailing </message> tags', () => {
      expect(stripResponseArtifacts('Hello!</message></message>', 'Emily')).toBe('Hello!');
    });

    it('should be case-insensitive for tag', () => {
      expect(stripResponseArtifacts('Hello!</MESSAGE>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</Message>', 'Emily')).toBe('Hello!');
    });

    it('should NOT strip </message> in middle of content', () => {
      const content = 'The </message> tag is used for XML';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should strip trailing </current_turn> tag', () => {
      expect(stripResponseArtifacts('Hello there!</current_turn>', 'Emily')).toBe('Hello there!');
    });

    it('should strip trailing </current_turn> with whitespace', () => {
      expect(stripResponseArtifacts('Hello!</current_turn>\n', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</current_turn>  ', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</current_turn>\n\n', 'Emily')).toBe('Hello!');
    });

    it('should be case-insensitive for </current_turn> tag', () => {
      expect(stripResponseArtifacts('Hello!</CURRENT_TURN>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</Current_Turn>', 'Emily')).toBe('Hello!');
    });

    it('should NOT strip </current_turn> in middle of content', () => {
      const content = 'The </current_turn> tag is used for XML';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should strip both </message> and </current_turn> if present', () => {
      expect(stripResponseArtifacts('Hello!</current_turn></message>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</message></current_turn>', 'Emily')).toBe('Hello!');
    });

    it('should strip trailing </incoming_message> tag', () => {
      expect(stripResponseArtifacts('Hello there!</incoming_message>', 'Emily')).toBe('Hello there!');
    });

    it('should strip trailing </incoming_message> with whitespace', () => {
      expect(stripResponseArtifacts('Hello!</incoming_message>\n', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</incoming_message>  ', 'Emily')).toBe('Hello!');
    });

    it('should be case-insensitive for </incoming_message> tag', () => {
      expect(stripResponseArtifacts('Hello!</INCOMING_MESSAGE>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</Incoming_Message>', 'Emily')).toBe('Hello!');
    });

    it('should NOT strip </incoming_message> in middle of content', () => {
      const content = 'The </incoming_message> tag is used for XML';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });
  });

  describe('XML leading tag stripping', () => {
    it('should strip leading <message> tag with speaker', () => {
      expect(stripResponseArtifacts('<message speaker="Emily">Hello', 'Emily')).toBe('Hello');
    });

    it('should strip <message> tag with additional attributes', () => {
      expect(stripResponseArtifacts('<message speaker="Emily" time="now">Hello', 'Emily')).toBe(
        'Hello'
      );
      expect(stripResponseArtifacts('<message speaker="Emily" time="2m ago">Hello', 'Emily')).toBe(
        'Hello'
      );
    });

    it('should handle single quotes in attributes', () => {
      expect(stripResponseArtifacts("<message speaker='Emily'>Hello", 'Emily')).toBe('Hello');
    });

    it('should be case-insensitive for personality name in tag', () => {
      expect(stripResponseArtifacts('<message speaker="EMILY">Hello', 'Emily')).toBe('Hello');
      expect(stripResponseArtifacts('<message speaker="emily">Hello', 'Emily')).toBe('Hello');
    });

    it('should NOT strip if speaker name does not match', () => {
      const content = '<message speaker="Lilith">Hello';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should NOT strip <message> in middle of content', () => {
      const content = 'Use <message speaker="test"> for XML';
      expect(stripResponseArtifacts(content, 'test')).toBe(content);
    });
  });

  describe('Combined XML artifacts', () => {
    it('should strip both leading and trailing XML tags', () => {
      expect(stripResponseArtifacts('<message speaker="Emily">Hello!</message>', 'Emily')).toBe(
        'Hello!'
      );
    });

    it('should strip leading tag, trailing tag, and preserve content', () => {
      const input = '<message speaker="Emily" time="now">How are you?</message>\n';
      expect(stripResponseArtifacts(input, 'Emily')).toBe('How are you?');
    });

    it('should strip mixed artifact types (name prefix + trailing XML)', () => {
      // LLM might add legacy "Name:" prefix AND trailing </message>
      expect(stripResponseArtifacts('Emily: Hello!</message>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Emily: [now] Hi there!</message>', 'Emily')).toBe('Hi there!');
    });
  });

  describe('Simple name prefix stripping (legacy)', () => {
    it('should strip basic Name: prefix', () => {
      expect(stripResponseArtifacts('Emily: hello', 'Emily')).toBe('hello');
    });

    it('should strip prefix with timestamp', () => {
      expect(stripResponseArtifacts('Emily: [now] hello', 'Emily')).toBe('hello');
      expect(stripResponseArtifacts('Lilith: [2 minutes ago] hey', 'Lilith')).toBe('hey');
    });

    it('should be case-insensitive for name', () => {
      expect(stripResponseArtifacts('EMILY: hello', 'Emily')).toBe('hello');
      expect(stripResponseArtifacts('emily: hello', 'Emily')).toBe('hello');
    });

    it('should NOT strip if name does not match', () => {
      expect(stripResponseArtifacts('Emily: hello', 'Lilith')).toBe('Emily: hello');
    });

    it('should NOT strip name in middle of content', () => {
      const content = 'Hello! Emily: is my name';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });
  });

  describe('Standalone timestamps', () => {
    it('should strip standalone timestamp at start', () => {
      expect(stripResponseArtifacts('[2m ago] content here', 'Emily')).toBe('content here');
      expect(stripResponseArtifacts('[now] hello', 'Emily')).toBe('hello');
    });

    it('should NOT strip timestamps in middle of content', () => {
      expect(stripResponseArtifacts('I replied [2m ago] to you', 'Emily')).toBe(
        'I replied [2m ago] to you'
      );
    });
  });

  describe('Special characters in names', () => {
    it('should handle names with special regex characters', () => {
      expect(stripResponseArtifacts('C++Bot: hello', 'C++Bot')).toBe('hello');
      expect(stripResponseArtifacts('Test.Name: hi', 'Test.Name')).toBe('hi');
    });

    it('should handle multi-word names', () => {
      expect(stripResponseArtifacts('Bambi Prime: hello', 'Bambi Prime')).toBe('hello');
    });

    it('should handle unicode names', () => {
      expect(stripResponseArtifacts('Amélie: hello', 'Amélie')).toBe('hello');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content after stripping', () => {
      expect(stripResponseArtifacts('Emily: ', 'Emily')).toBe('');
      expect(stripResponseArtifacts('</message>', 'Emily')).toBe('');
    });

    it('should handle empty string input', () => {
      expect(stripResponseArtifacts('', 'Emily')).toBe('');
    });

    it('should return original if no artifacts', () => {
      const content = 'This is regular content';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should preserve multi-line content', () => {
      const content = 'Emily: Line 1\n\nLine 2\n\nLine 3';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Line 1\n\nLine 2\n\nLine 3');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle LLM adding </message> to roleplay', () => {
      const content = '*waves hello* Nice to meet you!</message>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('*waves hello* Nice to meet you!');
    });

    it('should handle full XML wrap around response', () => {
      const content = '<message speaker="Lilith" time="just now">Hey there!</message>';
      expect(stripResponseArtifacts(content, 'Lilith')).toBe('Hey there!');
    });

    it('should handle models that follow instructions (no cleanup needed)', () => {
      const content = 'Hello! How can I help you today?';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should clean for storage in conversation_history', () => {
      const rawResponse = '<message speaker="Emily">Hello! How are you?</message>';
      const cleaned = stripResponseArtifacts(rawResponse, 'Emily');
      expect(cleaned).toBe('Hello! How are you?');
      expect(cleaned).not.toContain('<message');
      expect(cleaned).not.toContain('</message>');
    });

    it('should strip </current_turn> learned from prompt structure', () => {
      // LLM sees <current_turn>...</current_turn> wrapper in prompts and learns to append the closing tag
      const content = '*waves enthusiastically* Hey there!</current_turn>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('*waves enthusiastically* Hey there!');
    });

    it('should clean mixed artifacts from prompt structure', () => {
      // LLM might combine multiple learned artifacts
      const rawResponse = 'Emily: How are you today?</current_turn>';
      const cleaned = stripResponseArtifacts(rawResponse, 'Emily');
      expect(cleaned).toBe('How are you today?');
      expect(cleaned).not.toContain('Emily:');
      expect(cleaned).not.toContain('</current_turn>');
    });
  });
});
