/**
 * Tests for EmbeddingService
 *
 * Tests the local embedding service wrapper that uses BGE-small-en-v1.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock state
const { mockIsReady, mockGetEmbedding, mockInitialize, mockShutdown } = vi.hoisted(() => ({
  mockIsReady: vi.fn().mockReturnValue(false),
  mockGetEmbedding: vi.fn(),
  mockInitialize: vi.fn().mockResolvedValue(true),
  mockShutdown: vi.fn().mockResolvedValue(undefined),
}));

// Mock the embeddings package
vi.mock('@tzurot/embeddings', () => ({
  LocalEmbeddingService: class MockLocalEmbeddingService {
    isServiceReady = mockIsReady;
    getEmbedding = mockGetEmbedding;
    initialize = mockInitialize;
    shutdown = mockShutdown;
  },
  LOCAL_EMBEDDING_DIMENSIONS: 384,
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
  };
});

// Import once after mocks are set up
import {
  initializeEmbeddingService,
  isEmbeddingServiceAvailable,
  generateEmbedding,
  formatAsVector,
  shutdownEmbeddingService,
  EMBEDDING_DIMENSION,
  __resetForTesting,
} from './EmbeddingService.js';

describe('EmbeddingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetForTesting(); // Reset singleton state instead of expensive module reset
    mockIsReady.mockReturnValue(false);
  });

  describe('initializeEmbeddingService', () => {
    it('should initialize the service successfully', async () => {
      mockInitialize.mockResolvedValue(true);
      mockIsReady.mockReturnValue(true);

      const result = await initializeEmbeddingService();

      expect(result).toBe(true);
      expect(mockInitialize).toHaveBeenCalled();
    });

    it('should return false when initialization fails', async () => {
      mockInitialize.mockResolvedValue(false);

      const result = await initializeEmbeddingService();

      expect(result).toBe(false);
    });

    it('should return false when initialization throws', async () => {
      mockInitialize.mockRejectedValue(new Error('Initialization error'));

      const result = await initializeEmbeddingService();

      expect(result).toBe(false);
    });
  });

  describe('isEmbeddingServiceAvailable', () => {
    it('should return false before initialization', () => {
      expect(isEmbeddingServiceAvailable()).toBe(false);
    });

    it('should return true after successful initialization', async () => {
      mockInitialize.mockResolvedValue(true);
      mockIsReady.mockReturnValue(true);

      await initializeEmbeddingService();

      expect(isEmbeddingServiceAvailable()).toBe(true);
    });
  });

  describe('generateEmbedding', () => {
    const TEST_EMBEDDING = new Float32Array(384).fill(0.1);

    it('should return null when service is not ready', async () => {
      mockIsReady.mockReturnValue(false);

      const result = await generateEmbedding('test text');

      expect(result).toBeNull();
      expect(mockGetEmbedding).not.toHaveBeenCalled();
    });

    it('should generate embedding for text', async () => {
      mockInitialize.mockResolvedValue(true);
      mockIsReady.mockReturnValue(true);
      mockGetEmbedding.mockResolvedValue(TEST_EMBEDDING);

      await initializeEmbeddingService();
      const result = await generateEmbedding('test text');

      expect(result).toEqual(Array.from(TEST_EMBEDDING));
      expect(mockGetEmbedding).toHaveBeenCalledWith('test text');
    });

    it('should return null for empty text', async () => {
      mockInitialize.mockResolvedValue(true);
      mockIsReady.mockReturnValue(true);

      await initializeEmbeddingService();
      const result = await generateEmbedding('   ');

      expect(result).toBeNull();
      expect(mockGetEmbedding).not.toHaveBeenCalled();
    });

    it('should return null when getEmbedding returns undefined', async () => {
      mockInitialize.mockResolvedValue(true);
      mockIsReady.mockReturnValue(true);
      mockGetEmbedding.mockResolvedValue(undefined);

      await initializeEmbeddingService();
      const result = await generateEmbedding('test');

      expect(result).toBeNull();
    });

    it('should return null on wrong dimension', async () => {
      mockInitialize.mockResolvedValue(true);
      mockIsReady.mockReturnValue(true);
      mockGetEmbedding.mockResolvedValue(new Float32Array([0.1, 0.2, 0.3])); // Wrong dimension

      await initializeEmbeddingService();
      const result = await generateEmbedding('test');

      expect(result).toBeNull();
    });
  });

  describe('formatAsVector', () => {
    it('should format embedding as PostgreSQL vector string', () => {
      const result = formatAsVector([0.1, 0.2, 0.3]);

      expect(result).toBe('[0.1,0.2,0.3]');
    });

    it('should throw on non-number elements', () => {
      expect(() => formatAsVector(['malicious' as unknown as number])).toThrow(
        'Invalid embedding: all elements must be finite numbers'
      );
    });

    it('should throw on NaN elements', () => {
      expect(() => formatAsVector([0.1, NaN, 0.3])).toThrow(
        'Invalid embedding: all elements must be finite numbers'
      );
    });

    it('should throw on Infinity elements', () => {
      expect(() => formatAsVector([0.1, Infinity, 0.3])).toThrow(
        'Invalid embedding: all elements must be finite numbers'
      );
    });
  });

  describe('shutdownEmbeddingService', () => {
    it('should shut down the service', async () => {
      mockInitialize.mockResolvedValue(true);
      mockIsReady.mockReturnValue(true);

      await initializeEmbeddingService();
      await shutdownEmbeddingService();

      expect(mockShutdown).toHaveBeenCalled();
    });

    it('should be safe to call when not initialized', async () => {
      // Should not throw
      await expect(shutdownEmbeddingService()).resolves.not.toThrow();
    });
  });

  describe('EMBEDDING_DIMENSION', () => {
    it('should export 384 dimensions for BGE model', () => {
      expect(EMBEDDING_DIMENSION).toBe(384);
    });
  });
});
