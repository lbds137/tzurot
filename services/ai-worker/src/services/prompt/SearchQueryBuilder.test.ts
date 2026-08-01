import { describe, it, expect, vi } from 'vitest';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('../RAGUtils.js', () => ({
  extractContentDescriptions: vi.fn((attachments: unknown[]) =>
    attachments.map(() => 'attachment description').join('\n')
  ),
}));

import { buildSearchQuery, describeParts, type QueryPart } from './SearchQueryBuilder.js';
import type { ProcessedAttachment } from '../MultimodalProcessor.js';
import { AttachmentType } from '@tzurot/common-types/constants/media';

function makeAttachment(overrides = {}): ProcessedAttachment {
  return {
    type: AttachmentType.Image,
    description: 'An image of a cat',
    originalUrl: 'https://example.com/cat.png',
    metadata: { url: 'https://example.com/cat.png', contentType: 'image/png' },
    ...overrides,
  };
}

describe('SearchQueryBuilder', () => {
  describe('buildSearchQuery', () => {
    it('should return user message as query', () => {
      const result = buildSearchQuery('Tell me about cats', []);
      expect(result).toBe('Tell me about cats');
    });

    it('should prepend recent history window before user message', () => {
      const result = buildSearchQuery('What was that?', [], undefined, 'We were discussing cats');
      expect(result).toContain('We were discussing cats');
      expect(result).toContain('What was that?');
      expect(result.indexOf('We were discussing cats')).toBeLessThan(
        result.indexOf('What was that?')
      );
    });

    it('should include attachment descriptions', () => {
      const result = buildSearchQuery('Look at this', [makeAttachment()]);
      expect(result).toContain('attachment description');
      expect(result).toContain('Look at this');
    });

    it('should include referenced message content', () => {
      const result = buildSearchQuery('What about this?', [], 'Referenced: some old message');
      expect(result).toContain('Referenced: some old message');
    });

    it('should skip "Hello" fallback user message', () => {
      const result = buildSearchQuery('Hello', [makeAttachment()]);
      expect(result).not.toContain('Hello');
      expect(result).toContain('attachment description');
    });

    it('should return "Hello" if nothing else is available', () => {
      const result = buildSearchQuery('Hello', []);
      expect(result).toBe('Hello');
    });

    it('should return "Hello" for whitespace-only message', () => {
      const result = buildSearchQuery('  ', []);
      expect(result).toBe('Hello');
    });

    it('should combine all parts with double newlines', () => {
      const result = buildSearchQuery(
        'Tell me about cats',
        [makeAttachment()],
        'Ref: old msg',
        'Recent: context'
      );
      const parts = result.split('\n\n');
      expect(parts.length).toBe(4);
    });
  });

  describe('describeParts', () => {
    // The offsets exist to make STARVATION legible — a part whose offset already
    // exceeds the embedder window contributed nothing to the vector. An off-by-one
    // here would misreport which part got starved, so the offsets are checked
    // against the joined string itself rather than against expected numbers.
    it('reports offsets that index back into the joined query', () => {
      const parts: QueryPart[] = [
        { name: 'userMessage', text: 'sapphic yearning' },
        { name: 'attachmentDescriptions', text: 'This image depicts a gym.' },
        { name: 'referencedMessages', text: 'Ref: the earlier thing' },
      ];
      const query = parts.map(p => p.text).join('\n\n');

      for (const described of describeParts(parts)) {
        const slice = query.slice(described.offset, described.offset + described.chars);
        expect(slice).toBe(parts.find(p => p.name === described.name)?.text);
      }
    });

    it('starts the first part at zero and counts the separator between parts', () => {
      const described = describeParts([
        { name: 'a', text: 'xxxx' },
        { name: 'b', text: 'yy' },
      ]);

      expect(described).toEqual([
        { name: 'a', chars: 4, offset: 0 },
        // 4 chars + the 2-char '\n\n' separator
        { name: 'b', chars: 2, offset: 6 },
      ]);
    });

    it('places a starved part past the embedder window when an earlier part is long', () => {
      // The prod shape: a long image description ahead of the references. The
      // reference part's offset alone shows it never reached the model.
      const described = describeParts([
        { name: 'userMessage', text: 'short question' },
        { name: 'attachmentDescriptions', text: 'x'.repeat(8000) },
        { name: 'referencedMessages', text: 'the reference that never lands' },
      ]);

      const references = described[2];
      // ~4 chars/token measured on real traffic, so 512 tokens is ~2k chars.
      expect(references.offset).toBeGreaterThan(512 * 4);
    });
  });
});
