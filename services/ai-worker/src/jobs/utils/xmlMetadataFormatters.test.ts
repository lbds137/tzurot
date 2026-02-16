/**
 * XML Metadata Formatters Tests
 *
 * Tests for formatting message metadata (quotes, images, embeds, voice, reactions)
 * as XML sections within conversation history.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  formatQuotedSection,
  formatImageSection,
  formatEmbedsSection,
  formatVoiceSection,
  formatReactionsSection,
} from './xmlMetadataFormatters.js';
import type { RawHistoryEntry } from './conversationTypes.js';

// Mock common-types
vi.mock('@tzurot/common-types', () => ({
  escapeXml: (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  escapeXmlContent: (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  formatPromptTimestamp: (ts: string) => `formatted:${ts}`,
}));

// Mock QuoteFormatter - pass through to real implementation for structural tests
const { mockFormatQuoteElement, mockFormatDedupedQuote } = vi.hoisted(() => {
  const fqe = vi.fn().mockImplementation((opts: Record<string, unknown>) => {
    const attrs: string[] = [];
    if (opts.type !== undefined) attrs.push(`type="${opts.type}"`);
    if (opts.from !== undefined) attrs.push(`from="${opts.from}"`);
    if (opts.fromId !== undefined) attrs.push(`from_id="${opts.fromId}"`);
    if (opts.role !== undefined) attrs.push(`role="${opts.role}"`);
    if (opts.timeFormatted !== undefined) attrs.push(`t="${opts.timeFormatted}"`);
    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

    const parts = [`<quote${attrStr}>`];
    if (opts.content !== undefined) parts.push(`<content>${opts.content}</content>`);
    if (opts.imageDescriptions !== undefined) {
      const imgs = opts.imageDescriptions as { filename: string; description: string }[];
      parts.push('<image_descriptions>');
      for (const img of imgs) {
        parts.push(`<image filename="${img.filename}">${img.description}</image>`);
      }
      parts.push('</image_descriptions>');
    }
    if (opts.attachmentLines !== undefined) {
      const lines = opts.attachmentLines as string[];
      parts.push('<attachments>');
      parts.push(...lines);
      parts.push('</attachments>');
    }
    parts.push('</quote>');
    return parts.join('\n');
  });

  const fdq = vi
    .fn()
    .mockImplementation((opts: { from: string; timeFormatted?: string; content: string }) => {
      const truncated =
        opts.content.length > 100 ? opts.content.substring(0, 100) + '...' : opts.content;
      return fqe({
        from: opts.from,
        timeFormatted: opts.timeFormatted,
        content: `[Reply target — full message is in conversation above]\n\n${truncated}`,
      });
    });

  return { mockFormatQuoteElement: fqe, mockFormatDedupedQuote: fdq };
});

vi.mock('../../services/prompt/QuoteFormatter.js', () => ({
  formatQuoteElement: mockFormatQuoteElement,
  formatDedupedQuote: mockFormatDedupedQuote,
}));

function makeEntry(overrides: Partial<RawHistoryEntry> = {}): RawHistoryEntry {
  return {
    role: 'user',
    content: 'Test message',
    ...overrides,
  } as RawHistoryEntry;
}

describe('xmlMetadataFormatters', () => {
  describe('formatQuotedSection', () => {
    const personalityName = 'TestBot';

    it('returns empty string for non-user role', () => {
      const msg = makeEntry({
        role: 'assistant',
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: '123',
              authorUsername: 'user1',
              authorDisplayName: 'User One',
              content: 'Hello',
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
            },
          ],
        },
      });

      const result = formatQuotedSection(msg, 'assistant', personalityName, undefined, undefined);
      expect(result).toBe('');
    });

    it('returns empty string when no referencedMessages', () => {
      const msg = makeEntry();
      const result = formatQuotedSection(msg, 'user', personalityName, undefined, undefined);
      expect(result).toBe('');
    });

    it('formats a basic referenced message', () => {
      const msg = makeEntry({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: '123',
              authorUsername: 'user1',
              authorDisplayName: 'User One',
              content: 'Quoted text',
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
            },
          ],
        },
      });

      const result = formatQuotedSection(msg, 'user', personalityName, undefined, undefined);
      expect(result).toContain('<quoted_messages>');
      expect(result).toContain('from="User One"');
      expect(result).toContain('role="user"');
      expect(result).toContain('</quoted_messages>');
    });

    it('uses hydrated persona name over display name', () => {
      const msg = makeEntry({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: '123',
              authorUsername: 'user1',
              authorDisplayName: 'Long Discord Name · Extra',
              content: 'Hello',
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
              resolvedPersonaName: 'Lila',
              resolvedPersonaId: 'persona-uuid-123',
            },
          ],
        },
      });

      const result = formatQuotedSection(msg, 'user', personalityName, undefined, undefined);
      expect(result).toContain('from="Lila"');
      expect(result).toContain('from_id="persona-uuid-123"');
      expect(result).not.toContain('Long Discord Name');
    });

    it('renders hydrated image descriptions', () => {
      const msg = makeEntry({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: '123',
              authorUsername: 'user1',
              authorDisplayName: 'User One',
              content: 'Check this image',
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
              attachments: [
                {
                  id: 'att-1',
                  url: 'https://cdn.discord.com/img.png',
                  contentType: 'image/png',
                  name: 'photo.png',
                },
              ],
              resolvedImageDescriptions: [
                { filename: 'photo.png', description: 'A sunset over the ocean' },
              ],
            },
          ],
        },
      });

      const result = formatQuotedSection(msg, 'user', personalityName, undefined, undefined);
      expect(result).toContain('<image_descriptions>');
      expect(result).toContain('filename="photo.png"');
      expect(result).toContain('A sunset over the ocean');
      // Image attachments should NOT appear in attachmentLines
      expect(result).not.toContain('[image/png: photo.png]');
    });

    it('shows non-image attachments alongside image descriptions', () => {
      const msg = makeEntry({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: '123',
              authorUsername: 'user1',
              authorDisplayName: 'User One',
              content: 'Mixed attachments',
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
              attachments: [
                {
                  id: 'att-1',
                  url: 'https://cdn.discord.com/img.png',
                  contentType: 'image/png',
                  name: 'photo.png',
                },
                {
                  id: 'att-2',
                  url: 'https://cdn.discord.com/doc.pdf',
                  contentType: 'application/pdf',
                  name: 'doc.pdf',
                },
              ],
              resolvedImageDescriptions: [{ filename: 'photo.png', description: 'A cat' }],
            },
          ],
        },
      });

      const result = formatQuotedSection(msg, 'user', personalityName, undefined, undefined);
      // Image description rendered
      expect(result).toContain('A cat');
      // Non-image attachment shown in attachmentLines
      expect(result).toContain('[application/pdf: doc.pdf]');
      // Image attachment NOT in attachmentLines
      expect(result).not.toContain('[image/png: photo.png]');
    });

    it('shows all attachments as lines when no image descriptions hydrated', () => {
      const msg = makeEntry({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: '123',
              authorUsername: 'user1',
              authorDisplayName: 'User One',
              content: 'Attachments',
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
              attachments: [
                {
                  id: 'att-1',
                  url: 'https://cdn.discord.com/img.png',
                  contentType: 'image/png',
                  name: 'photo.png',
                },
              ],
            },
          ],
        },
      });

      const result = formatQuotedSection(msg, 'user', personalityName, undefined, undefined);
      // Without hydrated descriptions, images show as attachment lines
      expect(result).toContain('[image/png: photo.png]');
    });

    it('renders deduped stubs for refs whose discordMessageId is in history', () => {
      const msg = makeEntry({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: 'already-in-history',
              authorUsername: 'user1',
              authorDisplayName: 'User One',
              content: 'Duplicated message that is in history',
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
            },
          ],
        },
      });

      const historyIds = new Set(['already-in-history']);
      const result = formatQuotedSection(msg, 'user', personalityName, historyIds, undefined);
      expect(result).toContain('<quoted_messages>');
      expect(result).toContain('[Reply target — full message is in conversation above]');
      expect(result).toContain('Duplicated message that is in history');
      expect(result).toContain('from="User One"');
    });

    it('truncates long content in deduped stubs to ~100 chars', () => {
      const longContent = 'X'.repeat(200);
      const msg = makeEntry({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: 'in-history',
              authorUsername: 'user1',
              authorDisplayName: 'User One',
              content: longContent,
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
            },
          ],
        },
      });

      const historyIds = new Set(['in-history']);
      const result = formatQuotedSection(msg, 'user', personalityName, historyIds, undefined);
      // Should contain truncated content with '...'
      expect(result).toContain('X'.repeat(100) + '...');
      expect(result).not.toContain('X'.repeat(101));
    });

    it('renders both full refs and deduped stubs together', () => {
      const msg = makeEntry({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: 'in-history',
              authorUsername: 'user1',
              authorDisplayName: 'User One',
              content: 'In history',
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
            },
            {
              discordMessageId: 'not-in-history',
              authorUsername: 'user2',
              authorDisplayName: 'User Two',
              content: 'Not in history',
              timestamp: '2026-01-01T00:01:00.000Z',
              locationContext: '',
            },
          ],
        },
      });

      const historyIds = new Set(['in-history']);
      const result = formatQuotedSection(msg, 'user', personalityName, historyIds, undefined);
      expect(result).toContain('<quoted_messages>');
      // Full ref for User Two
      expect(result).toContain('from="User Two"');
      expect(result).toContain('Not in history');
      // Deduped stub for User One
      expect(result).toContain('[Reply target — full message is in conversation above]');
      expect(result).toContain('In history');
    });

    it('detects assistant role via personality name', () => {
      const msg = makeEntry({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: '123',
              authorUsername: 'testbot',
              authorDisplayName: 'TestBot',
              content: 'I am the bot',
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
            },
          ],
        },
      });

      const result = formatQuotedSection(msg, 'user', personalityName, undefined, undefined);
      expect(result).toContain('role="assistant"');
    });
  });

  describe('formatImageSection', () => {
    it('returns empty string when no imageDescriptions', () => {
      const msg = makeEntry();
      expect(formatImageSection(msg)).toBe('');
    });

    it('returns empty string for empty array', () => {
      const msg = makeEntry({ messageMetadata: { imageDescriptions: [] } });
      expect(formatImageSection(msg)).toBe('');
    });

    it('formats image descriptions', () => {
      const msg = makeEntry({
        messageMetadata: {
          imageDescriptions: [{ filename: 'cat.jpg', description: 'A fluffy cat' }],
        },
      });
      const result = formatImageSection(msg);
      expect(result).toContain('<image_descriptions>');
      expect(result).toContain('filename="cat.jpg"');
      expect(result).toContain('A fluffy cat');
    });
  });

  describe('formatEmbedsSection', () => {
    it('returns empty string when no embedsXml', () => {
      const msg = makeEntry();
      expect(formatEmbedsSection(msg)).toBe('');
    });

    it('formats embeds', () => {
      const msg = makeEntry({
        messageMetadata: { embedsXml: ['<embed>test</embed>'] },
      });
      const result = formatEmbedsSection(msg);
      expect(result).toContain('<embeds>');
      expect(result).toContain('<embed>test</embed>');
    });
  });

  describe('formatVoiceSection', () => {
    it('returns empty string when no voiceTranscripts', () => {
      const msg = makeEntry();
      expect(formatVoiceSection(msg)).toBe('');
    });

    it('formats voice transcripts', () => {
      const msg = makeEntry({
        messageMetadata: { voiceTranscripts: ['Hello, this is a test'] },
      });
      const result = formatVoiceSection(msg);
      expect(result).toContain('<voice_transcripts>');
      expect(result).toContain('<transcript>Hello, this is a test</transcript>');
    });
  });

  describe('formatReactionsSection', () => {
    it('returns empty string when no reactions', () => {
      const msg = makeEntry();
      expect(formatReactionsSection(msg)).toBe('');
    });

    it('formats reactions with persona IDs', () => {
      const msg = makeEntry({
        messageMetadata: {
          reactions: [
            {
              emoji: '👍',
              reactors: [{ personaId: 'p1', displayName: 'Alice' }],
            },
          ],
        },
      });
      const result = formatReactionsSection(msg);
      expect(result).toContain('<reactions>');
      expect(result).toContain('from="Alice"');
      expect(result).toContain('from_id="p1"');
    });

    it('marks custom emoji', () => {
      const msg = makeEntry({
        messageMetadata: {
          reactions: [
            {
              emoji: ':custom:',
              isCustom: true,
              reactors: [{ personaId: 'p1', displayName: 'Bob' }],
            },
          ],
        },
      });
      const result = formatReactionsSection(msg);
      expect(result).toContain('custom="true"');
    });
  });
});
