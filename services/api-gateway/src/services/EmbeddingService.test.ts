/**
 * Tests for EmbeddingService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mocks
const { mockCreate, mockConfig } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockConfig: {
    OPENAI_API_KEY: 'test-api-key' as string | undefined,
    EMBEDDING_MODEL: 'text-embedding-3-small',
  },
}));

// Mock OpenAI with class constructor
vi.mock('openai', () => ({
  OpenAI: class MockOpenAI {
    embeddings = {
      create: mockCreate,
    };
  },
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    getConfig: () => mockConfig,
    MODEL_DEFAULTS: {
      EMBEDDING: 'text-embedding-3-small',
    },
  };
});

describe('EmbeddingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('isEmbeddingServiceAvailable', () => {
    it('should return true when OPENAI_API_KEY is configured', { timeout: 10000 }, async () => {
      mockConfig.OPENAI_API_KEY = 'test-key';
      const { isEmbeddingServiceAvailable } = await import('./EmbeddingService.js');
      expect(isEmbeddingServiceAvailable()).toBe(true);
    });

    it('should return false when OPENAI_API_KEY is not configured', async () => {
      mockConfig.OPENAI_API_KEY = undefined;
      const { isEmbeddingServiceAvailable } = await import('./EmbeddingService.js');
      expect(isEmbeddingServiceAvailable()).toBe(false);
    });
  });

  describe('generateEmbedding', () => {
    const TEST_EMBEDDING = new Array(1536).fill(0.1);

    beforeEach(() => {
      mockConfig.OPENAI_API_KEY = 'test-key';
      mockCreate.mockResolvedValue({
        data: [{ embedding: TEST_EMBEDDING }],
      });
    });

    it('should generate embedding for text', async () => {
      const { generateEmbedding } = await import('./EmbeddingService.js');

      const result = await generateEmbedding('test text');

      expect(result).toEqual(TEST_EMBEDDING);
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test text',
      });
    });

    it('should return null for empty text', async () => {
      const { generateEmbedding } = await import('./EmbeddingService.js');

      const result = await generateEmbedding('   ');

      expect(result).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should return null when service is not available', async () => {
      mockConfig.OPENAI_API_KEY = undefined;
      const { generateEmbedding } = await import('./EmbeddingService.js');

      const result = await generateEmbedding('test text');

      expect(result).toBeNull();
    });

    it('should throw on invalid embedding dimension', async () => {
      mockCreate.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3] }], // Wrong dimension
      });
      const { generateEmbedding } = await import('./EmbeddingService.js');

      await expect(generateEmbedding('test')).rejects.toThrow('Invalid embedding dimension');
    });

    it('should throw on empty API response', async () => {
      mockCreate.mockResolvedValue({ data: [] });
      const { generateEmbedding } = await import('./EmbeddingService.js');

      await expect(generateEmbedding('test')).rejects.toThrow('empty data array');
    });
  });

  describe('formatAsVector', () => {
    it('should format embedding as PostgreSQL vector string', async () => {
      const { formatAsVector } = await import('./EmbeddingService.js');

      const result = formatAsVector([0.1, 0.2, 0.3]);

      expect(result).toBe('[0.1,0.2,0.3]');
    });

    it('should throw on non-number elements', async () => {
      const { formatAsVector } = await import('./EmbeddingService.js');

      expect(() => formatAsVector(['malicious' as unknown as number])).toThrow(
        'Invalid embedding: all elements must be finite numbers'
      );
    });

    it('should throw on NaN elements', async () => {
      const { formatAsVector } = await import('./EmbeddingService.js');

      expect(() => formatAsVector([0.1, NaN, 0.3])).toThrow(
        'Invalid embedding: all elements must be finite numbers'
      );
    });

    it('should throw on Infinity elements', async () => {
      const { formatAsVector } = await import('./EmbeddingService.js');

      expect(() => formatAsVector([0.1, Infinity, 0.3])).toThrow(
        'Invalid embedding: all elements must be finite numbers'
      );
    });
  });
});
