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
vi.mock('@tzurot/common-types/utils/dateFormatting', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/dateFormatting')>(
    '@tzurot/common-types/utils/dateFormatting'
  );
  return {
    ...actual,
    formatPromptTimestamp: (ts: string) => `formatted:${ts}`,
  };
});

vi.mock('@tzurot/common-types/utils/promptSanitizer', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/promptSanitizer')>(
    '@tzurot/common-types/utils/promptSanitizer'
  );
  return {
    ...actual,
    escapeXmlContent: (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  };
});

vi.mock('@tzurot/common-types/utils/referenceEnrichment', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/utils/referenceEnrichment')
  >('@tzurot/common-types/utils/referenceEnrichment');
  return {
    ...actual,
    capDedupText: (text: string) => (text.length > 100 ? text.substring(0, 100) + '...' : text),
  };
});

vi.mock('@tzurot/common-types/utils/xmlBuilder', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/xmlBuilder')>(
    '@tzurot/common-types/utils/xmlBuilder'
  );
  return {
    ...actual,
    escapeXml: (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  };
});

// Spies that DELEGATE to the real QuoteFormatter rather than reimplementing it.
//
// Their predecessors were hand-written stand-ins that rebuilt the <quote> element
// from scratch — a second renderer, kept in sync by hand, in the test suite for
// the bug class that is exactly "renderers kept in sync by hand". It failed the
// way that always fails: the stub dropped a field the real function rendered, and
// the suite went blind to the very drop it was meant to catch (fixed once by
// bolting `imageDescriptions` onto the stub, which bought one field and left the
// next one just as exposed).
//
// Delegating keeps the call-argument assertions — the seam this suite verifies is
// what `formatQuotedSection` HANDS the renderer — while the rendering itself is
// the production code's, so it cannot drift.
const { mockFormatQuoteElement, mockFormatDedupedQuote } = vi.hoisted(() => ({
  mockFormatQuoteElement: vi.fn(),
  mockFormatDedupedQuote: vi.fn(),
}));

