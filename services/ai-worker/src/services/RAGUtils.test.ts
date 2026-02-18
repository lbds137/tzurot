/**
 * Tests for RAG Utility Functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttachmentType } from '@tzurot/common-types';
import type { AttachmentMetadata, StoredReferencedMessage } from '@tzurot/common-types';
import {
  buildAttachmentDescriptions,
  extractContentDescriptions,
  generateStopSequences,
  injectImageDescriptions,
  countMediaAttachments,
  enrichConversationHistory,
  type RawHistoryEntry,
} from './RAGUtils.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';

vi.mock('./storedReferenceHydrator.js', () => ({
  hydrateStoredReferences: vi.fn().mockResolvedValue(undefined),
}));

// Factory for ProcessedAttachment with required metadata fields
function createAttachment(
  type: AttachmentType,
  description: string,
  metadataOverrides: Partial<ProcessedAttachment['metadata']> = {}
): ProcessedAttachment {
  return {
    type,
    description,
    originalUrl: metadataOverrides.url ?? 'https://example.com/file',
    metadata: {
      url: 'https://example.com/file',
      contentType: type === AttachmentType.Audio ? 'audio/mpeg' : 'image/jpeg',
      ...metadataOverrides,
    },
  };
}

describe('RAGUtils', () => {
  describe('buildAttachmentDescriptions', () => {
    it('should return undefined for empty attachments', () => {
      const result = buildAttachmentDescriptions([]);
      expect(result).toBeUndefined();
    });

    it('should format image attachment with name', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Image, 'A beautiful sunset over mountains', {
          name: 'sunset.jpg',
        }),
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Image: sunset.jpg]\nA beautiful sunset over mountains');
    });

    it('should format image attachment without name', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Image, 'An abstract pattern', {}),
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Image: attachment]\nAn abstract pattern');
    });

    it('should format image attachment with empty name', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Image, 'Some image', { name: '' }),
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Image: attachment]\nSome image');
    });

    it('should format voice message with duration', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Audio, 'User said hello and asked about the weather', {
          isVoiceMessage: true,
          duration: 5.5,
        }),
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Voice message: 5.5s]\nUser said hello and asked about the weather');
    });

    it('should format audio attachment with name', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Audio, 'A podcast episode about AI', {
          name: 'podcast.mp3',
          isVoiceMessage: false,
        }),
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Audio: podcast.mp3]\nA podcast episode about AI');
    });

    it('should format audio attachment without name', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Audio, 'Some audio content', {}),
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Audio: attachment]\nSome audio content');
    });

    it('should format voice message with zero duration as audio', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Audio, 'Voice content', {
          isVoiceMessage: true,
          duration: 0,
          name: 'voice.ogg',
        }),
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Audio: voice.ogg]\nVoice content');
    });

    it('should format voice message with null duration as audio', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Audio, 'Voice content', {
          isVoiceMessage: true,
          duration: null as unknown as number,
          name: 'voice.ogg',
        }),
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Audio: voice.ogg]\nVoice content');
    });

    it('should format multiple attachments separated by double newlines', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Image, 'First image', { name: 'first.png' }),
        createAttachment(AttachmentType.Audio, 'Second audio', {
          isVoiceMessage: true,
          duration: 3.2,
        }),
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Image: first.png]\nFirst image\n\n[Voice message: 3.2s]\nSecond audio');
    });

    it('should handle attachments with unknown type', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment('unknown' as AttachmentType, 'Some unknown content'),
      ];

      const result = buildAttachmentDescriptions(attachments);
      // Unknown types get no header, just description
      expect(result).toBe('\nSome unknown content');
    });
  });

  describe('extractContentDescriptions', () => {
    it('should return empty string for empty attachments', () => {
      const result = extractContentDescriptions([]);
      expect(result).toBe('');
    });

    it('should extract descriptions without placeholders', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Image, 'A beautiful sunset', { name: 'sunset.jpg' }),
        createAttachment(AttachmentType.Audio, 'Hello, how are you today?', {
          name: 'voice.ogg',
          isVoiceMessage: true,
          duration: 3.5,
        }),
      ];

      const result = extractContentDescriptions(attachments);
      expect(result).toBe('A beautiful sunset\n\nHello, how are you today?');
    });

    it('should filter out bare placeholder descriptions', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Image, '[image]', { name: 'failed.jpg' }),
        createAttachment(AttachmentType.Image, 'A valid description', { name: 'good.jpg' }),
        createAttachment(AttachmentType.Audio, '[audio]', { name: 'failed.ogg' }),
      ];

      const result = extractContentDescriptions(attachments);
      expect(result).toBe('A valid description');
    });

    it('should NOT filter out vision failure descriptions', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Image, '[Image unavailable: bad_request]', {
          name: 'failed.jpg',
        }),
      ];

      const result = extractContentDescriptions(attachments);
      expect(result).toBe('[Image unavailable: bad_request]');
    });

    it('should NOT filter out temporary unavailable descriptions', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Image, '[Image temporarily unavailable]', {
          name: 'retry.jpg',
        }),
      ];

      const result = extractContentDescriptions(attachments);
      expect(result).toBe('[Image temporarily unavailable]');
    });

    it('should keep both real descriptions and unavailable labels', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Image, 'A sunset over mountains', { name: 'sunset.jpg' }),
        createAttachment(AttachmentType.Image, '[Image unavailable: bad_request]', {
          name: 'broken.jpg',
        }),
        createAttachment(AttachmentType.Image, '[image]', { name: 'placeholder.jpg' }),
      ];

      const result = extractContentDescriptions(attachments);
      expect(result).toBe('A sunset over mountains\n\n[Image unavailable: bad_request]');
    });

    it('should filter out empty descriptions', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Image, '', { name: 'empty.jpg' }),
        createAttachment(AttachmentType.Image, 'Valid content', { name: 'good.jpg' }),
      ];

      const result = extractContentDescriptions(attachments);
      expect(result).toBe('Valid content');
    });

    it('should return empty string when all descriptions are placeholders', () => {
      const attachments: ProcessedAttachment[] = [
        createAttachment(AttachmentType.Image, '[image]', { name: 'a.jpg' }),
        createAttachment(AttachmentType.Image, '[unsupported format]', { name: 'b.jpg' }),
      ];

      const result = extractContentDescriptions(attachments);
      expect(result).toBe('');
    });
  });

  describe('generateStopSequences', () => {
    it('should return exactly the 2 XML stop sequences', () => {
      const result = generateStopSequences();

      expect(result).toEqual(['</message>', '<message']);
    });

    it('should not include any name-based stop sequences', () => {
      const result = generateStopSequences();

      // No personality or participant name patterns
      const hasNamePattern = result.some(s => s.startsWith('\n') && s.endsWith(':'));
      expect(hasNamePattern).toBe(false);
    });

    it('should not include legacy plain-text role markers', () => {
      const result = generateStopSequences();

      expect(result).not.toContain('\nUser:');
      expect(result).not.toContain('\nHuman:');
      expect(result).not.toContain('###');
      expect(result).not.toContain('<|user|>');
    });
  });

  describe('injectImageDescriptions', () => {
    it('should inject descriptions matching by entry.id (primary)', () => {
      const history: RawHistoryEntry[] = [{ id: 'discord-msg-1', role: 'user', content: '' }];
      const imageMap = new Map([
        ['discord-msg-1', [{ filename: 'img.png', description: 'A sunset' }]],
      ]);

      injectImageDescriptions(history, imageMap);

      expect(history[0].messageMetadata?.imageDescriptions).toEqual([
        { filename: 'img.png', description: 'A sunset' },
      ]);
    });

    it('should inject descriptions matching by discordMessageId fallback', () => {
      // DB messages have UUID ids but Discord snowflake in discordMessageId
      const history: RawHistoryEntry[] = [
        { id: 'uuid-internal-123', discordMessageId: ['discord-msg-1'], role: 'user', content: '' },
      ];
      const imageMap = new Map([
        ['discord-msg-1', [{ filename: 'img.png', description: 'A mountain' }]],
      ]);

      injectImageDescriptions(history, imageMap);

      expect(history[0].messageMetadata?.imageDescriptions).toEqual([
        { filename: 'img.png', description: 'A mountain' },
      ]);
    });

    it('should prefer entry.id match over discordMessageId', () => {
      const history: RawHistoryEntry[] = [
        { id: 'discord-msg-1', discordMessageId: ['discord-msg-2'], role: 'user', content: '' },
      ];
      const imageMap = new Map([
        ['discord-msg-1', [{ filename: 'primary.png', description: 'Primary match' }]],
        ['discord-msg-2', [{ filename: 'fallback.png', description: 'Fallback match' }]],
      ]);

      injectImageDescriptions(history, imageMap);

      expect(history[0].messageMetadata?.imageDescriptions).toEqual([
        { filename: 'primary.png', description: 'Primary match' },
      ]);
    });

    it('should skip entries with no matching IDs', () => {
      const history: RawHistoryEntry[] = [{ id: 'unmatched-id', role: 'user', content: 'test' }];
      const imageMap = new Map([
        ['discord-msg-1', [{ filename: 'img.png', description: 'A photo' }]],
      ]);

      injectImageDescriptions(history, imageMap);

      expect(history[0].messageMetadata).toBeUndefined();
    });

    it('should handle empty history', () => {
      const imageMap = new Map([
        ['discord-msg-1', [{ filename: 'img.png', description: 'A photo' }]],
      ]);

      // Should not throw
      injectImageDescriptions([], imageMap);
      injectImageDescriptions(undefined, imageMap);
    });

    it('should handle empty imageMap', () => {
      const history: RawHistoryEntry[] = [{ id: 'discord-msg-1', role: 'user', content: '' }];
      const imageMap = new Map<string, { filename: string; description: string }[]>();

      injectImageDescriptions(history, imageMap);

      expect(history[0].messageMetadata).toBeUndefined();
    });
  });

  describe('countMediaAttachments', () => {
    it('should return zero counts for undefined attachments', () => {
      const { imageCount, audioCount } = countMediaAttachments(undefined);
      expect(imageCount).toBe(0);
      expect(audioCount).toBe(0);
    });

    it('should return zero counts for empty array', () => {
      const { imageCount, audioCount } = countMediaAttachments([]);
      expect(imageCount).toBe(0);
      expect(audioCount).toBe(0);
    });

    it('should count image attachments', () => {
      const attachments: AttachmentMetadata[] = [
        { url: 'u1', contentType: 'image/jpeg' },
        { url: 'u2', contentType: 'image/png' },
        { url: 'u3', contentType: 'text/plain' },
      ];
      const { imageCount, audioCount } = countMediaAttachments(attachments);
      expect(imageCount).toBe(2);
      expect(audioCount).toBe(0);
    });

    it('should count audio attachments', () => {
      const attachments: AttachmentMetadata[] = [
        { url: 'u1', contentType: 'audio/mpeg' },
        { url: 'u2', contentType: 'audio/ogg' },
      ];
      const { imageCount, audioCount } = countMediaAttachments(attachments);
      expect(imageCount).toBe(0);
      expect(audioCount).toBe(2);
    });

    it('should exclude voice messages from image count', () => {
      const attachments: AttachmentMetadata[] = [
        { url: 'u1', contentType: 'image/jpeg', isVoiceMessage: true },
        { url: 'u2', contentType: 'image/png', isVoiceMessage: false },
        { url: 'u3', contentType: 'image/gif' }, // undefined isVoiceMessage = counted as image
      ];
      const { imageCount, audioCount } = countMediaAttachments(attachments);
      expect(imageCount).toBe(2);
      expect(audioCount).toBe(1); // voice message counted as audio
    });

    it('should count voice messages as audio', () => {
      const attachments: AttachmentMetadata[] = [
        { url: 'u1', contentType: 'audio/ogg', isVoiceMessage: true },
        { url: 'u2', contentType: 'image/jpeg', isVoiceMessage: true },
      ];
      const { imageCount, audioCount } = countMediaAttachments(attachments);
      expect(imageCount).toBe(0);
      expect(audioCount).toBe(2);
    });
  });

  describe('enrichConversationHistory', () => {
    const mockPrisma = {} as Parameters<typeof enrichConversationHistory>[2];
    const mockVisionCache = {} as Parameters<typeof enrichConversationHistory>[3];

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should call processImagesFn with linked-message image attachments', async () => {
      const processImagesFn = vi.fn().mockResolvedValue(undefined);
      const ref: StoredReferencedMessage = {
        discordMessageId: 'ref-1',
        authorUsername: 'user1',
        authorDisplayName: 'User One',
        content: 'hello',
        timestamp: '2026-01-01T00:00:00Z',
        locationContext: '',
        attachments: [
          { id: 'img-1', url: 'https://cdn.example.com/img1.jpg', contentType: 'image/jpeg' },
        ],
      };
      const history: RawHistoryEntry[] = [
        {
          role: 'user',
          content: 'test',
          messageMetadata: { referencedMessages: [ref] },
        },
      ];

      await enrichConversationHistory(
        history,
        undefined,
        mockPrisma,
        mockVisionCache,
        processImagesFn
      );

      expect(processImagesFn).toHaveBeenCalledOnce();
      expect(processImagesFn).toHaveBeenCalledWith([
        { id: 'img-1', url: 'https://cdn.example.com/img1.jpg', contentType: 'image/jpeg' },
      ]);
    });

    it('should not call processImagesFn when no linked images exist', async () => {
      const processImagesFn = vi.fn().mockResolvedValue(undefined);
      const history: RawHistoryEntry[] = [{ role: 'user', content: 'test' }];

      await enrichConversationHistory(
        history,
        undefined,
        mockPrisma,
        mockVisionCache,
        processImagesFn
      );

      expect(processImagesFn).not.toHaveBeenCalled();
    });

    it('should skip non-image attachments in linked messages', async () => {
      const processImagesFn = vi.fn().mockResolvedValue(undefined);
      const ref: StoredReferencedMessage = {
        discordMessageId: 'ref-1',
        authorUsername: 'user1',
        authorDisplayName: 'User One',
        content: 'hello',
        timestamp: '2026-01-01T00:00:00Z',
        locationContext: '',
        attachments: [
          { id: 'img-1', url: 'url1', contentType: 'image/jpeg' },
          { id: 'aud-1', url: 'url2', contentType: 'audio/mpeg' },
          { id: 'txt-1', url: 'url3', contentType: 'text/plain' },
        ],
      };
      const history: RawHistoryEntry[] = [
        {
          role: 'user',
          content: 'test',
          messageMetadata: { referencedMessages: [ref] },
        },
      ];

      await enrichConversationHistory(
        history,
        undefined,
        mockPrisma,
        mockVisionCache,
        processImagesFn
      );

      expect(processImagesFn).toHaveBeenCalledWith([
        { id: 'img-1', url: 'url1', contentType: 'image/jpeg' },
      ]);
    });

    it('should deduplicate linked images by ID', async () => {
      const processImagesFn = vi.fn().mockResolvedValue(undefined);
      const sameImage = { id: 'img-1', url: 'url1', contentType: 'image/jpeg' };
      const ref1: StoredReferencedMessage = {
        discordMessageId: 'ref-1',
        authorUsername: 'user1',
        authorDisplayName: 'User One',
        content: 'msg1',
        timestamp: '2026-01-01T00:00:00Z',
        locationContext: '',
        attachments: [sameImage],
      };
      const ref2: StoredReferencedMessage = {
        discordMessageId: 'ref-2',
        authorUsername: 'user2',
        authorDisplayName: 'User Two',
        content: 'msg2',
        timestamp: '2026-01-01T00:01:00Z',
        locationContext: '',
        attachments: [sameImage],
      };
      const history: RawHistoryEntry[] = [
        {
          role: 'user',
          content: 'test1',
          messageMetadata: { referencedMessages: [ref1] },
        },
        {
          role: 'user',
          content: 'test2',
          messageMetadata: { referencedMessages: [ref2] },
        },
      ];

      await enrichConversationHistory(
        history,
        undefined,
        mockPrisma,
        mockVisionCache,
        processImagesFn
      );

      expect(processImagesFn).toHaveBeenCalledWith([sameImage]);
    });

    it('should deduplicate by URL when ID is missing', async () => {
      const processImagesFn = vi.fn().mockResolvedValue(undefined);
      const ref: StoredReferencedMessage = {
        discordMessageId: 'ref-1',
        authorUsername: 'user1',
        authorDisplayName: 'User One',
        content: 'msg',
        timestamp: '2026-01-01T00:00:00Z',
        locationContext: '',
        attachments: [
          { url: 'https://cdn.example.com/img.jpg', contentType: 'image/png' },
          { url: 'https://cdn.example.com/img.jpg', contentType: 'image/png' },
        ],
      };
      const history: RawHistoryEntry[] = [
        {
          role: 'user',
          content: 'test',
          messageMetadata: { referencedMessages: [ref] },
        },
      ];

      await enrichConversationHistory(
        history,
        undefined,
        mockPrisma,
        mockVisionCache,
        processImagesFn
      );

      expect(processImagesFn).toHaveBeenCalledWith([
        { url: 'https://cdn.example.com/img.jpg', contentType: 'image/png' },
      ]);
    });

    it('should gracefully handle processImagesFn failure', async () => {
      const processImagesFn = vi.fn().mockRejectedValue(new Error('Vision API down'));
      const ref: StoredReferencedMessage = {
        discordMessageId: 'ref-1',
        authorUsername: 'user1',
        authorDisplayName: 'User One',
        content: 'msg',
        timestamp: '2026-01-01T00:00:00Z',
        locationContext: '',
        attachments: [{ id: 'img-1', url: 'url1', contentType: 'image/jpeg' }],
      };
      const history: RawHistoryEntry[] = [
        {
          role: 'user',
          content: 'test',
          messageMetadata: { referencedMessages: [ref] },
        },
      ];

      // Should not throw — graceful degradation
      await expect(
        enrichConversationHistory(history, undefined, mockPrisma, mockVisionCache, processImagesFn)
      ).resolves.toBeUndefined();
    });

    it('should work without processImagesFn (backward compatibility)', async () => {
      const history: RawHistoryEntry[] = [{ role: 'user', content: 'test' }];

      // Should not throw when processImagesFn is omitted
      await expect(
        enrichConversationHistory(history, undefined, mockPrisma, mockVisionCache)
      ).resolves.toBeUndefined();
    });
  });
});
