/**
 * Voice Context Merger Tests
 *
 * Tests the Reverse Zipper algorithm for merging voice message transcripts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Collection } from 'discord.js';
import type { Message, Attachment } from 'discord.js';
import { isVoiceMessage, isTranscriptReply, mergeVoiceContext } from './VoiceContextMerger.js';

// Mock logger
vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Test constants
const BOT_USER_ID = 'bot-123';
const USER_ID = 'user-456';

/**
 * Create a mock message
 */
function createMockMessage(options: {
  id: string;
  authorId: string;
  content: string;
  createdTimestamp?: number;
  attachments?: Array<{
    id: string;
    contentType?: string;
    duration?: number | null;
  }>;
  reference?: {
    messageId: string;
  };
  member?: {
    displayName: string;
  };
}): Message {
  const attachments = new Collection<string, Attachment>();
  if (options.attachments) {
    for (const att of options.attachments) {
      attachments.set(att.id, {
        id: att.id,
        contentType: att.contentType ?? null,
        duration: att.duration ?? null,
      } as Attachment);
    }
  }

  return {
    id: options.id,
    author: {
      id: options.authorId,
      globalName: 'TestUser',
      username: 'testuser',
    },
    content: options.content,
    createdTimestamp: options.createdTimestamp ?? Date.now(),
    attachments,
    reference: options.reference
      ? {
          messageId: options.reference.messageId,
        }
      : null,
    member: options.member ?? null,
  } as unknown as Message;
}

