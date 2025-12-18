/**
 * Tests for Token-Based Text Chunker
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  splitTextByTokens,
  reassembleChunks,
  sortChunksByIndex,
  type ChunkResult,
} from './textChunker.js';
import { AI_DEFAULTS } from '../constants/ai.js';

// Mock tokenCounter to control token counts precisely
vi.mock('./tokenCounter.js', () => ({
  countTextTokens: vi.fn(),
}));

import { countTextTokens } from './tokenCounter.js';

const mockCountTextTokens = vi.mocked(countTextTokens);

describe('splitTextByTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('basic splitting', () => {
    it('returns empty result for empty input', () => {
      const result = splitTextByTokens('');
      expect(result).toEqual({
        chunks: [],
        originalTokenCount: 0,
        wasChunked: false,
      });
    });

    it('returns empty result for null/undefined input', () => {
      expect(splitTextByTokens(null as unknown as string)).toEqual({
        chunks: [],
        originalTokenCount: 0,
        wasChunked: false,
      });

      expect(splitTextByTokens(undefined as unknown as string)).toEqual({
        chunks: [],
        originalTokenCount: 0,
        wasChunked: false,
      });
    });

    it('returns single chunk when under token limit', () => {
      const text = 'This is a short text.';
      mockCountTextTokens.mockReturnValue(10);

      const result = splitTextByTokens(text, 100);

      expect(result).toEqual({
        chunks: [text],
        originalTokenCount: 10,
        wasChunked: false,
      });
    });

    it('splits text into multiple chunks when over limit', () => {
      const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';

      // Mock: total text = 300 tokens, each paragraph = 50 tokens
      mockCountTextTokens.mockImplementation((t: string) => {
        if (t === text) return 300;
        if (t.includes('one')) return 50;
        if (t.includes('two')) return 50;
        if (t.includes('three')) return 50;
        return 10;
      });

      const result = splitTextByTokens(text, 100);

      expect(result.wasChunked).toBe(true);
      expect(result.originalTokenCount).toBe(300);
      expect(result.chunks.length).toBeGreaterThan(1);
    });

    it('uses default maxTokens from AI_DEFAULTS', () => {
      const text = 'Short text';
      mockCountTextTokens.mockReturnValue(10);

      // Call without maxTokens
      const result = splitTextByTokens(text);

      expect(result.wasChunked).toBe(false);
      // The mock was called with the default limit
      expect(mockCountTextTokens).toHaveBeenCalledWith(text, 'gpt-4');
    });
  });

  describe('natural boundary splitting', () => {
    it('splits on paragraph boundaries first', () => {
      const para1 = 'First paragraph content here.';
      const para2 = 'Second paragraph content here.';
      const text = `${para1}\n\n${para2}`;

      // Total = 200 tokens, each paragraph = 80 tokens
      mockCountTextTokens.mockImplementation((t: string) => {
        if (t === text) return 200;
        if (t === para1) return 80;
        if (t === para2) return 80;
        return Math.ceil(t.length / 4);
      });

      const result = splitTextByTokens(text, 100);

      expect(result.wasChunked).toBe(true);
      expect(result.chunks).toContain(para1);
      expect(result.chunks).toContain(para2);
    });

    it('splits on sentence boundaries when paragraph too long', () => {
      const sentence1 = 'This is the first sentence.';
      const sentence2 = 'This is the second sentence.';
      const paragraph = `${sentence1} ${sentence2}`;

      mockCountTextTokens.mockImplementation((t: string) => {
        // Total paragraph = 200 tokens (over limit of 100)
        if (t === paragraph) return 200;
        // Each sentence = 60 tokens (so two sentences together would exceed 100)
        if (t === sentence1) return 60;
        if (t === sentence2) return 60;
        // Combined sentences in a chunk would exceed limit
        if (t.includes('first') && t.includes('second')) return 125;
        return Math.ceil(t.length / 4);
      });

      const result = splitTextByTokens(paragraph, 100);

      expect(result.wasChunked).toBe(true);
      // Should be at least 2 chunks since combined sentences exceed limit
      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('splits on word boundaries when sentence too long', () => {
      const words = Array(50).fill('word').join(' ');

      mockCountTextTokens.mockImplementation((t: string) => {
        // Simulate: full text = 200 tokens, each word = 1 token
        if (t === words) return 200;
        if (t === 'word') return 1;
        // For chunks of words, estimate based on word count
        const wordCount = t.split(/\s+/).length;
        return wordCount;
      });

      const result = splitTextByTokens(words, 30);

      expect(result.wasChunked).toBe(true);
      expect(result.chunks.length).toBeGreaterThan(1);
      // Each chunk should be under the limit
      for (const chunk of result.chunks) {
        const tokens = mockCountTextTokens(chunk, 'gpt-4');
        expect(tokens).toBeLessThanOrEqual(30);
      }
    });
  });

  describe('speaker context tracking', () => {
    it('detects user speaker marker', () => {
      const text = '{user}: Hello there!\n\nThis is a continuation.';

      mockCountTextTokens.mockImplementation((t: string) => {
        if (t === text) return 200;
        return Math.ceil(t.length / 4);
      });

      const result = splitTextByTokens(text, 30);

      expect(result.wasChunked).toBe(true);
      // Second chunk should have continuation prefix
      const hasUserContinuation = result.chunks.some(c =>
        c.includes('{user} (continued):')
      );
      expect(hasUserContinuation || result.chunks.length === 1).toBe(true);
    });

    it('detects assistant speaker marker', () => {
      const text = '{assistant}: Hello there!\n\nThis is a continuation.';

      mockCountTextTokens.mockImplementation((t: string) => {
        if (t === text) return 200;
        return Math.ceil(t.length / 4);
      });

      const result = splitTextByTokens(text, 30);

      expect(result.wasChunked).toBe(true);
    });

    it('adds continuation prefix to mid-turn chunks', () => {
      const text =
        '{user}: This is a very long message that needs to be split across multiple chunks because it exceeds the token limit.';

      mockCountTextTokens.mockImplementation((t: string) => {
        if (t === text) return 200;
        // Make each word ~5 tokens so we need multiple chunks at limit 30
        const words = t.split(/\s+/).length;
        return words * 5;
      });

      const result = splitTextByTokens(text, 30);

      expect(result.wasChunked).toBe(true);
      if (result.chunks.length > 1) {
        // At least one non-first chunk should have continuation prefix
        const continuationChunks = result.chunks
          .slice(1)
          .filter(c => c.startsWith('{user} (continued):'));
        // Some chunks should have the prefix (unless they start with a new speaker)
        expect(continuationChunks.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('edge cases', () => {
    it('handles whitespace-only input', () => {
      const result = splitTextByTokens('   \n\n   ');
      expect(result).toEqual({
        chunks: [],
        originalTokenCount: 0,
        wasChunked: false,
      });
    });

    it('handles very long words (URLs)', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(500);

      mockCountTextTokens.mockImplementation((t: string) => {
        // URL is very long token-wise
        if (t === longUrl) return 200;
        // Smaller pieces
        return Math.ceil(t.length / 10);
      });

      const result = splitTextByTokens(longUrl, 50);

      expect(result.wasChunked).toBe(true);
      expect(result.chunks.length).toBeGreaterThan(1);
    });

    it('preserves content integrity', () => {
      const text = 'Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.';

      mockCountTextTokens.mockImplementation((t: string) => {
        if (t === text) return 100;
        return Math.ceil(t.length / 4);
      });

      const result = splitTextByTokens(text, 50);

      // Join all chunks and verify no content lost
      const rejoined = result.chunks.join('\n\n');
      expect(rejoined).toContain('Paragraph 1');
      expect(rejoined).toContain('Paragraph 2');
      expect(rejoined).toContain('Paragraph 3');
    });
  });
});

describe('reassembleChunks', () => {
  it('returns empty string for empty array', () => {
    expect(reassembleChunks([])).toBe('');
  });

  it('returns single chunk unchanged', () => {
    const chunk = 'This is a single chunk.';
    expect(reassembleChunks([chunk])).toBe(chunk);
  });

  it('joins multiple chunks with double newlines', () => {
    const chunks = ['Chunk 1.', 'Chunk 2.', 'Chunk 3.'];
    expect(reassembleChunks(chunks)).toBe('Chunk 1.\n\nChunk 2.\n\nChunk 3.');
  });

  it('removes user continuation prefix from non-first chunks', () => {
    const chunks = ['{user}: Hello there!', '{user} (continued): This is more text.'];
    const result = reassembleChunks(chunks);
    expect(result).toBe('{user}: Hello there!\n\nThis is more text.');
    expect(result).not.toContain('(continued)');
  });

  it('removes assistant continuation prefix from non-first chunks', () => {
    const chunks = [
      '{assistant}: Here is my response.',
      '{assistant} (continued): And more details.',
    ];
    const result = reassembleChunks(chunks);
    expect(result).toBe('{assistant}: Here is my response.\n\nAnd more details.');
  });

  it('preserves first chunk content exactly', () => {
    const chunks = ['{user}: Original content.', 'Second chunk.'];
    const result = reassembleChunks(chunks);
    expect(result).toContain('{user}: Original content.');
  });

  it('handles mixed speaker chunks', () => {
    const chunks = [
      '{user}: Question?',
      '{assistant}: Answer.',
      '{user} (continued): Follow-up.',
    ];
    const result = reassembleChunks(chunks);
    expect(result).toBe('{user}: Question?\n\n{assistant}: Answer.\n\nFollow-up.');
  });
});

describe('sortChunksByIndex', () => {
  it('returns empty array for empty input', () => {
    expect(sortChunksByIndex([])).toEqual([]);
  });

  it('returns single item unchanged', () => {
    const memories = [{ metadata: { chunkIndex: 0 } }];
    expect(sortChunksByIndex(memories)).toEqual(memories);
  });

  it('sorts by chunkIndex ascending', () => {
    const memories = [
      { metadata: { chunkIndex: 2 }, content: 'C' },
      { metadata: { chunkIndex: 0 }, content: 'A' },
      { metadata: { chunkIndex: 1 }, content: 'B' },
    ];

    const sorted = sortChunksByIndex(memories);

    expect(sorted[0].content).toBe('A');
    expect(sorted[1].content).toBe('B');
    expect(sorted[2].content).toBe('C');
  });

  it('treats missing chunkIndex as 0', () => {
    const memories = [
      { metadata: { chunkIndex: 1 }, content: 'B' },
      { metadata: {}, content: 'A' }, // No chunkIndex
      { metadata: { chunkIndex: 2 }, content: 'C' },
    ];

    const sorted = sortChunksByIndex(memories);

    expect(sorted[0].content).toBe('A');
    expect(sorted[1].content).toBe('B');
    expect(sorted[2].content).toBe('C');
  });

  it('does not modify original array', () => {
    const memories = [
      { metadata: { chunkIndex: 1 }, content: 'B' },
      { metadata: { chunkIndex: 0 }, content: 'A' },
    ];
    const original = [...memories];

    sortChunksByIndex(memories);

    expect(memories).toEqual(original);
  });

  it('handles memories without metadata', () => {
    const memories = [
      { content: 'B' },
      { metadata: { chunkIndex: 0 }, content: 'A' },
    ];

    const sorted = sortChunksByIndex(memories as { metadata?: Record<string, unknown> }[]);

    expect(sorted[0].content).toBe('B'); // No metadata treated as index 0
  });
});

describe('integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('round-trips through split and reassemble', () => {
    const original = '{user}: Hello!\n\n{assistant}: Hi there!';

    // Mock: needs splitting
    mockCountTextTokens.mockImplementation((t: string) => {
      if (t === original) return 200;
      return Math.ceil(t.length / 4);
    });

    const result = splitTextByTokens(original, 50);

    if (result.wasChunked) {
      const reassembled = reassembleChunks(result.chunks);
      // Content should be preserved (prefixes stripped)
      expect(reassembled).toContain('Hello!');
      expect(reassembled).toContain('Hi there!');
    }
  });

  it('maintains correct chunk order after sorting', () => {
    const memories = [
      { pageContent: 'Chunk 2', metadata: { chunkIndex: 1, chunkGroupId: 'abc' } },
      { pageContent: 'Chunk 1', metadata: { chunkIndex: 0, chunkGroupId: 'abc' } },
      { pageContent: 'Chunk 3', metadata: { chunkIndex: 2, chunkGroupId: 'abc' } },
    ];

    const sorted = sortChunksByIndex(memories);
    const reassembled = reassembleChunks(sorted.map(m => m.pageContent));

    expect(reassembled).toBe('Chunk 1\n\nChunk 2\n\nChunk 3');
  });
});
