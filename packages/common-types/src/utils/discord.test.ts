/**
 * Tests for Discord utility functions
 */

import { describe, it, expect } from 'vitest';
import { truncateText, splitMessage, stripBotFooters, stripDmPrefix } from './discord.js';

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

    it('should handle maxLength = 0', () => {
      expect(truncateText('Hello', 0)).toBe('');
    });

    it('should handle negative maxLength', () => {
      expect(truncateText('Hello', -1)).toBe('');
      expect(truncateText('Hello', -100)).toBe('');
    });

    it('should handle NaN maxLength', () => {
      expect(truncateText('Hello', NaN)).toBe('');
    });

    it('should handle Infinity maxLength', () => {
      expect(truncateText('Hello', Infinity)).toBe('');
    });

    it('should handle floating point maxLength (floors to integer)', () => {
      expect(truncateText('Hello World', 8.9)).toBe('Hello W…');
      expect(truncateText('Hello', 5.1)).toBe('Hello');
    });

    it('should handle non-string ellipsis defensively', () => {
      expect(truncateText('Hello World', 8, null as unknown as string)).toBe('Hello W…');
      expect(truncateText('Hello World', 8, undefined as unknown as string)).toBe('Hello W…');
      expect(truncateText('Hello World', 8, 123 as unknown as string)).toBe('Hello W…');
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

    it('should split multi-paragraph content at paragraph boundaries', () => {
      const content = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const result = splitMessage(content, 30);
      // Should split at paragraph boundaries when possible
      expect(result.length).toBeGreaterThan(1);
      // Each chunk should be within limit
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(30);
      });
    });

    it('should handle code blocks that exceed max length', () => {
      const longCode = '```javascript\n' + 'console.log("test");'.repeat(150) + '\n```';
      expect(longCode.length).toBeGreaterThan(2000);
      const result = splitMessage(longCode);
      expect(result.length).toBeGreaterThan(1);
      // All chunks should be within Discord's limit
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      });
    });

    it('should handle mixed content with code blocks and paragraphs', () => {
      const content = `Here is some text before the code.

\`\`\`javascript
function hello() {
  console.log("Hello World");
}
\`\`\`

And here is some text after the code block.

Another paragraph here with more content.`;
      const result = splitMessage(content, 100);
      expect(result.length).toBeGreaterThan(1);
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(100);
      });
    });

    it('should preserve small code blocks intact when possible', () => {
      const content = 'Text before.\n\n```\nsmall code\n```\n\nText after.';
      const result = splitMessage(content, 100);
      // Code block should remain intact in one of the chunks
      const hasCodeBlock = result.some(chunk => chunk.includes('```\nsmall code\n```'));
      expect(hasCodeBlock).toBe(true);
    });

    it('should handle very long words (like URLs)', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(100);
      const content = `Check this link: ${longUrl} for more info.`;
      const result = splitMessage(content, 50);
      expect(result.length).toBeGreaterThan(1);
      // Should not crash and should produce valid chunks
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(50);
      });
    });

    it('should handle sentence boundary splitting', () => {
      const content = 'First sentence. Second sentence. Third sentence. Fourth sentence.';
      const result = splitMessage(content, 40);
      expect(result.length).toBeGreaterThan(1);
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(40);
      });
    });
  });

  describe('stripBotFooters', () => {
    it('should strip model footer', () => {
      const content =
        'Hello world!\n-# Model: [meta-llama/llama-3.3-70b-instruct:free](<https://openrouter.ai/meta-llama/llama-3.3-70b-instruct:free>)';
      expect(stripBotFooters(content)).toBe('Hello world!');
    });

    it('should strip model footer with auto badge', () => {
      const content = 'Hello world!\n-# Model: [claude-3](<https://example.com>) • 📍 auto';
      expect(stripBotFooters(content)).toBe('Hello world!');
    });

    it('should strip guest mode footer', () => {
      const content = 'Hello world!\n-# 🆓 Using free model (no API key required)';
      expect(stripBotFooters(content)).toBe('Hello world!');
    });

    it('should strip auto-response footer', () => {
      const content = 'Hello world!\n-# 📍 auto-response';
      expect(stripBotFooters(content)).toBe('Hello world!');
    });

    it('should strip combined model + guest mode footers', () => {
      const content =
        'Hello world!\n-# Model: [grok-4.1-fast:free](<https://example.com>)\n-# 🆓 Using free model (no API key required)';
      expect(stripBotFooters(content)).toBe('Hello world!');
    });

    it('should strip model + auto + guest mode footers', () => {
      const content =
        'Hello world!\n-# Model: [model](<url>) • 📍 auto\n-# 🆓 Using free model (no API key required)';
      expect(stripBotFooters(content)).toBe('Hello world!');
    });

    it('should NOT strip user -# formatting in content', () => {
      const content = 'Hello\n-# This is small text from user\n\nMore content';
      expect(stripBotFooters(content)).toBe(content);
    });

    it('should NOT strip -# in middle of message', () => {
      const content = 'Start\n-# User subheading\n\nEnd';
      expect(stripBotFooters(content)).toBe(content);
    });

    it('should return unchanged content with no footers', () => {
      const content = 'Just regular content';
      expect(stripBotFooters(content)).toBe(content);
    });

    it('should strip standalone model footer (entire message is footer)', () => {
      const content =
        '-# Model: [deepseek/deepseek-r1-0528:free](<https://openrouter.ai/deepseek/deepseek-r1-0528:free>) • 📍 auto';
      expect(stripBotFooters(content)).toBe('');
    });

    it('should strip standalone guest mode footer', () => {
      const content = '-# 🆓 Using free model (no API key required)';
      expect(stripBotFooters(content)).toBe('');
    });

    it('should strip standalone auto-response footer', () => {
      const content = '-# 📍 auto-response';
      expect(stripBotFooters(content)).toBe('');
    });

    it('should strip focus mode footer', () => {
      const content = 'Hello world!\n-# 🔒 Focus Mode • LTM retrieval disabled';
      expect(stripBotFooters(content)).toBe('Hello world!');
    });

    it('should strip incognito mode footer', () => {
      const content = 'Hello world!\n-# 👻 Incognito Mode • Memories not being saved';
      expect(stripBotFooters(content)).toBe('Hello world!');
    });

    it('should strip standalone focus mode footer', () => {
      const content = '-# 🔒 Focus Mode • LTM retrieval disabled';
      expect(stripBotFooters(content)).toBe('');
    });

    it('should strip standalone incognito mode footer', () => {
      const content = '-# 👻 Incognito Mode • Memories not being saved';
      expect(stripBotFooters(content)).toBe('');
    });

    it('should strip all footer types combined', () => {
      const content =
        'Hello world!\n-# Model: [gpt-4](<https://example.com>) • 📍 auto\n-# 🆓 Using free model (no API key required)\n-# 🔒 Focus Mode • LTM retrieval disabled\n-# 👻 Incognito Mode • Memories not being saved';
      expect(stripBotFooters(content)).toBe('Hello world!');
    });
  });

  describe('stripDmPrefix', () => {
    it('should strip DM personality prefix', () => {
      const content = '**Lilith:** Hello, my daughter.';
      expect(stripDmPrefix(content)).toBe('Hello, my daughter.');
    });

    it('should strip DM prefix with multi-word display name', () => {
      const content = '**Test Bot Name:** Some response here.';
      expect(stripDmPrefix(content)).toBe('Some response here.');
    });

    it('should handle content without DM prefix', () => {
      const content = 'Just normal content without any prefix.';
      expect(stripDmPrefix(content)).toBe(content);
    });

    it('should not strip bold text that is not a prefix', () => {
      const content = 'Some text with **bold** in the middle.';
      expect(stripDmPrefix(content)).toBe(content);
    });

    it('should not strip prefix if not at start of content', () => {
      const content = 'Hello **Name:** this is not a prefix.';
      expect(stripDmPrefix(content)).toBe(content);
    });

    it('should handle prefix with special characters in name', () => {
      const content = '**Test-Name_123:** Response content.';
      expect(stripDmPrefix(content)).toBe('Response content.');
    });

    it('should handle prefix with emoji in name', () => {
      const content = '**🌙 Luna:** Moonlit response.';
      expect(stripDmPrefix(content)).toBe('Moonlit response.');
    });

    it('should preserve content after prefix', () => {
      const content = '**Selah:** *I lean in closer.*\n\nThe night whispers secrets.';
      expect(stripDmPrefix(content)).toBe('*I lean in closer.*\n\nThe night whispers secrets.');
    });

    it('should handle empty string', () => {
      expect(stripDmPrefix('')).toBe('');
    });

    it('should handle prefix-only content', () => {
      const content = '**Name:** ';
      expect(stripDmPrefix(content)).toBe('');
    });
  });
});
