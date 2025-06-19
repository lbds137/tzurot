/**
 * Test suite for messageFormatter module
 */

const { EmbedBuilder } = require('discord.js');
const {
  MESSAGE_CHAR_LIMIT,
  splitByCharacterLimit,
  processSentence,
  processLine,
  processParagraph,
  splitMessage,
  markErrorContent,
  prepareMessageData,
} = require('../../../src/utils/messageFormatter');

// Mock dependencies
jest.mock('../../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/constants', () => ({
  ERROR_MESSAGES: [
    'connection timed out',
    'rate limit',
    'authentication failed',
    'ERROR_PREFIX_MARKER',
    'HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY',
  ],
  MARKERS: {
    ERROR_PREFIX: 'ERROR_PREFIX_MARKER',
    HARD_BLOCKED_RESPONSE: 'HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY',
  },
}));

describe('messageFormatter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('splitByCharacterLimit', () => {
    it('should return content as is when under limit', () => {
      const result = splitByCharacterLimit('Short message');
      expect(result).toEqual(['Short message']);
    });

    it('should handle empty or null content', () => {
      const emptyString = '';
      expect(splitByCharacterLimit(emptyString)).toEqual(['']);
      expect(splitByCharacterLimit(null)).toEqual(['']);
      expect(splitByCharacterLimit(undefined)).toEqual(['']);
    });

    it('should split long text at word boundaries', () => {
      const longText = 'word '.repeat(500); // 2500 characters
      const result = splitByCharacterLimit(longText);

      expect(result.length).toBeGreaterThan(1);
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(MESSAGE_CHAR_LIMIT);
      });

      // Should split at spaces, not in the middle of words
      expect(result[0].endsWith('word')).toBe(true);
    });

    it('should handle text without spaces', () => {
      const longText = 'a'.repeat(MESSAGE_CHAR_LIMIT + 500);
      const result = splitByCharacterLimit(longText);

      expect(result).toHaveLength(2);
      expect(result[0].length).toBe(MESSAGE_CHAR_LIMIT);
      expect(result[1].length).toBe(500);
    });

    it('should trim whitespace between chunks', () => {
      const longText = 'a'.repeat(1999) + '   ' + 'b'.repeat(10);
      const result = splitByCharacterLimit(longText);

      expect(result).toHaveLength(2);
      expect(result[1]).toBe('b'.repeat(10));
    });
  });

  describe('processSentence', () => {
    it('should add sentence to current chunk when within limit', () => {
      const chunks = [];
      const result = processSentence('This is a sentence.', chunks, 'Current chunk');

      expect(result).toBe('Current chunk This is a sentence.');
      expect(chunks).toHaveLength(0);
    });

    it('should start new chunk when sentence would exceed limit', () => {
      const chunks = [];
      const currentChunk = 'a'.repeat(1990);
      const result = processSentence('This is a sentence.', chunks, currentChunk);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(currentChunk);
      expect(result).toBe('This is a sentence.');
    });

    it('should split very long sentences', () => {
      const chunks = [];
      const longSentence = 'a'.repeat(MESSAGE_CHAR_LIMIT + 100);
      const result = processSentence(longSentence, chunks, 'Current');

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]).toBe('Current');
      expect(result).toBe('');
    });

    it('should handle empty current chunk', () => {
      const chunks = [];
      const result = processSentence('First sentence.', chunks, '');

      expect(result).toBe('First sentence.');
      expect(chunks).toHaveLength(0);
    });
  });

  describe('processLine', () => {
    it('should add line to current chunk with newline', () => {
      const chunks = [];
      const result = processLine('New line', chunks, 'Current chunk');

      expect(result).toBe('Current chunk\nNew line');
      expect(chunks).toHaveLength(0);
    });

    it('should start new chunk when line would exceed limit', () => {
      const chunks = [];
      const currentChunk = 'a'.repeat(1995); // 1995 + 8 + 1 = 2004, which exceeds 2000
      const result = processLine('New line', chunks, currentChunk);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(currentChunk);
      expect(result).toBe('New line');
    });

    it('should split very long lines by sentences', () => {
      const chunks = [];
      const longLine = 'First sentence. ' + 'a'.repeat(MESSAGE_CHAR_LIMIT) + '. Last sentence.';
      const result = processLine(longLine, chunks, '');

      expect(chunks.length).toBeGreaterThan(0);
      expect(result).toBe('');
    });

    it('should handle empty current chunk', () => {
      const chunks = [];
      const result = processLine('First line', chunks, '');

      expect(result).toBe('First line');
      expect(chunks).toHaveLength(0);
    });
  });

  describe('processParagraph', () => {
    it('should add paragraph to current chunk with double newline', () => {
      const chunks = [];
      const result = processParagraph('New paragraph', chunks, 'Current chunk');

      expect(result).toBe('Current chunk\n\nNew paragraph');
      expect(chunks).toHaveLength(0);
    });

    it('should start new chunk when paragraph would exceed limit', () => {
      const chunks = [];
      const currentChunk = 'a'.repeat(1990);
      const result = processParagraph('New paragraph', chunks, currentChunk);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(currentChunk);
      expect(result).toBe('New paragraph');
    });

    it('should split very long paragraphs by lines', () => {
      const chunks = [];
      const longParagraph = Array(10).fill('a'.repeat(300)).join('\n');
      const result = processParagraph(longParagraph, chunks, '');

      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle empty current chunk', () => {
      const chunks = [];
      const result = processParagraph('First paragraph', chunks, '');

      expect(result).toBe('First paragraph');
      expect(chunks).toHaveLength(0);
    });
  });

  describe('splitMessage', () => {
    it('should return content as is when under limit', () => {
      const result = splitMessage('Short message');
      expect(result).toEqual(['Short message']);
    });

    it('should handle empty or null content', () => {
      expect(splitMessage('')).toEqual(['']);
      expect(splitMessage(null)).toEqual(['']);
      expect(splitMessage(undefined)).toEqual(['']);
    });

    it('should split by paragraphs first', () => {
      const content = 'First paragraph\n\nSecond paragraph\n\nThird paragraph';
      const result = splitMessage(content);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain('First paragraph');
      expect(result[0]).toContain('Second paragraph');
      expect(result[0]).toContain('Third paragraph');
    });

    it('should handle very long paragraphs', () => {
      const longParagraph = 'a'.repeat(MESSAGE_CHAR_LIMIT + 100);
      const content = `Short intro\n\n${longParagraph}\n\nShort outro`;
      const result = splitMessage(content);

      expect(result.length).toBeGreaterThan(1);
      expect(result[0]).toContain('Short intro');
    });

    it('should preserve paragraph structure when possible', () => {
      const para1 = 'a'.repeat(1800);
      const para2 = 'b'.repeat(300);
      const content = `${para1}\n\n${para2}`;
      const result = splitMessage(content);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(para1);
      expect(result[1]).toBe(para2);
    });

    it('should handle complex content with multiple paragraphs and lines', () => {
      const content = `
        Title of the Document
        
        This is the first paragraph with multiple sentences. It has quite a bit of content.
        It also has multiple lines within the same paragraph.
        
        ${['word'].join(' ').repeat(500)}
        
        Final paragraph here.
      `.trim();

      const result = splitMessage(content);
      expect(result.length).toBeGreaterThan(0);

      // Verify all content is preserved
      const joined = result.join('');
      expect(joined.replace(/\s+/g, '')).toBe(content.replace(/\s+/g, ''));
    });
  });

  describe('markErrorContent', () => {
    it('should return empty string for falsy content', () => {
      expect(markErrorContent('')).toBe('');
      expect(markErrorContent(null)).toBe('');
      expect(markErrorContent(undefined)).toBe('');
    });

    it('should add error prefix for connection + unstable combination', () => {
      const result = markErrorContent('The connection seems unstable right now');
      expect(result).toBe('ERROR_PREFIX_MARKER The connection seems unstable right now');
    });

    it('should add error prefix for standard error patterns', () => {
      const result = markErrorContent('Sorry, connection timed out');
      expect(result).toBe('ERROR_PREFIX_MARKER Sorry, connection timed out');
    });

    it('should not add prefix for normal content', () => {
      const result = markErrorContent('This is a normal message');
      expect(result).toBe('This is a normal message');
    });

    it('should skip marker patterns to avoid duplication', () => {
      const result = markErrorContent('ERROR_PREFIX_MARKER already present');
      expect(result).toBe('ERROR_PREFIX_MARKER already present');
      expect(result.match(/ERROR_PREFIX_MARKER/g)).toHaveLength(1);
    });
  });

  describe('prepareMessageData', () => {
    it('should prepare basic message data', () => {
      const result = prepareMessageData(
        'Hello world',
        'TestUser',
        'https://example.com/avatar.jpg',
        false,
        null
      );

      expect(result).toEqual({
        content: 'Hello world',
        username: 'TestUser',
        avatarURL: 'https://example.com/avatar.jpg',
        allowedMentions: { parse: ['users', 'roles'] },
      });
    });

    it('should handle thread messages', () => {
      const result = prepareMessageData('Thread message', 'TestUser', null, true, 'thread123');

      expect(result).toEqual({
        content: 'Thread message',
        username: 'TestUser',
        avatarURL: null,
        allowedMentions: { parse: ['users', 'roles'] },
        threadId: 'thread123',
        _isThread: true,
        _originalChannel: undefined,
      });
    });

    it('should handle options with embed', () => {
      const embedData = { title: 'Test Embed', description: 'Test Description' };
      const result = prepareMessageData('Message with embed', 'TestUser', null, false, null, {
        embed: embedData,
      });

      expect(result.embeds).toHaveLength(1);
      expect(result.embeds[0]).toBeInstanceOf(EmbedBuilder);
    });

    it('should handle options with files', () => {
      const files = ['file1.txt', 'file2.png'];
      const result = prepareMessageData('Message with files', 'TestUser', null, false, null, {
        files,
      });

      expect(result.files).toEqual(files);
    });

    it('should handle options with attachments', () => {
      const attachments = [{ attachment: 'audio.mp3' }];
      const result = prepareMessageData('Message with audio', 'TestUser', null, false, null, {
        attachments,
      });

      expect(result.files).toEqual(attachments);
    });

    it('should merge files and attachments', () => {
      const files = ['file1.txt'];
      const attachments = [{ attachment: 'audio.mp3' }];
      const result = prepareMessageData('Message with both', 'TestUser', null, false, null, {
        files,
        attachments,
      });

      expect(result.files).toHaveLength(2);
      expect(result.files).toContain('file1.txt');
      expect(result.files).toContainEqual({ attachment: 'audio.mp3' });
    });

    it('should preserve original channel for threads', () => {
      const originalChannel = { id: 'channel123', name: 'test-channel' };
      const result = prepareMessageData('Thread message', 'TestUser', null, true, 'thread123', {
        _originalChannel: originalChannel,
      });

      expect(result._originalChannel).toBe(originalChannel);
    });
  });
});