vi.mock('../../services/prompt/QuoteFormatter.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/prompt/QuoteFormatter.js')>(
    '../../services/prompt/QuoteFormatter.js'
  );
  mockFormatQuoteElement.mockImplementation(actual.formatQuoteElement);
  mockFormatDedupedQuote.mockImplementation(actual.formatDedupedQuote);
  return {
    ...actual,
    formatQuoteElement: mockFormatQuoteElement,
    formatDedupedQuote: mockFormatDedupedQuote,
  };
});

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
      expect(result).toContain(
        '<image filename="photo.png" type="image/png">A sunset over the ocean</image>'
      );
      // ONE element for the image, not a description plus a separate marker.
      expect(result).not.toContain('[image/png: photo.png]');
      expect(result.match(/<image /g)).toHaveLength(1);
    });

    it('keeps an undescribed image visible when a sibling image IS described', () => {
      // Partial vision resolution: two images, one describe succeeded and one
      // failed. Failures are never persisted (visionDescriptionWriter), so the
      // stored row carries one description for two images. The undescribed one
      // must not vanish — that silent invisibility is the class this path fixed.
      const msg = makeEntry({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: '123',
              authorUsername: 'user1',
              authorDisplayName: 'User One',
              content: 'two images',
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
              attachments: [
                {
                  id: 'att-1',
                  url: 'https://cdn.discord.com/described.png',
                  contentType: 'image/png',
                  name: 'described.png',
                },
                {
                  id: 'att-2',
                  url: 'https://cdn.discord.com/undescribed.png',
                  contentType: 'image/png',
                  name: 'undescribed.png',
                },
              ],
              resolvedImageDescriptions: [
                { filename: 'described.png', description: 'A sunset over the ocean' },
              ],
            },
          ],
        },
      });

      const result = formatQuotedSection(msg, 'user', personalityName, undefined, undefined);

      // The described one carries its description...
      expect(result).toContain(
        '<image filename="described.png" type="image/png">A sunset over the ocean</image>'
      );
      // ...and the undescribed one is still present, saying why it is bare.
      expect(result).toContain(
        '<image filename="undescribed.png" type="image/png" status="undescribed"/>'
      );
      // Exactly two elements for two images — no duplicate representation.
      expect(result.match(/<image /g)).toHaveLength(2);
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
      // Both modalities render, under the one wrapper.
      expect(result).toContain('<image filename="photo.png" type="image/png">A cat</image>');
      expect(result).toContain('<file filename="doc.pdf" type="application/pdf"/>');
      expect(result).not.toContain('[image/png: photo.png]');
    });

    it('still names an image when no description was hydrated at all', () => {
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
      // Without a hydrated description the image is still named, with the reason
      // it has no text — rather than being omitted or rendered as a bare marker.
      expect(result).toContain(
        '<image filename="photo.png" type="image/png" status="undescribed"/>'
      );
    });

    it('classifies audio exactly as the live path does', () => {
      // Regression: the stored path used to treat ANY `audio/*` as a voice
      // message while the live path required `isVoiceMessage`. The same music
      // clip therefore rendered `<file/>` in the turn it was posted and
      // `<voice status="untranscribed"/>` when replayed from history — the same
      // object speaking two vocabularies depending on which path reached it,
      // which is the split this whole change removes. Both now call
      // `classifyAttachment`; this pins that they agree.
      const msg = makeEntry({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: '123',
              authorUsername: 'user1',
              authorDisplayName: 'User One',
              content: 'audio',
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
              attachments: [
                {
                  id: 'att-1',
                  url: 'https://cdn.discord.com/song.mp3',
                  contentType: 'audio/mp3',
                  name: 'song.mp3',
                },
                {
                  id: 'att-2',
                  url: 'https://cdn.discord.com/note.ogg',
                  contentType: 'audio/ogg',
                  name: 'note.ogg',
                  isVoiceMessage: true,
                  duration: 7,
                },
              ],
            },
          ],
        },
      });

      const result = formatQuotedSection(msg, 'user', personalityName, undefined, undefined);

      // Shared audio file: NOT a failed transcription.
      expect(result).toContain('<file filename="song.mp3" type="audio/mp3"/>');
      // A real voice message, with its persisted duration carried through.
      expect(result).toContain(
        '<voice filename="note.ogg" type="audio/ogg" duration="7s" status="untranscribed"/>'
      );
    });

    it('keeps a description whose attachment row has gone missing', () => {
      // Data-drift protection: a description is paid-for enrichment, so it is
      // appended even when nothing in `attachments` matches its filename.
      // Dropping it would re-create the exact silent-loss class this function
      // was rewritten to close.
      const msg = makeEntry({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: '123',
              authorUsername: 'user1',
              authorDisplayName: 'User One',
              content: 'orphaned description',
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
              attachments: [],
              resolvedImageDescriptions: [
                { filename: 'vanished.png', description: 'SENTINEL_ORPHAN_DESCRIPTION' },
              ],
            },
          ],
        },
      });

      const result = formatQuotedSection(msg, 'user', personalityName, undefined, undefined);
      expect(result).toContain(
        '<image filename="vanished.png">SENTINEL_ORPHAN_DESCRIPTION</image>'
      );
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
      expect(result).toContain('[Referenced message — full text in the chat log]');
      expect(result).toContain('Duplicated message that is in history');
      expect(result).toContain('from="User One"');
    });

    it('carries hydrated image descriptions across the deduped seam', () => {
      // `persistReferenceDescriptions` writes resolvedImageDescriptions onto the
      // stored row for exactly this moment. The deduped branch used to pass only
      // `content`, so every one of those rows was discarded and the quoted image
      // reached the model as a bare `[image/png: …]` marker.
      //
      // Asserted at the seam (toHaveBeenCalledWith) AND on the output: the seam
      // assertion pins what this caller FORWARDS, which is the hop that dropped
      // the descriptions, and it stays meaningful even if the renderer changes
      // how it draws them.
      const msg = makeEntry({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: 'already-in-history',
              authorUsername: 'user1',
              authorDisplayName: 'User One',
              content: 'look at this',
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
              attachments: [
                {
                  id: 'att-1',
                  url: 'https://cdn.discord.com/embed-image-1.png',
                  contentType: 'image/png',
                  name: 'embed-image-1.png',
                },
              ],
              resolvedImageDescriptions: [
                { filename: 'embed-image-1.png', description: 'SENTINEL_STORED_VISION' },
              ],
            },
          ],
        },
      });

      const result = formatQuotedSection(
        msg,
        'user',
        personalityName,
        new Set(['already-in-history']),
        undefined
      );

      expect(mockFormatDedupedQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            {
              kind: 'image',
              filename: 'embed-image-1.png',
              contentType: 'image/png',
              description: 'SENTINEL_STORED_VISION',
            },
          ],
        })
      );
      expect(result).toContain('SENTINEL_STORED_VISION');
      // One element for the picture, never a description plus a marker.
      expect(result).not.toContain('[image/png: embed-image-1.png]');
      expect(result.match(/<image /g)).toHaveLength(1);
    });

    it('renders role="bot" on a deduped stub from a non-persona bot reference', () => {
      // Stored authorRole flows through the deduped path too — regression guard against
      // the role attribute being dropped between deriveRefRole and formatDedupedQuote.
      const msg = makeEntry({
        messageMetadata: {
          referencedMessages: [
            {
              discordMessageId: 'already-in-history',
              authorUsername: 'somebot',
              authorDisplayName: 'SomeBot',
              authorRole: 'bot',
              content: 'Automated webhook output',
              timestamp: '2026-01-01T00:00:00.000Z',
              locationContext: '',
            },
          ],
        },
      });

      const historyIds = new Set(['already-in-history']);
      const result = formatQuotedSection(msg, 'user', personalityName, historyIds, undefined);
      expect(result).toContain('role="bot"');
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
      expect(result).toContain('[Referenced message — full text in the chat log]');
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
