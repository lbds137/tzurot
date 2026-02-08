import { describe, it, expect } from 'vitest';
import {
  buildDisambiguatedDisplayName,
  buildMessageWithAttachments,
  wrapWithSpeakerIdentification,
  formatComplexMessageContent,
} from './MessageFormatters.js';

describe('MessageFormatters', () => {
  describe('buildDisambiguatedDisplayName', () => {
    it('should disambiguate when persona name matches personality name', () => {
      const result = buildDisambiguatedDisplayName('Lila', 'Lila', 'lbds137');
      expect(result).toBe('Lila (@lbds137)');
    });

    it('should disambiguate case-insensitively', () => {
      const result = buildDisambiguatedDisplayName('lila', 'LILA', 'lbds137');
      expect(result).toBe('lila (@lbds137)');
    });

    it('should not disambiguate when names differ', () => {
      const result = buildDisambiguatedDisplayName('Alice', 'TestBot', 'alice123');
      expect(result).toBe('Alice');
    });

    it('should not disambiguate when discordUsername is missing', () => {
      const result = buildDisambiguatedDisplayName('Lila', 'Lila', undefined);
      expect(result).toBe('Lila');
    });

    it('should not disambiguate when personalityName is undefined', () => {
      const result = buildDisambiguatedDisplayName('Lila', undefined, 'lbds137');
      expect(result).toBe('Lila');
    });
  });

  describe('buildMessageWithAttachments', () => {
    it('should return user message when no attachments', () => {
      const result = buildMessageWithAttachments('Hello world', '');
      expect(result).toBe('Hello world');
    });

    it('should combine text with attachment descriptions', () => {
      const result = buildMessageWithAttachments('Look at this', 'A sunset image');
      expect(result).toBe('Look at this\n\nA sunset image');
    });

    it('should use transcription for voice-only "Hello" fallback', () => {
      const result = buildMessageWithAttachments('Hello', 'Voice transcription');
      expect(result).toBe('Voice transcription');
    });

    it('should return descriptions only when no user text', () => {
      const result = buildMessageWithAttachments('', 'An image description');
      expect(result).toBe('An image description');
    });
  });

  describe('wrapWithSpeakerIdentification', () => {
    it('should wrap with from tag and persona ID', () => {
      const result = wrapWithSpeakerIdentification('Hello', 'Alice', 'persona-123');
      expect(result).toBe('<from id="persona-123">Alice</from>\n\nHello');
    });

    it('should wrap without ID when activePersonaId is undefined', () => {
      const result = wrapWithSpeakerIdentification('Hello', 'Alice', undefined);
      expect(result).toBe('<from>Alice</from>\n\nHello');
    });
  });

  describe('formatComplexMessageContent', () => {
    it('should extract content from complex message', () => {
      const result = formatComplexMessageContent({ content: 'Hello world' });
      expect(result.content).toBe('Hello world');
      expect(result.refPrefix).toBe('');
      expect(result.attachmentSuffix).toBe('');
    });

    it('should format referenced message', () => {
      const result = formatComplexMessageContent({
        content: 'My reply',
        referencedMessage: { author: 'Bob', content: 'Original message' },
      });
      expect(result.refPrefix).toBe('[Replying to Bob: "Original message"]\n');
    });

    it('should format attachments', () => {
      const result = formatComplexMessageContent({
        content: 'Check this',
        attachments: [{ name: 'image.jpg' }, { name: 'doc.pdf' }],
      });
      expect(result.attachmentSuffix).toContain('[Attachment: image.jpg]');
      expect(result.attachmentSuffix).toContain('[Attachment: doc.pdf]');
    });
  });
});
