import { describe, it, expect, vi } from 'vitest';

vi.mock('@tzurot/common-types/utils/dateFormatting', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/dateFormatting')>(
    '@tzurot/common-types/utils/dateFormatting'
  );
  return {
    ...actual,
    formatMemoryTimestamp: vi.fn(() => '2 weeks ago'),
  };
});

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

vi.mock('@tzurot/common-types/utils/tokenCounter', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/tokenCounter')>(
    '@tzurot/common-types/utils/tokenCounter'
  );
  return {
    ...actual,
    countTextTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
  };
});

import { countTokens, countMemoryTokens, countAttachmentTokens } from './TokenCounters.js';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import type { ProcessedAttachment } from '../MultimodalProcessor.js';
import type { MemoryDocument } from '../ConversationalRAGTypes.js';

describe('TokenCounters', () => {
  describe('countTokens', () => {
    it('should count tokens for text', () => {
      const result = countTokens('This is a test message');
      expect(result).toBeGreaterThan(0);
      expect(typeof result).toBe('number');
    });
  });

  describe('countMemoryTokens', () => {
    it('should return 0 for empty memories', () => {
      expect(countMemoryTokens([])).toBe(0);
    });

    it('should count tokens for memories with timestamps', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'User likes pizza',
          metadata: { createdAt: new Date('2024-01-15T12:00:00Z').getTime() },
        },
        {
          pageContent: 'User dislikes spam',
          metadata: { createdAt: new Date('2024-01-20T15:30:00Z').getTime() },
        },
      ];

      const result = countMemoryTokens(memories);
      expect(result).toBeGreaterThan(0);
    });

    it('should count tokens for memories without timestamps', () => {
      const memories: MemoryDocument[] = [
        { pageContent: 'Memory without timestamp', metadata: {} },
      ];

      expect(countMemoryTokens(memories)).toBeGreaterThan(0);
    });
  });

  describe('countAttachmentTokens', () => {
    it('should return 0 for no attachments', () => {
      expect(countAttachmentTokens([])).toBe(0);
    });

    it('should count tokens from attachment descriptions', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Image,
          description: 'A beautiful sunset over the ocean',
          originalUrl: 'https://example.com/sunset.jpg',
          metadata: { url: 'https://example.com/sunset.jpg', contentType: 'image/jpeg' },
        },
      ];

      expect(countAttachmentTokens(attachments)).toBeGreaterThan(0);
    });
  });
});
