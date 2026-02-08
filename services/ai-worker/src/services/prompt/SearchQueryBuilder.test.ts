import { describe, it, expect, vi } from 'vitest';

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

import { buildSearchQuery } from './SearchQueryBuilder.js';
import type { ProcessedAttachment } from '../MultimodalProcessor.js';
import { AttachmentType } from '@tzurot/common-types';

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
});
