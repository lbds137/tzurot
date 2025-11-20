/**
 * Test suite for messageSplitting utility
 */

const {
  MESSAGE_CHAR_LIMIT,
  splitByCharacterLimit,
  processSentence,
  processLine,
  processParagraph,
  splitMessage,
  prepareAndSplitMessage,
  chunkHelpers,
} = require('../../../src/utils/messageSplitting');

// Mock dependencies
jest.mock('../../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('Message Splitting Utilities', () => {
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

      // Verify content is preserved
      expect(result.join(' ')).toContain('word word word');
    });

    it('should handle text without spaces', () => {
      const longText = 'a'.repeat(MESSAGE_CHAR_LIMIT + 500);
      const result = splitByCharacterLimit(longText);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(MESSAGE_CHAR_LIMIT);
      expect(result[1]).toHaveLength(500);
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

    it('should create new chunk when sentence exceeds limit', () => {
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
      expect(result.length).toBeLessThanOrEqual(MESSAGE_CHAR_LIMIT);
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

    it('should create new chunk when line exceeds limit', () => {
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
      // Verify the line was split into manageable chunks
      expect(result.length).toBeLessThanOrEqual(MESSAGE_CHAR_LIMIT);
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

    it('should create new chunk when paragraph exceeds limit', () => {
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
      expect(result.length).toBeLessThanOrEqual(MESSAGE_CHAR_LIMIT);
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
      expect(result[0]).toBe(content);
    });

    it('should handle mixed content with long paragraphs', () => {
      const longParagraph = 'a'.repeat(MESSAGE_CHAR_LIMIT + 100);
      const content = `Short intro\n\n${longParagraph}\n\nShort outro`;
      const result = splitMessage(content);

      expect(result.length).toBeGreaterThan(1);
      // Verify all chunks are within limit
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(MESSAGE_CHAR_LIMIT);
      });
    });

    it('should preserve paragraph separation when splitting', () => {
      const para1 = 'a'.repeat(1800);
      const para2 = 'b'.repeat(300);
      const content = `${para1}\n\n${para2}`;
      const result = splitMessage(content);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(para1);
      expect(result[1]).toBe(para2);
    });

    it('should handle code blocks and special formatting', () => {
      const content = `
Here is some code:

\`\`\`javascript
function example() {
  return "This is a very long function that might need to be split across messages";
}
\`\`\`

And some more text after the code block.
      `.trim();

      const result = splitMessage(content);
      expect(result.length).toBeGreaterThan(0);

      // Verify content is preserved
      const rejoined = result.join('\n\n');
      expect(rejoined).toContain('```javascript');
      expect(rejoined).toContain('function example()');
    });
  });

  describe('prepareAndSplitMessage', () => {
    const mockLogger = require('../../../src/logger');

    it('should split message without model indicator', () => {
      const content = 'Test message';
      const options = {};
      
      const result = prepareAndSplitMessage(content, options, 'Test');
      
      expect(result).toEqual(['Test message']);
      expect(mockLogger.info).toHaveBeenCalledWith('[Test] Split message into 1 chunks');
    });

    it('should append model indicator before splitting', () => {
      const content = 'A'.repeat(1995);
      const options = { modelIndicator: ' (AI)' };
      
      const result = prepareAndSplitMessage(content, options, 'Test');
      
      // With indicator, total is 2000 chars - should still be one chunk
      expect(result).toHaveLength(1);
      expect(result[0].endsWith(' (AI)')).toBe(true);
      expect(result[0].length).toBe(2000);
    });

    it('should split when content + indicator exceeds limit', () => {
      const content = 'B'.repeat(1996);
      const options = { modelIndicator: ' (AI)' };
      
      const result = prepareAndSplitMessage(content, options, 'Test');
      
      // With indicator, total exceeds 2000 - should split
      expect(result.length).toBeGreaterThan(1);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Split message into'));
    });

    it('should handle null options gracefully', () => {
      const content = 'Test message';
      
      const result = prepareAndSplitMessage(content, null, 'Test');
      
      expect(result).toEqual(['Test message']);
    });
  });

  describe('chunkHelpers', () => {
    it('should correctly identify first chunk', () => {
      expect(chunkHelpers.isFirstChunk(0)).toBe(true);
      expect(chunkHelpers.isFirstChunk(1)).toBe(false);
      expect(chunkHelpers.isFirstChunk(5)).toBe(false);
    });

    it('should correctly identify last chunk', () => {
      expect(chunkHelpers.isLastChunk(0, 1)).toBe(true); // Single chunk
      expect(chunkHelpers.isLastChunk(2, 3)).toBe(true); // Last of three
      expect(chunkHelpers.isLastChunk(1, 3)).toBe(false); // Middle chunk
      expect(chunkHelpers.isLastChunk(0, 3)).toBe(false); // First of three
    });

    it('should return consistent chunk delay', () => {
      const delay = chunkHelpers.getChunkDelay();
      expect(delay).toBe(750);
      expect(typeof delay).toBe('number');
    });
  });
});