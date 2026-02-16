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
import type { ParticipantInfo } from './ConversationalRAGTypes.js';

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
    /**
     * Stop sequence structure (legacy plain-text markers removed):
     * Priority 1: XML structure (2 slots) - </message>, <message
     * Priority 2: Personality name (1 slot) - \n{name}:
     * Priority 3: Participants (remaining 13 slots)
     *
     * Legacy plain-text markers (User:, Human:, ###, <|user|>, \nAI:, etc.)
     * were removed because the XML prompt format makes them unnecessary, and
     * they cause false positives with reasoning models whose chain-of-thought
     * may contain these substrings mid-generation.
     */

    it('should generate stop sequence for personality name', () => {
      const participantPersonas = new Map<string, ParticipantInfo>();

      const result = generateStopSequences('Lilith', participantPersonas);

      expect(result).toContain('\nLilith:');
    });

    it('should generate stop sequences for all participants', () => {
      const participantPersonas = new Map<string, ParticipantInfo>([
        ['Alice', { content: 'User persona', isActive: true, personaId: 'persona-1' }],
        ['Bob', { content: 'Another user', isActive: false, personaId: 'persona-2' }],
      ]);

      const result = generateStopSequences('Lilith', participantPersonas);

      expect(result).toContain('\nAlice:');
      expect(result).toContain('\nBob:');
      expect(result).toContain('\nLilith:');
    });

    it('should include essential XML tag stop sequences', () => {
      const participantPersonas = new Map<string, ParticipantInfo>();

      const result = generateStopSequences('Lilith', participantPersonas);

      // Only essential XML tags (2 slots)
      expect(result).toContain('</message>');
      expect(result).toContain('<message');

      // Old XML tags should NOT be present
      expect(result).not.toContain('<chat_log>');
      expect(result).not.toContain('</chat_log>');
      expect(result).not.toContain('<quoted_messages>');
    });

    it('should NOT include legacy plain-text role markers', () => {
      const participantPersonas = new Map<string, ParticipantInfo>();

      const result = generateStopSequences('Lilith', participantPersonas);

      // These were removed — they cause false positives with reasoning models
      expect(result).not.toContain('\nUser:');
      expect(result).not.toContain('\nHuman:');
      expect(result).not.toContain('User:');
      expect(result).not.toContain('Human:');
      expect(result).not.toContain('###');
      expect(result).not.toContain('\nAssistant:');
      expect(result).not.toContain('<|user|>');
      expect(result).not.toContain('\nAI:');
    });

    it('should return stop sequences in priority order', () => {
      const participantPersonas = new Map<string, ParticipantInfo>([
        ['Alice', { content: '', isActive: true, personaId: 'persona-1' }],
        ['Bob', { content: '', isActive: true, personaId: 'persona-2' }],
      ]);

      const result = generateStopSequences('Lilith', participantPersonas);

      // Priority 1: XML structure (indices 0-1)
      expect(result[0]).toBe('</message>');
      expect(result[1]).toBe('<message');

      // Priority 2: Personality (index 2)
      expect(result[2]).toBe('\nLilith:');

      // Priority 3: Participants (indices 3+)
      expect(result[3]).toBe('\nAlice:');
      expect(result[4]).toBe('\nBob:');
    });

    it('should return correct total count of stop sequences', () => {
      const participantPersonas = new Map<string, ParticipantInfo>([
        ['Alice', { content: 'User persona', isActive: true, personaId: 'persona-1' }],
      ]);

      const result = generateStopSequences('Lilith', participantPersonas);

      // 2 XML + 1 personality + 1 participant = 4
      expect(result.length).toBe(4);
    });

    it('should handle empty participant map', () => {
      const participantPersonas = new Map<string, ParticipantInfo>();

      const result = generateStopSequences('TestBot', participantPersonas);

      // Should have reserved slots only: 2 XML + 1 personality = 3
      expect(result).toContain('\nTestBot:');
      expect(result.length).toBe(3);
    });

    it('should cap stop sequences at 16 (Google API limit)', () => {
      // Create many participants to exceed the limit
      // Reserved slots: 2 XML + 1 personality = 3
      // Available for participants: 16 - 3 = 13
      const participantPersonas = new Map<string, ParticipantInfo>();
      for (let i = 1; i <= 15; i++) {
        participantPersonas.set(`User${i}`, {
          content: '',
          isActive: true,
          personaId: `persona-${i}`,
        });
      }

      const result = generateStopSequences('Lilith', participantPersonas);

      // Should be exactly 16 (the max allowed)
      expect(result.length).toBe(16);

      // All priority sequences should be present
      expect(result).toContain('</message>');
      expect(result).toContain('\nLilith:');

      // First 13 participants should be present
      expect(result).toContain('\nUser1:');
      expect(result).toContain('\nUser13:');

      // User14+ should be truncated
      expect(result).not.toContain('\nUser14:');
      expect(result).not.toContain('\nUser15:');
    });

    it('should not truncate when under the limit', () => {
      const participantPersonas = new Map<string, ParticipantInfo>([
        ['User1', { content: '', isActive: true, personaId: 'persona-1' }],
        ['User2', { content: '', isActive: true, personaId: 'persona-2' }],
        ['User3', { content: '', isActive: true, personaId: 'persona-3' }],
      ]);

      const result = generateStopSequences('Lilith', participantPersonas);

      // 3 reserved + 3 participants = 6 (under limit)
      expect(result.length).toBe(6);
      expect(result).toContain('\nUser1:');
      expect(result).toContain('\nUser2:');
      expect(result).toContain('\nUser3:');
    });

    it('should not truncate when exactly at the limit (16)', () => {
      // 13 participants + 3 reserved = exactly 16 (the limit)
      const participantPersonas = new Map<string, ParticipantInfo>();
      for (let i = 1; i <= 13; i++) {
        participantPersonas.set(`User${i}`, {
          content: '',
          isActive: true,
          personaId: `persona-${i}`,
        });
      }

      const result = generateStopSequences('Lilith', participantPersonas);

      // Should be exactly 16 with no truncation
      expect(result.length).toBe(16);

      // All participants should be present
      expect(result).toContain('\nUser1:');
      expect(result).toContain('\nUser13:');

      // Personality and XML should be present
      expect(result).toContain('\nLilith:');
      expect(result).toContain('</message>');
    });

    it('should work with participants that have guildInfo', () => {
      const participantPersonas = new Map<string, ParticipantInfo>([
        [
          'Alice',
          {
            content: 'Developer',
            isActive: true,
            personaId: 'persona-1',
            guildInfo: {
              roles: ['Admin', 'Developer'],
              displayColor: '#FF00FF',
              joinedAt: '2023-05-15T10:30:00Z',
            },
          },
        ],
      ]);

      const result = generateStopSequences('Lilith', participantPersonas);

      // Should still generate correct stop sequences regardless of guildInfo
      expect(result).toContain('\nAlice:');
      expect(result).toContain('\nLilith:');
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
