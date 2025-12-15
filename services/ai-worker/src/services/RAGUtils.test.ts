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
          metadata: { isVoiceMessage: true, duration: null as unknown as number, name: 'voice.ogg' },
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
      expect(result).toBe(
        '[Image: first.png]\nFirst image\n\n[Voice message: 3.2s]\nSecond audio'
      );
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
  });
});
