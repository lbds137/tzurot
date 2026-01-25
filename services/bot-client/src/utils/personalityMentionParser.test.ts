/**
 * Tests for personality mention parser
 *
 * Tests behavior (WHAT the code does) not implementation (HOW it does it)
 *
 * Key principles demonstrated:
 * - Mock external dependencies (PersonalityService)
 * - Test public API only (findPersonalityMention function)
 * - Test edge cases and error conditions
 * - Clear test descriptions that explain WHAT is being tested
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { findPersonalityMention } from './personalityMentionParser.js';
import { createMockPersonalityService } from '../test/mocks/PersonalityService.mock.js';
import type { PersonalityService } from '@tzurot/common-types';

describe('personalityMentionParser', () => {
  let mockPersonalityService: PersonalityService;

  beforeEach(() => {
    // Set up fresh mocks before each test
    mockPersonalityService = createMockPersonalityService([
      { name: 'Lilith', displayName: 'Lilith', systemPrompt: 'Test prompt' },
      { name: 'Sarcastic', displayName: 'Sarcastic', systemPrompt: 'Test prompt' },
      { name: 'Bambi Prime', displayName: 'Bambi Prime', systemPrompt: 'Test prompt' },
      { name: 'Administrator', displayName: 'Administrator', systemPrompt: 'Test prompt' },
      { name: 'Angel Dust', displayName: 'Angel Dust', systemPrompt: 'Test prompt' },
    ]);
  });

  describe('Basic Mention Detection', () => {
    it('should find single-word personality mention', async () => {
      const result = await findPersonalityMention(
        '@Lilith hello there',
        '@',
        mockPersonalityService
      );

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Lilith');
      expect(result?.cleanContent).toBe('hello there');
    });

    it('should find multi-word personality mention', async () => {
      const result = await findPersonalityMention(
        '@Bambi Prime how are you?',
        '@',
        mockPersonalityService
      );

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Bambi Prime');
      expect(result?.cleanContent).toBe('how are you?');
    });

    it('should return null when no personality is mentioned', async () => {
      const result = await findPersonalityMention(
        'just a regular message',
        '@',
        mockPersonalityService
      );

      expect(result).toBeNull();
    });

    it('should return null when mentioned personality does not exist', async () => {
      const result = await findPersonalityMention(
        '@Unknown personality, hello',
        '@',
        mockPersonalityService
      );

      expect(result).toBeNull();
    });
  });

  describe('Priority Rules', () => {
    it('should prioritize multi-word over single-word personalities', async () => {
      // "Bambi Prime" (2 words) should win over "Bambi" (1 word) even if we had both
      const result = await findPersonalityMention(
        '@Bambi Prime @Lilith hello',
        '@',
        mockPersonalityService
      );

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Bambi Prime');
    });

    it('should prioritize longer character length when word count is equal', async () => {
      // "Sarcastic" (9 chars) should win over "Lilith" (6 chars) - both single words
      const result = await findPersonalityMention(
        '@Lilith @Sarcastic hey',
        '@',
        mockPersonalityService
      );

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Sarcastic');
    });

    it('should prefer multi-word even when single-word has more characters', async () => {
      // "Bambi Prime" (2 words, 11 chars) should win over "Administrator" (1 word, 13 chars)
      const result = await findPersonalityMention(
        '@Bambi Prime @Administrator test',
        '@',
        mockPersonalityService
      );

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Bambi Prime');
    });
  });

  describe('Content Cleaning', () => {
    it('should remove mention and extra whitespace from content', async () => {
      const result = await findPersonalityMention(
        '@Lilith    hello   there',
        '@',
        mockPersonalityService
      );

      expect(result).not.toBeNull();
      expect(result?.cleanContent).toBe('hello   there'); // Preserves internal whitespace
    });

    it('should handle mention at end of message', async () => {
      const result = await findPersonalityMention('hello @Lilith', '@', mockPersonalityService);

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Lilith');
      expect(result?.cleanContent).toBe('hello');
    });

    it('should handle mention in middle of message', async () => {
      const result = await findPersonalityMention(
        'hey @Lilith how are you?',
        '@',
        mockPersonalityService
      );

      expect(result).not.toBeNull();
      expect(result?.cleanContent).toBe('hey how are you?');
    });

    it('should remove ALL occurrences of the selected personality', async () => {
      const result = await findPersonalityMention(
        '@Bambi Prime @Bambi Prime, how are you?',
        '@',
        mockPersonalityService
      );

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Bambi Prime');
      // Note: Trailing punctuation is part of the match pattern and gets removed
      expect(result?.cleanContent).toBe('how are you?');
    });
  });

  describe('Trailing Punctuation Handling', () => {
    it('should handle mention with comma (punctuation removed as part of match)', async () => {
      const result = await findPersonalityMention(
        '@Lilith, hello there',
        '@',
        mockPersonalityService
      );

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Lilith');
      // Trailing punctuation is part of the regex match pattern and gets removed
      expect(result?.cleanContent).toBe('hello there');
    });

    it('should handle mention with exclamation mark (punctuation removed)', async () => {
      const result = await findPersonalityMention('@Lilith! hello', '@', mockPersonalityService);

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Lilith');
      // Trailing punctuation is part of the regex match pattern and gets removed
      expect(result?.cleanContent).toBe('hello');
    });

    it('should handle mention with question mark (punctuation removed)', async () => {
      const result = await findPersonalityMention(
        '@Lilith? are you there',
        '@',
        mockPersonalityService
      );

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Lilith');
      // Trailing punctuation is part of the regex match pattern and gets removed
      expect(result?.cleanContent).toBe('are you there');
    });

    it('should handle mention with asterisk (Discord italic/bold markdown)', async () => {
      // User scenario: *action text with @Mention* more text
      const result = await findPersonalityMention(
        '*grabs the blankets and brings them over to @Lilith* yep, sure thing',
        '@',
        mockPersonalityService
      );

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Lilith');
      // Note: Internal whitespace is preserved, so there are two spaces where the mention was
      expect(result?.cleanContent).toBe(
        '*grabs the blankets and brings them over to  yep, sure thing'
      );
    });

    it('should handle mention with underscore (Discord italic markdown)', async () => {
      const result = await findPersonalityMention(
        '_whispers to @Lilith_ hello there',
        '@',
        mockPersonalityService
      );

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Lilith');
    });

    it('should handle mention with tilde (Discord strikethrough markdown)', async () => {
      const result = await findPersonalityMention(
        '~~deleted message to @Lilith~~ oops',
        '@',
        mockPersonalityService
      );

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Lilith');
    });

    it('should handle mention with pipe (Discord spoiler markdown)', async () => {
      const result = await findPersonalityMention(
        '||spoiler for @Lilith|| surprise!',
        '@',
        mockPersonalityService
      );

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Lilith');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', async () => {
      const result = await findPersonalityMention('', '@', mockPersonalityService);

      expect(result).toBeNull();
    });

    it('should handle string with only whitespace', async () => {
      const result = await findPersonalityMention('   ', '@', mockPersonalityService);

      expect(result).toBeNull();
    });

    it('should handle mention character only', async () => {
      const result = await findPersonalityMention('@', '@', mockPersonalityService);

      expect(result).toBeNull();
    });

    it('should handle custom mention character', async () => {
      const result = await findPersonalityMention('!Lilith hello', '!', mockPersonalityService);

      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Lilith');
    });

    it('should be case-insensitive for personality names (database lookup)', async () => {
      const result = await findPersonalityMention('@lilith hello', '@', mockPersonalityService);

      expect(result).not.toBeNull();
      // Returns the name as typed in the message, not the canonical DB name
      expect(result?.personalityName).toBe('lilith');
    });
  });

  describe('Resource Exhaustion Protection', () => {
    it('should handle excessive mentions gracefully', async () => {
      // Create message with 15 mentions (> MAX_POTENTIAL_MENTIONS which is 10)
      // The parser internally limits to 10 mentions for performance
      const excessiveMentions = Array(15).fill('@Lilith').join(' ');

      const result = await findPersonalityMention(excessiveMentions, '@', mockPersonalityService);

      // Should still work (parser truncates to first 10 mentions internally)
      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Lilith');
    });
  });

  describe('Multiple Personalities', () => {
    it('should only return ONE personality (first by priority)', async () => {
      const result = await findPersonalityMention(
        '@Lilith @Sarcastic @Bambi Prime hello',
        '@',
        mockPersonalityService
      );

      // Should return "Bambi Prime" (2 words beats 1 word)
      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Bambi Prime');
    });

    it('should not return multiple personalities', async () => {
      const result = await findPersonalityMention(
        '@Lilith @Sarcastic hello',
        '@',
        mockPersonalityService
      );

      // Result is single object, not array
      expect(result).not.toBeNull();
      expect(result?.personalityName).toBe('Sarcastic'); // Longer single-word
      expect(Array.isArray(result)).toBe(false);
    });
  });
});