describe('VoiceContextMerger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isVoiceMessage', () => {
    it('returns true for audio/ogg attachment', () => {
      const msg = createMockMessage({
        id: 'msg-1',
        authorId: USER_ID,
        content: '',
        attachments: [{ id: 'att-1', contentType: 'audio/ogg' }],
      });

      expect(isVoiceMessage(msg)).toBe(true);
    });

    it('returns true for attachment with duration', () => {
      const msg = createMockMessage({
        id: 'msg-1',
        authorId: USER_ID,
        content: '',
        attachments: [{ id: 'att-1', contentType: 'application/octet-stream', duration: 5.2 }],
      });

      expect(isVoiceMessage(msg)).toBe(true);
    });

    it('returns false for image attachment', () => {
      const msg = createMockMessage({
        id: 'msg-1',
        authorId: USER_ID,
        content: '',
        attachments: [{ id: 'att-1', contentType: 'image/png' }],
      });

      expect(isVoiceMessage(msg)).toBe(false);
    });

    it('returns false for message with no attachments', () => {
      const msg = createMockMessage({
        id: 'msg-1',
        authorId: USER_ID,
        content: 'Hello world',
      });

      expect(isVoiceMessage(msg)).toBe(false);
    });

    it('returns true for audio/webm attachment', () => {
      const msg = createMockMessage({
        id: 'msg-1',
        authorId: USER_ID,
        content: '',
        attachments: [{ id: 'att-1', contentType: 'audio/webm' }],
      });

      expect(isVoiceMessage(msg)).toBe(true);
    });
  });

  describe('isTranscriptReply', () => {
    it('returns true for bot reply with content', () => {
      const msg = createMockMessage({
        id: 'transcript-1',
        authorId: BOT_USER_ID,
        content: 'This is what the user said',
        reference: { messageId: 'voice-1' },
      });

      expect(isTranscriptReply(msg, BOT_USER_ID)).toBe(true);
    });

    it('returns false for user message', () => {
      const msg = createMockMessage({
        id: 'msg-1',
        authorId: USER_ID,
        content: 'User reply',
        reference: { messageId: 'voice-1' },
      });

      expect(isTranscriptReply(msg, BOT_USER_ID)).toBe(false);
    });

    it('returns false for bot message without reference', () => {
      const msg = createMockMessage({
        id: 'msg-1',
        authorId: BOT_USER_ID,
        content: 'Bot speaking',
      });

      expect(isTranscriptReply(msg, BOT_USER_ID)).toBe(false);
    });

    it('returns false for bot reply with empty content', () => {
      const msg = createMockMessage({
        id: 'msg-1',
        authorId: BOT_USER_ID,
        content: '',
        reference: { messageId: 'voice-1' },
      });

      expect(isTranscriptReply(msg, BOT_USER_ID)).toBe(false);
    });
  });

  describe('mergeVoiceContext', () => {
    it('merges transcript into voice message and removes bot reply', () => {
      // Create messages in chronological order (oldest first)
      // Voice message, then bot transcript reply
      const voiceMsg = createMockMessage({
        id: 'voice-1',
        authorId: USER_ID,
        content: '',
        createdTimestamp: 1000,
        attachments: [{ id: 'att-1', contentType: 'audio/ogg', duration: 5.0 }],
        member: { displayName: 'TestUser' },
      });

      const transcriptMsg = createMockMessage({
        id: 'transcript-1',
        authorId: BOT_USER_ID,
        content: 'Hello, this is what I said in my voice message',
        createdTimestamp: 2000,
        reference: { messageId: 'voice-1' },
      });

      const messages = [voiceMsg, transcriptMsg];

      const result = mergeVoiceContext(messages, BOT_USER_ID);

      // Should have merged 1 transcript
      expect(result.mergedCount).toBe(1);
      expect(result.unmergedCount).toBe(0);
      expect(result.orphanTranscripts).toBe(0);

      // Should have 1 message (voice message with injected transcript)
      expect(result.messages).toHaveLength(1);

      // Transcript should be injected into voice message
      expect(result.messages[0].id).toBe('voice-1');
      expect(result.messages[0].content).toContain('Voice message from TestUser');
      expect(result.messages[0].content).toContain(
        'Hello, this is what I said in my voice message'
      );
    });

    it('handles multiple voice messages with transcripts', () => {
      const voice1 = createMockMessage({
        id: 'voice-1',
        authorId: USER_ID,
        content: '',
        createdTimestamp: 1000,
        attachments: [{ id: 'att-1', contentType: 'audio/ogg', duration: 3.0 }],
        member: { displayName: 'User1' },
      });

      const transcript1 = createMockMessage({
        id: 'transcript-1',
        authorId: BOT_USER_ID,
        content: 'First transcript',
        createdTimestamp: 2000,
        reference: { messageId: 'voice-1' },
      });

      const voice2 = createMockMessage({
        id: 'voice-2',
        authorId: 'user-789',
        content: '',
        createdTimestamp: 3000,
        attachments: [{ id: 'att-2', contentType: 'audio/ogg', duration: 4.0 }],
        member: { displayName: 'User2' },
      });

      const transcript2 = createMockMessage({
        id: 'transcript-2',
        authorId: BOT_USER_ID,
        content: 'Second transcript',
        createdTimestamp: 4000,
        reference: { messageId: 'voice-2' },
      });

      const messages = [voice1, transcript1, voice2, transcript2];

      const result = mergeVoiceContext(messages, BOT_USER_ID);

      expect(result.mergedCount).toBe(2);
      expect(result.unmergedCount).toBe(0);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toContain('User2');
      expect(result.messages[0].content).toContain('Second transcript');
      expect(result.messages[1].content).toContain('User1');
      expect(result.messages[1].content).toContain('First transcript');
    });

    it('preserves voice messages without transcripts', () => {
      const voiceMsg = createMockMessage({
        id: 'voice-1',
        authorId: USER_ID,
        content: '',
        createdTimestamp: 1000,
        attachments: [{ id: 'att-1', contentType: 'audio/ogg', duration: 5.0 }],
      });

      const result = mergeVoiceContext([voiceMsg], BOT_USER_ID);

      expect(result.mergedCount).toBe(0);
      expect(result.unmergedCount).toBe(1);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].id).toBe('voice-1');
    });

    it('handles orphan transcripts (voice message not in window)', () => {
      // Only the transcript, voice message was outside fetch window
      const transcriptMsg = createMockMessage({
        id: 'transcript-1',
        authorId: BOT_USER_ID,
        content: 'Orphan transcript',
        createdTimestamp: 2000,
        reference: { messageId: 'voice-outside-window' },
      });

      const result = mergeVoiceContext([transcriptMsg], BOT_USER_ID);

      expect(result.mergedCount).toBe(0);
      expect(result.orphanTranscripts).toBe(1);
      // Orphan transcript should be preserved in output
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].id).toBe('transcript-1');
    });

    it('preserves non-voice messages unchanged', () => {
      const textMsg = createMockMessage({
        id: 'text-1',
        authorId: USER_ID,
        content: 'Hello world',
        createdTimestamp: 1000,
      });

      const botResponse = createMockMessage({
        id: 'bot-1',
        authorId: BOT_USER_ID,
        content: 'Hello back!',
        createdTimestamp: 2000,
      });

      const messages = [textMsg, botResponse];

      const result = mergeVoiceContext(messages, BOT_USER_ID);

      expect(result.mergedCount).toBe(0);
      expect(result.unmergedCount).toBe(0);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe('Hello back!');
      expect(result.messages[1].content).toBe('Hello world');
    });

    it('handles mixed content (text + voice)', () => {
      const textMsg = createMockMessage({
        id: 'text-1',
        authorId: USER_ID,
        content: 'Regular message',
        createdTimestamp: 1000,
      });

      const voiceMsg = createMockMessage({
        id: 'voice-1',
        authorId: USER_ID,
        content: '',
        createdTimestamp: 2000,
        attachments: [{ id: 'att-1', contentType: 'audio/ogg', duration: 3.0 }],
        member: { displayName: 'TestUser' },
      });

      const transcriptMsg = createMockMessage({
        id: 'transcript-1',
        authorId: BOT_USER_ID,
        content: 'Voice transcript content',
        createdTimestamp: 3000,
        reference: { messageId: 'voice-1' },
      });

      const anotherTextMsg = createMockMessage({
        id: 'text-2',
        authorId: 'user-789',
        content: 'Another message',
        createdTimestamp: 4000,
      });

      const messages = [textMsg, voiceMsg, transcriptMsg, anotherTextMsg];

      const result = mergeVoiceContext(messages, BOT_USER_ID);

      expect(result.mergedCount).toBe(1);
      expect(result.messages).toHaveLength(3);

      // Check order (newest first after merging)
      expect(result.messages[0].id).toBe('text-2');
      expect(result.messages[1].id).toBe('voice-1');
      expect(result.messages[1].content).toContain('Voice transcript content');
      expect(result.messages[2].id).toBe('text-1');
    });

    it('handles Collection input (Discord.js format)', () => {
      const voiceMsg = createMockMessage({
        id: 'voice-1',
        authorId: USER_ID,
        content: '',
        createdTimestamp: 1000,
        attachments: [{ id: 'att-1', contentType: 'audio/ogg', duration: 3.0 }],
        member: { displayName: 'TestUser' },
      });

      const transcriptMsg = createMockMessage({
        id: 'transcript-1',
        authorId: BOT_USER_ID,
        content: 'Transcript from Collection',
        createdTimestamp: 2000,
        reference: { messageId: 'voice-1' },
      });

      const collection = new Collection<string, Message>();
      collection.set('voice-1', voiceMsg);
      collection.set('transcript-1', transcriptMsg);

      const result = mergeVoiceContext(collection, BOT_USER_ID);

      expect(result.mergedCount).toBe(1);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toContain('Transcript from Collection');
    });

    it('uses fallback author name when member displayName not available', () => {
      const voiceMsg = createMockMessage({
        id: 'voice-1',
        authorId: USER_ID,
        content: '',
        createdTimestamp: 1000,
        attachments: [{ id: 'att-1', contentType: 'audio/ogg', duration: 3.0 }],
        // No member provided - should use author.globalName or username
      });

      const transcriptMsg = createMockMessage({
        id: 'transcript-1',
        authorId: BOT_USER_ID,
        content: 'Fallback name test',
        createdTimestamp: 2000,
        reference: { messageId: 'voice-1' },
      });

      const result = mergeVoiceContext([voiceMsg, transcriptMsg], BOT_USER_ID);

      expect(result.messages[0].content).toContain('TestUser');
    });

    it('returns messages sorted newest-first', () => {
      // Create messages in random order
      const msg3 = createMockMessage({
        id: 'msg-3',
        authorId: USER_ID,
        content: 'Third',
        createdTimestamp: 3000,
      });

      const msg1 = createMockMessage({
        id: 'msg-1',
        authorId: USER_ID,
        content: 'First',
        createdTimestamp: 1000,
      });

      const msg2 = createMockMessage({
        id: 'msg-2',
        authorId: USER_ID,
        content: 'Second',
        createdTimestamp: 2000,
      });

      // Pass in random order
      const result = mergeVoiceContext([msg2, msg3, msg1], BOT_USER_ID);

      // Should be sorted newest first
      expect(result.messages[0].id).toBe('msg-3');
      expect(result.messages[1].id).toBe('msg-2');
      expect(result.messages[2].id).toBe('msg-1');
    });
  });
});
