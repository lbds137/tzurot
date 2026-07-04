/**
 * Tests for the multi-tag personality mention parser.
 *
 * The parser returns mentions in textual left-to-right order, deduped by
 * personality ID (first occurrence wins), longest-match-per-position wins.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findPersonalityMentions } from './personalityMentionParser.js';
import { createMockPersonalityService } from '../test/mocks/PersonalityService.mock.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import { MULTI_TAG } from '@tzurot/common-types/constants/message';

const TEST_USER_ID = 'test-user-123';

describe('personalityMentionParser', () => {
  let mockPersonalityService: IPersonalityLoader;

  beforeEach(() => {
    mockPersonalityService = createMockPersonalityService([
      { name: 'Lilith', displayName: 'Lilith', systemPrompt: 'Test prompt' },
      { name: 'Sarcastic', displayName: 'Sarcastic', systemPrompt: 'Test prompt' },
      { name: 'Bambi Prime', displayName: 'Bambi Prime', systemPrompt: 'Test prompt' },
      { name: 'Bambi', displayName: 'Bambi', systemPrompt: 'Test prompt' },
      { name: 'Administrator', displayName: 'Administrator', systemPrompt: 'Test prompt' },
      { name: 'Angel Dust', displayName: 'Angel Dust', systemPrompt: 'Test prompt' },
      { name: "O'Reilly", displayName: "O'Reilly", systemPrompt: 'Test prompt' },
      { name: 'Dr. Gregory House', displayName: 'Dr. Gregory House', systemPrompt: 'Test prompt' },
      { name: 'J.R.R. Tolkien', displayName: 'J.R.R. Tolkien', systemPrompt: 'Test prompt' },
      { name: 'Charlie', displayName: 'Charlie', systemPrompt: 'Test prompt' },
      { name: 'Delta', displayName: 'Delta', systemPrompt: 'Test prompt' },
      { name: 'Echo', displayName: 'Echo', systemPrompt: 'Test prompt' },
      { name: 'Foxtrot', displayName: 'Foxtrot', systemPrompt: 'Test prompt' },
    ]);
  });

  describe('Basic detection', () => {
    it('returns a single mention for a single @-name', async () => {
      const result = await findPersonalityMentions(
        '@Lilith hello there',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Lilith');
      expect(result[0].startIndex).toBe(0);
    });

    it('returns multi-word personality match', async () => {
      const result = await findPersonalityMentions(
        '@Bambi Prime how are you?',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Bambi Prime');
    });

    it('returns empty array for content with no mentions', async () => {
      const result = await findPersonalityMentions(
        'just a regular message',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result).toEqual([]);
    });

    it('returns empty array when mentioned personality does not exist', async () => {
      const result = await findPersonalityMentions(
        '@Unknown personality, hello',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result).toEqual([]);
    });
  });

  describe('Ordering', () => {
    it('returns mentions in textual left-to-right order', async () => {
      const result = await findPersonalityMentions(
        '@Lilith and @Sarcastic say hi',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result.map(r => r.personality.name)).toEqual(['Lilith', 'Sarcastic']);
    });

    it('preserves textual order even when first mention is longer', async () => {
      const result = await findPersonalityMentions(
        '@Bambi Prime then @Lilith',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result.map(r => r.personality.name)).toEqual(['Bambi Prime', 'Lilith']);
    });

    it('preserves textual order when later mention is longer', async () => {
      const result = await findPersonalityMentions(
        '@Lilith then @Bambi Prime',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result.map(r => r.personality.name)).toEqual(['Lilith', 'Bambi Prime']);
    });

    it('returns startIndex matching the @-position in original content', async () => {
      const result = await findPersonalityMentions(
        'hi there @Lilith',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result).toHaveLength(1);
      expect(result[0].startIndex).toBe(9);
    });
  });

  describe('Longest-match-per-position wins', () => {
    it('picks Bambi Prime over Bambi at the same position', async () => {
      const result = await findPersonalityMentions(
        '@Bambi Prime hello',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Bambi Prime');
    });

    it('falls back to shorter when longer is not a valid personality', async () => {
      // "Bambi Prime hello world" is not a personality, but "Bambi Prime" is.
      const result = await findPersonalityMentions(
        '@Bambi Prime hello world',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Bambi Prime');
    });

    it('treats @Bambi and @Bambi Prime as separate mentions in order', async () => {
      // Both Bambi and Bambi Prime exist as distinct personalities. Since they
      // are separated by an `@`, each match position resolves independently.
      const result = await findPersonalityMentions(
        '@Bambi @Bambi Prime hello',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result).toHaveLength(2);
      expect(result.map(r => r.personality.name)).toEqual(['Bambi', 'Bambi Prime']);
    });
  });

  describe('Deduplication', () => {
    it('dedupes when the same personality is mentioned twice', async () => {
      const result = await findPersonalityMentions(
        '@Lilith hi @Lilith',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Lilith');
      expect(result[0].startIndex).toBe(0); // First occurrence wins.
    });

    it('keeps the first slot when the same name appears in different cases', async () => {
      // DB lookup is case-insensitive; both @Lilith and @lilith resolve to the
      // same personality ID.
      const result = await findPersonalityMentions(
        '@Lilith and @lilith',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result).toHaveLength(1);
      expect(result[0].startIndex).toBe(0);
    });
  });

  describe('Mention cap', () => {
    it('caps at MULTI_TAG.MAX_TAGS by default', async () => {
      // Six distinct valid mentions; cap is 5.
      const result = await findPersonalityMentions(
        '@Lilith @Sarcastic @Charlie @Delta @Echo @Foxtrot',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result).toHaveLength(MULTI_TAG.MAX_TAGS);
      expect(result.map(r => r.personality.name)).toEqual([
        'Lilith',
        'Sarcastic',
        'Charlie',
        'Delta',
        'Echo',
      ]);
    });

    it('respects a custom cap argument', async () => {
      const result = await findPersonalityMentions(
        '@Lilith @Sarcastic @Charlie',
        '@',
        mockPersonalityService,
        TEST_USER_ID,
        2
      );

      expect(result).toHaveLength(2);
      expect(result.map(r => r.personality.name)).toEqual(['Lilith', 'Sarcastic']);
    });
  });

  describe('Possessive handling', () => {
    it("handles @Lilith's by matching the base name", async () => {
      const result = await findPersonalityMentions(
        "@Lilith's hello",
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Lilith');
    });

    it("handles @Lilith's typed with a typographic apostrophe (mobile autocorrect)", async () => {
      const apos = String.fromCharCode(0x2019); // U+2019 RIGHT SINGLE QUOTATION MARK (not ASCII ')
      const result = await findPersonalityMentions(
        `@Lilith${apos}s hello`,
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Lilith');
    });
  });

  describe('Trailing punctuation', () => {
    it.each([
      ['@Lilith,', 'Lilith'],
      ['@Lilith.', 'Lilith'],
      ['@Lilith!', 'Lilith'],
      ['@Lilith?', 'Lilith'],
      ['@Lilith!!!', 'Lilith'],
      ['@Lilith...', 'Lilith'],
      ['@Lilith;', 'Lilith'],
    ])('strips trailing punctuation for %s', async (input, expected) => {
      const result = await findPersonalityMentions(
        `${input} hi`,
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe(expected);
    });

    it('strips a trailing typographic double-quote (mobile autocorrect)', async () => {
      const rdquo = String.fromCharCode(0x201d); // U+201D RIGHT DOUBLE QUOTATION MARK
      const result = await findPersonalityMentions(
        `@Lilith${rdquo} hello`,
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Lilith');
    });
  });

  describe('Discord markdown wrapping', () => {
    it('matches inside *asterisk* italics', async () => {
      const result = await findPersonalityMentions(
        '*nudges @Lilith*',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Lilith');
    });

    it('matches inside _underscore_ italics', async () => {
      const result = await findPersonalityMentions(
        '_whispers to @Lilith_',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
    });

    it('matches inside ~~strikethrough~~', async () => {
      const result = await findPersonalityMentions(
        '~~hello @Lilith~~',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
    });

    it('matches inside ||spoiler||', async () => {
      const result = await findPersonalityMentions(
        '||@Lilith surprise||',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
    });

    it('matches inside `backticks`', async () => {
      const result = await findPersonalityMentions(
        '`@Lilith` over here',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
    });

    it('matches inside triple-backticks for code blocks', async () => {
      const result = await findPersonalityMentions(
        '```@Lilith``` block',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('Abbreviation-style names with periods', () => {
    it('matches @Dr. Gregory House', async () => {
      const result = await findPersonalityMentions(
        '@Dr. Gregory House is here',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Dr. Gregory House');
    });

    it('matches @J.R.R. Tolkien', async () => {
      const result = await findPersonalityMentions(
        '@J.R.R. Tolkien wrote LOTR',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('J.R.R. Tolkien');
    });

    it('matches @Dr. Gregory House inside backticks', async () => {
      const result = await findPersonalityMentions(
        '`@Dr. Gregory House` is in the house',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Dr. Gregory House');
    });
  });

  describe('Apostrophes', () => {
    it("matches @O'Reilly", async () => {
      const result = await findPersonalityMentions(
        "@O'Reilly hello",
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe("O'Reilly");
    });

    it("matches @O'Reilly when typed with a typographic apostrophe", async () => {
      const apos = String.fromCharCode(0x2019); // U+2019 — normalized to ASCII ' to match the stored name
      const result = await findPersonalityMentions(
        `@O${apos}Reilly hello`,
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe("O'Reilly");
    });
  });

  describe('Edge cases', () => {
    it('handles empty string', async () => {
      const result = await findPersonalityMentions('', '@', mockPersonalityService, TEST_USER_ID);
      expect(result).toEqual([]);
    });

    it('handles whitespace-only string', async () => {
      const result = await findPersonalityMentions(
        '   ',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toEqual([]);
    });

    it('handles mention character only', async () => {
      const result = await findPersonalityMentions('@', '@', mockPersonalityService, TEST_USER_ID);
      expect(result).toEqual([]);
    });

    it('supports custom mention character', async () => {
      const result = await findPersonalityMentions(
        '!Lilith hi',
        '!',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Lilith');
    });

    it('does case-insensitive DB lookup but returns the loaded personality', async () => {
      const result = await findPersonalityMentions(
        '@lilith hi',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
      // Returned personality is the loaded object — canonical name from DB.
      expect(result[0].personality.name).toBe('Lilith');
    });

    it('skips unknown mentions and includes only valid ones in textual order', async () => {
      const result = await findPersonalityMentions(
        '@Unknown @Lilith @AlsoUnknown @Sarcastic',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result.map(r => r.personality.name)).toEqual(['Lilith', 'Sarcastic']);
    });

    it('skips numeric-only mentions (Discord user-ID shape)', async () => {
      const result = await findPersonalityMentions(
        '@123456 @Lilith',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Lilith');
    });

    it('skips role-mention candidates (<@&123>) without DB lookup', async () => {
      const lookupSpy = vi.spyOn(mockPersonalityService, 'loadPersonality');
      lookupSpy.mockClear();

      const result = await findPersonalityMentions(
        'hi <@&123456789> @Lilith',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Lilith');
      // The role-mention capture produces `&123456789>` (the trailing `>`
      // survives WORD_PUNCTUATION_STRIP_ALL which doesn't include it). The
      // filter regex catches both `&123` and `&123>` shapes. Verify neither
      // reaches the DB.
      const lookedUpNames = lookupSpy.mock.calls.map((c: unknown[]) => c[0]);
      expect(lookedUpNames).not.toContain('&123456789');
      expect(lookedUpNames).not.toContain('&123456789>');
    });

    it('skips channel-mention candidates (<#123>) without DB lookup', async () => {
      const lookupSpy = vi.spyOn(mockPersonalityService, 'loadPersonality');
      lookupSpy.mockClear();

      const result = await findPersonalityMentions(
        'in <#987654321> @Lilith',
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );

      // `#987654321` after the capture-strip — must not hit the DB.
      const lookedUpNames = lookupSpy.mock.calls.map((c: unknown[]) => c[0]);
      expect(lookedUpNames).not.toContain('#987654321');
      expect(result.some(r => r.personality.name === 'Lilith')).toBe(true);
    });
  });

  describe('Resource exhaustion protection', () => {
    it('caps position scanning at MAX_POTENTIAL_MENTIONS', async () => {
      // 15 @-mentions; internal position cap is 10. The mention cap further
      // narrows to MAX_TAGS=5. We assert the final cap (5).
      const noisy = Array(15).fill('@Lilith').join(' ');
      const result = await findPersonalityMentions(
        noisy,
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      // All resolve to the same personality → deduped to 1.
      expect(result).toHaveLength(1);
      expect(result[0].personality.name).toBe('Lilith');
    });

    it('handles 15 distinct mentions by capping at MAX_TAGS after dedup', async () => {
      const noisy = '@Lilith @Sarcastic @Charlie @Delta @Echo @Foxtrot @Bambi @Administrator';
      const result = await findPersonalityMentions(
        noisy,
        '@',
        mockPersonalityService,
        TEST_USER_ID
      );
      expect(result).toHaveLength(MULTI_TAG.MAX_TAGS);
    });
  });
});
