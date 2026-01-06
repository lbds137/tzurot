/**
 * Tests for RAG Utility Functions
 */

import { describe, it, expect } from 'vitest';
import { AttachmentType } from '@tzurot/common-types';
import { buildAttachmentDescriptions, generateStopSequences } from './RAGUtils.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import type { ParticipantInfo } from './ConversationalRAGService.js';

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
    /**
     * The new stop sequence structure prioritizes hallucination prevention:
     * Priority 1: XML structure (2 slots) - </message>, <message
     * Priority 2: Hallucinated turn prevention (4 slots) - \nUser:, \nHuman:, User:, Human:
     * Priority 3: Instruct format markers (3 slots) - ###, \nAssistant:, <|user|>
     * Priority 4: Self-labeling prevention (1 slot) - \nAI:
     * Priority 5: Personality name (1 slot) - \n{name}:
     * Priority 6: Participants (remaining 5 slots)
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

    it('should include hallucination prevention sequences', () => {
      const participantPersonas = new Map<string, ParticipantInfo>();

      const result = generateStopSequences('Lilith', participantPersonas);

      // Primary hallucination prevention (4 slots)
      expect(result).toContain('\nUser:');
      expect(result).toContain('\nHuman:');
      expect(result).toContain('User:');
      expect(result).toContain('Human:');
    });

    it('should include instruct format markers', () => {
      const participantPersonas = new Map<string, ParticipantInfo>();

      const result = generateStopSequences('Lilith', participantPersonas);

      // Instruct format markers (3 slots)
      expect(result).toContain('###');
      expect(result).toContain('\nAssistant:');
      expect(result).toContain('<|user|>');
    });

    it('should include self-labeling prevention', () => {
      const participantPersonas = new Map<string, ParticipantInfo>();

      const result = generateStopSequences('Lilith', participantPersonas);

      // Self-labeling prevention (1 slot)
      expect(result).toContain('\nAI:');
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

      // Priority 2: Hallucination prevention (indices 2-5)
      expect(result[2]).toBe('\nUser:');
      expect(result[3]).toBe('\nHuman:');
      expect(result[4]).toBe('User:');
      expect(result[5]).toBe('Human:');

      // Priority 3: Instruct format markers (indices 6-8)
      expect(result[6]).toBe('###');
      expect(result[7]).toBe('\nAssistant:');
      expect(result[8]).toBe('<|user|>');

      // Priority 4: Self-labeling prevention (index 9)
      expect(result[9]).toBe('\nAI:');

      // Priority 5: Personality (index 10)
      expect(result[10]).toBe('\nLilith:');

      // Priority 6: Participants (indices 11+)
      expect(result[11]).toBe('\nAlice:');
      expect(result[12]).toBe('\nBob:');
    });

    it('should return correct total count of stop sequences', () => {
      const participantPersonas = new Map<string, ParticipantInfo>([
        ['Alice', { content: 'User persona', isActive: true, personaId: 'persona-1' }],
      ]);

      const result = generateStopSequences('Lilith', participantPersonas);

      // 2 XML + 4 hallucination + 3 instruct + 1 self-label + 1 personality + 1 participant = 12
      expect(result.length).toBe(12);
    });

    it('should handle empty participant map', () => {
      const participantPersonas = new Map<string, ParticipantInfo>();

      const result = generateStopSequences('TestBot', participantPersonas);

      // Should have all reserved slots: 2 XML + 4 hallucination + 3 instruct + 1 self-label + 1 personality = 11
      expect(result).toContain('\nTestBot:');
      expect(result.length).toBe(11);
    });

    it('should cap stop sequences at 16 (Google API limit)', () => {
      // Create many participants to exceed the limit
      // Reserved slots: 2 XML + 4 hallucination + 3 instruct + 1 self-label + 1 personality = 11
      // Available for participants: 16 - 11 = 5
      const participantPersonas = new Map<string, ParticipantInfo>([
        ['User1', { content: '', isActive: true, personaId: 'persona-1' }],
        ['User2', { content: '', isActive: true, personaId: 'persona-2' }],
        ['User3', { content: '', isActive: true, personaId: 'persona-3' }],
        ['User4', { content: '', isActive: true, personaId: 'persona-4' }],
        ['User5', { content: '', isActive: true, personaId: 'persona-5' }],
        ['User6', { content: '', isActive: true, personaId: 'persona-6' }], // Should be truncated
        ['User7', { content: '', isActive: true, personaId: 'persona-7' }], // Should be truncated
        ['User8', { content: '', isActive: true, personaId: 'persona-8' }], // Should be truncated
      ]);

      const result = generateStopSequences('Lilith', participantPersonas);

      // Should be exactly 16 (the max allowed)
      expect(result.length).toBe(16);

      // All priority sequences should be present
      expect(result).toContain('</message>');
      expect(result).toContain('\nUser:');
      expect(result).toContain('###');
      expect(result).toContain('\nAI:');
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
      const participantPersonas = new Map<string, ParticipantInfo>([
        ['User1', { content: '', isActive: true, personaId: 'persona-1' }],
        ['User2', { content: '', isActive: true, personaId: 'persona-2' }],
        ['User3', { content: '', isActive: true, personaId: 'persona-3' }],
      ]);

      const result = generateStopSequences('Lilith', participantPersonas);

      // 11 reserved + 3 participants = 14 (under limit)
      expect(result.length).toBe(14);
      expect(result).toContain('\nUser1:');
      expect(result).toContain('\nUser2:');
      expect(result).toContain('\nUser3:');
    });

    it('should not truncate when exactly at the limit (16)', () => {
      // 5 participants + 11 reserved = exactly 16 (the limit)
      const participantPersonas = new Map<string, ParticipantInfo>([
        ['User1', { content: '', isActive: true, personaId: 'persona-1' }],
        ['User2', { content: '', isActive: true, personaId: 'persona-2' }],
        ['User3', { content: '', isActive: true, personaId: 'persona-3' }],
        ['User4', { content: '', isActive: true, personaId: 'persona-4' }],
        ['User5', { content: '', isActive: true, personaId: 'persona-5' }],
      ]);

      const result = generateStopSequences('Lilith', participantPersonas);

      // Should be exactly 16 with no truncation
      expect(result.length).toBe(16);

      // All participants should be present
      expect(result).toContain('\nUser1:');
      expect(result).toContain('\nUser2:');
      expect(result).toContain('\nUser3:');
      expect(result).toContain('\nUser4:');
      expect(result).toContain('\nUser5:');

      // Personality and all priority sequences should be present
      expect(result).toContain('\nLilith:');
      expect(result).toContain('</message>');
      expect(result).toContain('\nUser:');
      expect(result).toContain('###');
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
});
