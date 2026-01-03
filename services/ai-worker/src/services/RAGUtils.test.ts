/**
 * Tests for RAG Utility Functions
 */

import { describe, it, expect } from 'vitest';
import { AttachmentType } from '@tzurot/common-types';
import { buildAttachmentDescriptions, generateStopSequences } from './RAGUtils.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';

describe('RAGUtils', () => {
  describe('buildAttachmentDescriptions', () => {
    it('should return undefined for empty attachments', () => {
      const result = buildAttachmentDescriptions([]);
      expect(result).toBeUndefined();
    });

    it('should format image attachment with name', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Image,
          description: 'A beautiful sunset over mountains',
          metadata: { name: 'sunset.jpg' },
        },
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Image: sunset.jpg]\nA beautiful sunset over mountains');
    });

    it('should format image attachment without name', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Image,
          description: 'An abstract pattern',
          metadata: {},
        },
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Image: attachment]\nAn abstract pattern');
    });

    it('should format image attachment with empty name', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Image,
          description: 'Some image',
          metadata: { name: '' },
        },
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Image: attachment]\nSome image');
    });

    it('should format voice message with duration', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Audio,
          description: 'User said hello and asked about the weather',
          metadata: { isVoiceMessage: true, duration: 5.5 },
        },
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Voice message: 5.5s]\nUser said hello and asked about the weather');
    });

    it('should format audio attachment with name', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Audio,
          description: 'A podcast episode about AI',
          metadata: { name: 'podcast.mp3', isVoiceMessage: false },
        },
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Audio: podcast.mp3]\nA podcast episode about AI');
    });

    it('should format audio attachment without name', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Audio,
          description: 'Some audio content',
          metadata: {},
        },
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Audio: attachment]\nSome audio content');
    });

    it('should format voice message with zero duration as audio', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Audio,
          description: 'Voice content',
          metadata: { isVoiceMessage: true, duration: 0, name: 'voice.ogg' },
        },
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Audio: voice.ogg]\nVoice content');
    });

    it('should format voice message with null duration as audio', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Audio,
          description: 'Voice content',
          metadata: {
            isVoiceMessage: true,
            duration: null as unknown as number,
            name: 'voice.ogg',
          },
        },
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Audio: voice.ogg]\nVoice content');
    });

    it('should format multiple attachments separated by double newlines', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: AttachmentType.Image,
          description: 'First image',
          metadata: { name: 'first.png' },
        },
        {
          type: AttachmentType.Audio,
          description: 'Second audio',
          metadata: { isVoiceMessage: true, duration: 3.2 },
        },
      ];

      const result = buildAttachmentDescriptions(attachments);
      expect(result).toBe('[Image: first.png]\nFirst image\n\n[Voice message: 3.2s]\nSecond audio');
    });

    it('should handle attachments with unknown type', () => {
      const attachments: ProcessedAttachment[] = [
        {
          type: 'unknown' as AttachmentType,
          description: 'Some unknown content',
          metadata: {},
        },
      ];

      const result = buildAttachmentDescriptions(attachments);
      // Unknown types get no header, just description
      expect(result).toBe('\nSome unknown content');
    });
  });

  describe('generateStopSequences', () => {
    it('should generate stop sequence for personality name', () => {
      const participantPersonas = new Map<string, { content: string; isActive: boolean }>();

      const result = generateStopSequences('Lilith', participantPersonas);

      expect(result).toContain('\nLilith:');
    });

    it('should generate stop sequences for all participants', () => {
      const participantPersonas = new Map<string, { content: string; isActive: boolean }>([
        ['Alice', { content: 'User persona', isActive: true }],
        ['Bob', { content: 'Another user', isActive: false }],
      ]);

      const result = generateStopSequences('Lilith', participantPersonas);

      expect(result).toContain('\nAlice:');
      expect(result).toContain('\nBob:');
      expect(result).toContain('\nLilith:');
    });

    it('should include XML tag stop sequences', () => {
      const participantPersonas = new Map<string, { content: string; isActive: boolean }>();

      const result = generateStopSequences('Lilith', participantPersonas);

      expect(result).toContain('<message ');
      expect(result).toContain('<message>');
      expect(result).toContain('</message>');
      expect(result).toContain('<chat_log>');
      expect(result).toContain('</chat_log>');
      expect(result).toContain('<quoted_messages>');
      expect(result).toContain('</quoted_messages>');
      expect(result).toContain('<quote ');
      expect(result).toContain('<quote>');
      expect(result).toContain('</quote>');
    });

    it('should return correct total count of stop sequences', () => {
      const participantPersonas = new Map<string, { content: string; isActive: boolean }>([
        ['Alice', { content: 'User persona', isActive: true }],
      ]);

      const result = generateStopSequences('Lilith', participantPersonas);

      // 1 participant + 1 personality + 10 XML tags = 12
      expect(result.length).toBe(12);
    });

    it('should handle empty participant map', () => {
      const participantPersonas = new Map<string, { content: string; isActive: boolean }>();

      const result = generateStopSequences('TestBot', participantPersonas);

      // Should still have personality name and XML sequences
      expect(result).toContain('\nTestBot:');
      expect(result.length).toBe(11); // 1 personality + 10 XML tags
    });

    it('should cap stop sequences at 16 (Google API limit)', () => {
      // Create many participants to exceed the limit
      // Max is 16, with 10 XML + 1 personality = 11 reserved, leaving 5 for participants
      const participantPersonas = new Map<string, { content: string; isActive: boolean }>([
        ['User1', { content: '', isActive: true }],
        ['User2', { content: '', isActive: true }],
        ['User3', { content: '', isActive: true }],
        ['User4', { content: '', isActive: true }],
        ['User5', { content: '', isActive: true }],
        ['User6', { content: '', isActive: true }], // Should be truncated
        ['User7', { content: '', isActive: true }], // Should be truncated
        ['User8', { content: '', isActive: true }], // Should be truncated
      ]);

      const result = generateStopSequences('Lilith', participantPersonas);

      // Should be exactly 16 (the max allowed)
      expect(result.length).toBe(16);

      // XML sequences should always be present
      expect(result).toContain('<message ');
      expect(result).toContain('</chat_log>');

      // Personality should always be present
      expect(result).toContain('\nLilith:');

      // First 5 participants should be present
      expect(result).toContain('\nUser1:');
      expect(result).toContain('\nUser5:');

      // User6+ should be truncated
      expect(result).not.toContain('\nUser6:');
      expect(result).not.toContain('\nUser7:');
      expect(result).not.toContain('\nUser8:');
    });

    it('should not truncate when under the limit', () => {
      const participantPersonas = new Map<string, { content: string; isActive: boolean }>([
        ['User1', { content: '', isActive: true }],
        ['User2', { content: '', isActive: true }],
        ['User3', { content: '', isActive: true }],
      ]);

      const result = generateStopSequences('Lilith', participantPersonas);

      // 3 participants + 1 personality + 10 XML = 14 (under limit)
      expect(result.length).toBe(14);
      expect(result).toContain('\nUser1:');
      expect(result).toContain('\nUser2:');
      expect(result).toContain('\nUser3:');
    });
  });
});
