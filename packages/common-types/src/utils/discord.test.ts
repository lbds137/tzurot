/**
 * Tests for Discord utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  truncateText,
  splitMessage,
  stripBotFooters,
  stripDmPrefix,
  normalizeMessageForContext,
  extractMessagePrefixName,
  findLeadingMentionsEnd,
  stripLeadingMentions,
} from './discord.js';

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

    it('should strip model footer with explicit provider attribution', () => {
      const content =
        'Hello world!\n-# Model: [glm-5.2](<https://example.com>) • via Z.AI Coding Plan';
      expect(stripBotFooters(content)).toBe('Hello world!');
    });

    it('should strip model footer with provider attribution and auto badge', () => {
      const content =
        'Hello world!\n-# Model: [z-ai/glm-5.2](<https://example.com>) • via OpenRouter • 📍 auto';
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

    it('should strip transcription attribution footer', () => {
      const content =
        'Hello world!\n-# Transcribed by [Mistral](<https://mistral.ai/news/voxtral>)';
      expect(stripBotFooters(content)).toBe('Hello world!');
    });

    it('should strip standalone transcription attribution footer', () => {
      const content = '-# Transcribed by [Whisper](<https://example.com/stt>)';
      expect(stripBotFooters(content)).toBe('');
    });

    it('should strip all footer types combined', () => {
      const content =
        'Hello world!\n-# Model: [gpt-4](<https://example.com>) • 📍 auto\n-# 🆓 Using free model (no API key required)\n-# 🔒 Focus Mode • LTM retrieval disabled\n-# 👻 Incognito Mode • Memories not being saved\n-# Transcribed by [Mistral](<https://example.com/stt>)';
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

  describe('extractMessagePrefixName', () => {
    it('should extract the name from a single-word prefix', () => {
      expect(extractMessagePrefixName('**Lila:** poke')).toBe('Lila');
    });

    it('should extract a multi-word display name', () => {
      expect(extractMessagePrefixName('**Test Bot Name:** hello')).toBe('Test Bot Name');
    });

    it('should extract a name containing emoji and special characters', () => {
      expect(extractMessagePrefixName('**🌙 Luna:** moonlit')).toBe('🌙 Luna');
      expect(extractMessagePrefixName('**Test-Name_123:** x')).toBe('Test-Name_123');
    });

    it('should return null when there is no prefix', () => {
      expect(extractMessagePrefixName('just normal content')).toBeNull();
    });

    it('should return null for bold text not at the start', () => {
      expect(extractMessagePrefixName('Hello **Name:** mid')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(extractMessagePrefixName('')).toBeNull();
    });
  });

  describe('normalizeMessageForContext', () => {
    it('should strip the relay/DM prefix and bot footers together', () => {
      const content =
        '**Lila:** The actual reply.\n-# Model: [glm-5.2](<https://example/model>)\n-# 👻 Incognito Mode • Memories not being saved';
      expect(normalizeMessageForContext(content)).toBe('The actual reply.');
    });

    it('should strip the transcription footer along with the rest', () => {
      const content = '**Adam:** Heard you.\n-# Transcribed by [Mistral](<https://example/stt>)';
      expect(normalizeMessageForContext(content)).toBe('Heard you.');
    });

    it('should be a no-op for plain content with neither prefix nor footer', () => {
      const content = 'Just a normal message.';
      expect(normalizeMessageForContext(content)).toBe(content);
    });

    it('should strip footers even when there is no prefix', () => {
      const content = 'Reply text\n-# Model: [m](<u>)';
      expect(normalizeMessageForContext(content)).toBe('Reply text');
    });
  });

  describe('findLeadingMentionsEnd', () => {
    it('returns 0 for text with no leading mention', () => {
      expect(findLeadingMentionsEnd('plain text here')).toBe(0);
    });

    it('skips leading text-form @mention + whitespace', () => {
      const input = '@Bot hello';
      expect(findLeadingMentionsEnd(input)).toBe('@Bot '.length);
    });

    it('skips Discord user mention <@id> + whitespace', () => {
      const input = '<@123456789012345678> hello';
      expect(findLeadingMentionsEnd(input)).toBe('<@123456789012345678> '.length);
    });

    it('skips Discord nickname user mention <@!id> + whitespace', () => {
      const input = '<@!123456789012345678> hello';
      expect(findLeadingMentionsEnd(input)).toBe('<@!123456789012345678> '.length);
    });

    it('skips Discord role mention <@&id>', () => {
      const input = '<@&987654321098765432> hello';
      expect(findLeadingMentionsEnd(input)).toBe('<@&987654321098765432> '.length);
    });

    it('skips Discord channel mention <#id>', () => {
      const input = '<#111222333444555666> hello';
      expect(findLeadingMentionsEnd(input)).toBe('<#111222333444555666> '.length);
    });

    it('skips multiple stacked mentions of mixed types', () => {
      const input = '@Bot <@123456789012345678> <@&987654321098765432> <#111222333444555666> hi';
      expect(findLeadingMentionsEnd(input)).toBe(input.length - 'hi'.length);
    });

    it('respects optional `from` start index', () => {
      const input = 'prefix ignored @Bot hello';
      expect(findLeadingMentionsEnd(input, 'prefix ignored '.length)).toBe(
        'prefix ignored @Bot '.length
      );
    });

    it('does not skip mentions that appear mid-string', () => {
      const input = 'hello @Bot world';
      expect(findLeadingMentionsEnd(input)).toBe(0);
    });

    it('skips leading whitespace before first mention', () => {
      const input = '   @Bot hello';
      expect(findLeadingMentionsEnd(input)).toBe('   @Bot '.length);
    });
  });

  describe('stripLeadingMentions', () => {
    it('removes a single text-form mention', () => {
      expect(stripLeadingMentions('@Bot hello')).toBe('hello');
    });

    it('removes a single Discord numeric mention', () => {
      expect(stripLeadingMentions('<@123456789012345678> hello')).toBe('hello');
    });

    it('removes stacked mentions of mixed types', () => {
      expect(stripLeadingMentions('@Bot <@&987654321098765432> <#111222333444555666> hi')).toBe(
        'hi'
      );
    });

    it('returns input unchanged when no leading mention', () => {
      expect(stripLeadingMentions('plain text')).toBe('plain text');
    });

    it('handles empty string', () => {
      expect(stripLeadingMentions('')).toBe('');
    });
  });
});

describe('splitMessage — fence rebalancing (oversized code blocks)', () => {
  it('re-balances fences when a single block exceeds maxLength', () => {
    // One fenced block far over the limit: the fallback re-split cuts it,
    // and rebalancing must close/re-open the fence at every boundary.
    const code = Array.from({ length: 120 }, (_, i) => `const line${i} = ${i};`).join('\n');
    const content = 'intro text\n\n```ts\n' + code + '\n```\n\ntail text';

    const chunks = splitMessage(content, 500);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
      // Every chunk renders valid markdown on its own: balanced fences
      expect((chunk.match(/```/g) ?? []).length % 2).toBe(0);
    }
    // The language tag carries into continuation chunks
    const fenced = chunks.filter(c => c.includes('```'));
    expect(fenced.length).toBeGreaterThan(1);
    for (const chunk of fenced.slice(1)) {
      expect(chunk.startsWith('```ts')).toBe(true);
    }
  });

  it('re-synchronizes across TWO independent oversized blocks with prose between', () => {
    // The rebalancer threads open-fence state across the whole chunk array —
    // the second block's chunks must start fresh, not inherit the first's tag.
    const codeA = Array.from({ length: 80 }, (_, i) => `alpha_${i}();`).join('\n');
    const codeB = Array.from({ length: 80 }, (_, i) => `beta_${i}();`).join('\n');
    const content =
      '```ts\n' +
      codeA +
      '\n```\n\nplain prose between the blocks\n\n```python\n' +
      codeB +
      '\n```';

    const chunks = splitMessage(content, 400);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(400);
      expect((chunk.match(/```/g) ?? []).length % 2).toBe(0);
    }
    // Continuations carry the CORRECT tag per block — no cross-contamination
    const tsContinuations = chunks.filter(c => c.startsWith('```ts') && c.includes('alpha_'));
    const pyContinuations = chunks.filter(c => c.startsWith('```python') && c.includes('beta_'));
    expect(tsContinuations.length).toBeGreaterThan(0);
    expect(pyContinuations.length).toBeGreaterThan(0);
    expect(chunks.some(c => c.startsWith('```ts') && c.includes('beta_'))).toBe(false);
  });

  it('leaves already-fitting fenced blocks untouched (no spurious markers)', () => {
    const content = 'before\n\n```js\nconst x = 1;\n```\n\nafter '.repeat(1) + 'y'.repeat(300);
    const chunks = splitMessage(content, 2000);
    expect(chunks.join('')).toContain('```js\nconst x = 1;\n```');
  });

  it('does NOT add phantom fences to an unsplit message with a stray odd backtick run', () => {
    // A real fenced block plus prose that MENTIONS ``` (unpaired): the
    // message fits in one chunk, so the splitter must return it byte-exact —
    // parity-counting across untouched chunks would append a phantom fence.
    const content = '```js\nconsole.log(1);\n``` Use triple backtick ``` to start a fence.';

    const chunks = splitMessage(content, 2000);

    expect(chunks).toEqual([content]);
  });

  it('does NOT inject fence-open prefixes into later chunks after a stray backtick run', () => {
    // Multi-chunk message where an early, never-force-split chunk carries an
    // odd ``` count: subsequent chunks must come through unprefixed.
    const strayPara = 'to open a block type ``` followed by a language tag';
    const filler = Array.from({ length: 30 }, (_, i) => `paragraph ${i} ` + 'x'.repeat(50)).join(
      '\n\n'
    );
    const content = '```js\nconst a = 1;\n```\n\n' + strayPara + '\n\n' + filler;

    const chunks = splitMessage(content, 400);

    expect(chunks.length).toBeGreaterThan(1);
    // No chunk gains a fence-open prefix it didn't have in the source
    for (const chunk of chunks.slice(1)) {
      expect(chunk.startsWith('```') && !content.includes(chunk)).toBe(false);
    }
    expect(chunks.join('\n\n')).toContain(strayPara);
  });

  it('terminates on unsplittable input with a tiny maxLength (splitLongWord guard)', () => {
    const chunks = splitMessage('x'.repeat(100), 8);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('').replace(/\.\.\./g, '')).toHaveLength(100);
  });
});
