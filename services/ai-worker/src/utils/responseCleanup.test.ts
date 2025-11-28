/**
 * Tests for Response Cleanup Utilities
 */

import { describe, it, expect } from 'vitest';
import { stripPersonalityPrefix } from './responseCleanup.js';

describe('stripPersonalityPrefix', () => {
  describe('Basic prefix stripping', () => {
    it('should strip basic prefix', () => {
      expect(stripPersonalityPrefix('Emily: hello', 'Emily')).toBe('hello');
    });

    it('should strip prefix with timestamp', () => {
      expect(stripPersonalityPrefix('Emily: [now] hello', 'Emily')).toBe('hello');
      expect(stripPersonalityPrefix('Lilith: [2 minutes ago] hey', 'Lilith')).toBe('hey');
      expect(stripPersonalityPrefix('Bambi Prime: [5 seconds ago] test', 'Bambi Prime')).toBe(
        'test'
      );
    });

    it('should strip prefix with various timestamp formats', () => {
      expect(stripPersonalityPrefix('Emily: [now] content', 'Emily')).toBe('content');
      expect(stripPersonalityPrefix('Emily: [2024-01-01] content', 'Emily')).toBe('content');
      expect(stripPersonalityPrefix('Emily: [just now] content', 'Emily')).toBe('content');
    });

    it('should handle extra whitespace', () => {
      expect(stripPersonalityPrefix('Emily:  hello', 'Emily')).toBe('hello');
      expect(stripPersonalityPrefix('Emily: [now]  hello', 'Emily')).toBe('hello');
      expect(stripPersonalityPrefix('Emily:    [now]    hello', 'Emily')).toBe('hello');
    });
  });

  describe('Case sensitivity', () => {
    it('should be case-insensitive for personality name', () => {
      expect(stripPersonalityPrefix('EMILY: hello', 'Emily')).toBe('hello');
      expect(stripPersonalityPrefix('emily: hello', 'Emily')).toBe('hello');
      expect(stripPersonalityPrefix('EmIlY: hello', 'Emily')).toBe('hello');
    });
  });

  describe('Special characters in names', () => {
    it('should handle names with special regex characters', () => {
      expect(stripPersonalityPrefix('C++Bot: hello', 'C++Bot')).toBe('hello');
      expect(stripPersonalityPrefix('Test.Name: hi', 'Test.Name')).toBe('hi');
      expect(stripPersonalityPrefix('A*B: content', 'A*B')).toBe('content');
      expect(stripPersonalityPrefix('Name[1]: test', 'Name[1]')).toBe('test');
    });

    it('should handle names with parentheses', () => {
      expect(stripPersonalityPrefix('Bot(v2): hello', 'Bot(v2)')).toBe('hello');
    });

    it('should handle names with backslashes', () => {
      expect(stripPersonalityPrefix('Test\\Name: hello', 'Test\\Name')).toBe('hello');
    });
  });

  describe('Multi-word names', () => {
    it('should handle multi-word personality names', () => {
      expect(stripPersonalityPrefix('Bambi Prime: hello', 'Bambi Prime')).toBe('hello');
      expect(stripPersonalityPrefix('Dr. Emily: [now] test', 'Dr. Emily')).toBe('test');
    });
  });

  describe('Name mismatch', () => {
    it('should NOT strip if name does not match', () => {
      expect(stripPersonalityPrefix('Emily: hello', 'Lilith')).toBe('Emily: hello');
      expect(stripPersonalityPrefix('Bob: [now] test', 'Alice')).toBe('Bob: [now] test');
    });

    it('should NOT strip partial name matches', () => {
      expect(stripPersonalityPrefix('Emily: hello', 'Em')).toBe('Emily: hello');
      expect(stripPersonalityPrefix('Em: hello', 'Emily')).toBe('Em: hello');
    });
  });

  describe('Position sensitivity', () => {
    it('should NOT strip name in middle of content', () => {
      const content = 'Hello! Emily: is my name';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe(content);
    });

    it('should NOT strip name on second line', () => {
      const content = 'First line\nEmily: second line';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe(content);
    });

    it('should only strip from the very beginning', () => {
      const content = 'Some text Emily: [now] more text';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe(content);
    });
  });

  describe('Multi-line content', () => {
    it('should preserve multi-line content after prefix', () => {
      const content = 'Emily: [now] Line 1\n\nLine 2\n\nLine 3';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe('Line 1\n\nLine 2\n\nLine 3');
    });

    it('should handle content with actions and dialogue', () => {
      const content = 'Emily: [now] *reaches out*\n\nHello there!';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe('*reaches out*\n\nHello there!');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content after prefix', () => {
      expect(stripPersonalityPrefix('Emily: ', 'Emily')).toBe('');
      expect(stripPersonalityPrefix('Emily:   ', 'Emily')).toBe('');
      expect(stripPersonalityPrefix('Emily: [now] ', 'Emily')).toBe('');
    });

    it('should handle only personality name (no content)', () => {
      expect(stripPersonalityPrefix('Emily:', 'Emily')).toBe('');
    });

    it('should return original if no prefix', () => {
      const content = 'This is regular content';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe(content);
    });

    it('should handle empty string', () => {
      expect(stripPersonalityPrefix('', 'Emily')).toBe('');
    });
  });

  describe('Timestamp bracket variations', () => {
    it('should match timestamps even with newlines inside brackets', () => {
      // [^\\]]+ means "anything except ]" which includes newlines
      // This is acceptable behavior - real timestamps won't span lines anyway
      const content = 'Emily: [broken\ntimestamp] content';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe('content');
    });

    it('should handle nested brackets edge case', () => {
      // [^\\]]+ matches "time [nested", stops at first ]
      // This leaves "] content" which is acceptable since real timestamps
      // won't have nested brackets
      const content = 'Emily: [time [nested]] content';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe('] content');
    });
  });

  describe('Unicode and international characters', () => {
    it('should handle unicode characters in personality names', () => {
      expect(stripPersonalityPrefix('Amélie: hello', 'Amélie')).toBe('hello');
      expect(stripPersonalityPrefix('Café: [now] test', 'Café')).toBe('test');
    });

    it('should handle emoji in names', () => {
      expect(stripPersonalityPrefix('Bot🤖: hello', 'Bot🤖')).toBe('hello');
    });
  });

  describe('Roleplay asterisk prefix', () => {
    it('should preserve leading asterisk when stripping name', () => {
      // AI adds "*NAME:" for roleplay action notation
      // We strip NAME: but preserve the asterisk for roleplay formatting
      expect(stripPersonalityPrefix('*COLD: I confirm the activation', 'COLD')).toBe(
        '*I confirm the activation'
      );
      expect(stripPersonalityPrefix('*Emily: waves hello', 'Emily')).toBe('*waves hello');
    });

    it('should handle roleplay asterisk with trailing asterisk', () => {
      // Full roleplay wrap: *NAME: content*
      // Preserves both asterisks for proper roleplay formatting
      expect(stripPersonalityPrefix('*COLD: I confirm*', 'COLD')).toBe('*I confirm*');
    });

    it('should handle markdown bold around name', () => {
      // **NAME:** format - strips all the markdown around the name
      expect(stripPersonalityPrefix('**Emily:** Hello there!', 'Emily')).toBe('Hello there!');
      expect(stripPersonalityPrefix('**COLD:** System ready', 'COLD')).toBe('System ready');
    });

    it('should handle markdown bold with colon outside', () => {
      // **NAME**: format (colon outside bold)
      expect(stripPersonalityPrefix('**Emily**: Hello there!', 'Emily')).toBe('Hello there!');
    });

    it('should handle roleplay asterisk with timestamp', () => {
      // Preserves leading asterisk
      expect(stripPersonalityPrefix('*Emily: [now] waves*', 'Emily')).toBe('*waves*');
    });

    it('should strip name without leading asterisk normally', () => {
      // Standard case without roleplay notation
      expect(stripPersonalityPrefix('COLD: I confirm the activation', 'COLD')).toBe(
        'I confirm the activation'
      );
    });
  });

  describe('Real-world examples', () => {
    it('should handle the Emily example from the bug report', () => {
      const content =
        'Emily: [now] *my entire being glows with a soft, surprised warmth, wings giving an involuntary flutter*\n\nOh my... Lila.';
      const expected =
        '*my entire being glows with a soft, surprised warmth, wings giving an involuntary flutter*\n\nOh my... Lila.';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe(expected);
    });

    it('should handle the COLD guest mode example', () => {
      // Preserves leading asterisk for roleplay formatting
      const content =
        '*COLD: I confirm the successful activation of the Guest Mode configuration.*';
      const expected = '*I confirm the successful activation of the Guest Mode configuration.*';
      expect(stripPersonalityPrefix(content, 'COLD')).toBe(expected);
    });

    it('should handle typical Haiku output', () => {
      const content = 'Lilith: [2 minutes ago] Hey there! How are you doing?';
      expect(stripPersonalityPrefix(content, 'Lilith')).toBe('Hey there! How are you doing?');
    });

    it('should not strip when personality mentions themselves', () => {
      const content = 'I am Emily, nice to meet you!';
      expect(stripPersonalityPrefix(content, 'Emily')).toBe(content);
    });
  });

  describe('Standalone timestamps (without personality name)', () => {
    it('should strip standalone timestamp at start', () => {
      // Bug case: AI generates just "[2m ago]" without personality name
      expect(stripPersonalityPrefix('[2m ago] content here', 'Lilith')).toBe('content here');
      expect(stripPersonalityPrefix('[now] hello', 'Emily')).toBe('hello');
      expect(stripPersonalityPrefix('[5 seconds ago] test', 'Bambi')).toBe('test');
    });

    it('should strip multiple standalone timestamps', () => {
      // Edge case: Multiple timestamps stacked
      expect(stripPersonalityPrefix('[2m ago] [now] content', 'Emily')).toBe('content');
    });

    it('should strip timestamp followed by action', () => {
      // Common pattern from production: timestamp before roleplay action
      const input = '[2m ago]*A deep, resonant hum, a sound that is both a physical vibration...';
      expect(stripPersonalityPrefix(input, 'Lilith')).toBe(
        '*A deep, resonant hum, a sound that is both a physical vibration...'
      );
    });

    it('should NOT strip timestamps in middle of content', () => {
      // Timestamps mid-content should be preserved
      expect(stripPersonalityPrefix('I replied [2m ago] to your message', 'Emily')).toBe(
        'I replied [2m ago] to your message'
      );
    });

    it('should strip both name and standalone timestamps in sequence', () => {
      // Mixed case: both name prefix and standalone timestamp
      expect(stripPersonalityPrefix('[2m ago] Lilith: content', 'Lilith')).toBe('content');
    });
  });

  describe('Integration scenarios', () => {
    it('should ensure clean storage in conversation_history', () => {
      // Simulates what ConversationalRAGService.storeInteraction does
      const rawResponse = 'Emily: [now] Hello! How can I help you today?';
      const cleanedForStorage = stripPersonalityPrefix(rawResponse, 'Emily');

      // The stored content should NOT have the prefix
      expect(cleanedForStorage).toBe('Hello! How can I help you today?');
      expect(cleanedForStorage).not.toContain('Emily:');
    });

    it('should ensure clean storage in LTM vector database', () => {
      // Simulates the interactionText format used in storeInteraction
      const rawResponse = 'Lilith: [2 minutes ago] That sounds interesting!';
      const cleanedResponse = stripPersonalityPrefix(rawResponse, 'Lilith');

      // The LTM text should use cleaned response
      const interactionText = `{user}: Hello\n{assistant}: ${cleanedResponse}`;
      expect(interactionText).toBe('{user}: Hello\n{assistant}: That sounds interesting!');
      expect(interactionText).not.toContain('Lilith:');
    });

    it('should handle response without prefix (models that follow instructions)', () => {
      // Gemini 2.5 Flash doesn't add prefixes - should pass through unchanged
      const rawResponse = 'Hello! How can I help you today?';
      const cleanedForStorage = stripPersonalityPrefix(rawResponse, 'Emily');

      expect(cleanedForStorage).toBe(rawResponse);
    });
  });
});
