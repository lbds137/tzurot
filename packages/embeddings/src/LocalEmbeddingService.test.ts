/**
 * Tests for LocalEmbeddingService
 *
 * Tests the embedding service's math operations, caching behavior, and state management.
 * Worker thread interactions are mocked since actual model loading is slow and
 * not suitable for unit tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LocalEmbeddingService,
  LOCAL_EMBEDDING_DIMENSIONS,
  SEMANTIC_SIMILARITY_THRESHOLD,
  EMBEDDING_SLIDING_WINDOW_SIZE,
} from './index.js';

// Mock worker_threads module
vi.mock('node:worker_threads', () => ({
  Worker: vi.fn(),
}));

describe('LocalEmbeddingService', () => {
  describe('constants', () => {
    it('should use 384 dimensions for bge-small-en-v1.5', () => {
      expect(LOCAL_EMBEDDING_DIMENSIONS).toBe(384);
    });

    it('should use 0.88 semantic similarity threshold', () => {
      expect(SEMANTIC_SIMILARITY_THRESHOLD).toBe(0.88);
    });

    it('should cache last 10 embeddings', () => {
      expect(EMBEDDING_SLIDING_WINDOW_SIZE).toBe(10);
    });
  });

  describe('cosineSimilarity', () => {
    let service: LocalEmbeddingService;

    beforeEach(() => {
      service = new LocalEmbeddingService();
    });

    it('should return 1 for identical normalized vectors', () => {
      // Normalized unit vector (magnitude = 1)
      const vec = new Float32Array([0.6, 0.8, 0, 0]);
      const similarity = service.cosineSimilarity(vec, vec);
      expect(similarity).toBeCloseTo(1, 5);
    });

    it('should return -1 for opposite normalized vectors', () => {
      const vecA = new Float32Array([1, 0, 0, 0]);
      const vecB = new Float32Array([-1, 0, 0, 0]);
      const similarity = service.cosineSimilarity(vecA, vecB);
      expect(similarity).toBeCloseTo(-1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vecA = new Float32Array([1, 0, 0, 0]);
      const vecB = new Float32Array([0, 1, 0, 0]);
      const similarity = service.cosineSimilarity(vecA, vecB);
      expect(similarity).toBeCloseTo(0, 5);
    });

    it('should throw error for dimension mismatch', () => {
      const vecA = new Float32Array([1, 0, 0]);
      const vecB = new Float32Array([1, 0, 0, 0]);
      expect(() => service.cosineSimilarity(vecA, vecB)).toThrow('Vector dimension mismatch');
    });

    it('should calculate correct similarity for similar vectors', () => {
      // Two vectors at ~30 degrees apart (cos(30) ≈ 0.866)
      const vecA = new Float32Array([1, 0, 0, 0]);
      const vecB = new Float32Array([0.866, 0.5, 0, 0]); // ~30 degrees from vecA
      const similarity = service.cosineSimilarity(vecA, vecB);
      expect(similarity).toBeCloseTo(0.866, 2);
    });

    it('should work with full 384-dimension vectors', () => {
      // Create two random but similar vectors
      const vecA = new Float32Array(384);
      const vecB = new Float32Array(384);

      for (let i = 0; i < 384; i++) {
        vecA[i] = Math.random() - 0.5;
        vecB[i] = vecA[i] + (Math.random() - 0.5) * 0.1; // Small perturbation
      }

      // Normalize vectors
      const normA = Math.sqrt(vecA.reduce((sum, v) => sum + v * v, 0));
      const normB = Math.sqrt(vecB.reduce((sum, v) => sum + v * v, 0));
      for (let i = 0; i < 384; i++) {
        vecA[i] /= normA;
        vecB[i] /= normB;
      }

      const similarity = service.cosineSimilarity(vecA, vecB);
      // Should be high since vectors are similar
      expect(similarity).toBeGreaterThan(0.9);
    });
  });

  describe('embedding cache', () => {
    let service: LocalEmbeddingService;

    beforeEach(() => {
      service = new LocalEmbeddingService();
    });

    it('should store and retrieve embeddings', () => {
      const hash = 'test-hash-123';
      const embedding = new Float32Array([0.1, 0.2, 0.3]);

      service.storeEmbedding(hash, embedding);
      const retrieved = service.getStoredEmbedding(hash);

      expect(retrieved).toEqual(embedding);
    });

    it('should return undefined for non-existent hash', () => {
      const result = service.getStoredEmbedding('non-existent');
      expect(result).toBeUndefined();
    });

    it('should return all stored embeddings', () => {
      service.storeEmbedding('hash1', new Float32Array([1, 0, 0]));
      service.storeEmbedding('hash2', new Float32Array([0, 1, 0]));
      service.storeEmbedding('hash3', new Float32Array([0, 0, 1]));

      const all = service.getAllStoredEmbeddings();

      expect(all.length).toBe(3);
      expect(all.map(e => e.hash)).toContain('hash1');
      expect(all.map(e => e.hash)).toContain('hash2');
      expect(all.map(e => e.hash)).toContain('hash3');
    });

    it('should update existing embedding with same hash', () => {
      const hash = 'same-hash';
      const embedding1 = new Float32Array([1, 0, 0]);
      const embedding2 = new Float32Array([0, 1, 0]);

      service.storeEmbedding(hash, embedding1);
      service.storeEmbedding(hash, embedding2);

      const all = service.getAllStoredEmbeddings();
      expect(all.length).toBe(1);
      expect(service.getStoredEmbedding(hash)).toEqual(embedding2);
    });

    it('should evict oldest embeddings when cache is full', () => {
      // Fill the cache beyond the limit
      for (let i = 0; i < EMBEDDING_SLIDING_WINDOW_SIZE + 3; i++) {
        service.storeEmbedding(`hash-${i}`, new Float32Array([i, 0, 0]));
      }

      const all = service.getAllStoredEmbeddings();

      // Should only have EMBEDDING_SLIDING_WINDOW_SIZE entries
      expect(all.length).toBe(EMBEDDING_SLIDING_WINDOW_SIZE);

      // Oldest entries (hash-0, hash-1, hash-2) should be evicted
      expect(service.getStoredEmbedding('hash-0')).toBeUndefined();
      expect(service.getStoredEmbedding('hash-1')).toBeUndefined();
      expect(service.getStoredEmbedding('hash-2')).toBeUndefined();

      // Newest entries should still be present
      expect(service.getStoredEmbedding(`hash-${EMBEDDING_SLIDING_WINDOW_SIZE + 2}`)).toBeDefined();
    });
  });

  describe('hashContent', () => {
    it('should return consistent hash for same content', () => {
      const content = 'Hello world, this is a test message.';
      const hash1 = LocalEmbeddingService.hashContent(content);
      const hash2 = LocalEmbeddingService.hashContent(content);
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different content', () => {
      const hash1 = LocalEmbeddingService.hashContent('Hello world');
      const hash2 = LocalEmbeddingService.hashContent('Goodbye world');
      expect(hash1).not.toBe(hash2);
    });

    it('should return 16-character hex string', () => {
      const hash = LocalEmbeddingService.hashContent('test content');
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('isServiceReady', () => {
    it('should return false before initialization', () => {
      const service = new LocalEmbeddingService();
      expect(service.isServiceReady()).toBe(false);
    });
  });

  describe('getEmbedding without initialization', () => {
    it('should return undefined when service is not ready', async () => {
      const service = new LocalEmbeddingService();
      const result = await service.getEmbedding('test text');
      expect(result).toBeUndefined();
    });
  });

  describe('getDimensions', () => {
    it('should return 384 dimensions', () => {
      const service = new LocalEmbeddingService();
      expect(service.getDimensions()).toBe(384);
    });
  });
});

describe('SEMANTIC_SIMILARITY_THRESHOLD behavior', () => {
  let service: LocalEmbeddingService;

  beforeEach(() => {
    service = new LocalEmbeddingService();
  });

  it('should correctly identify vectors above threshold as duplicates', () => {
    // Two vectors with ~90% similarity (above 0.88 threshold)
    const vecA = new Float32Array([0.9, 0.436, 0, 0]); // normalized: length ≈ 1
    const vecB = new Float32Array([0.95, 0.312, 0, 0]); // similar but not identical

    // Normalize
    const normA = Math.sqrt(vecA.reduce((sum, v) => sum + v * v, 0));
    const normB = Math.sqrt(vecB.reduce((sum, v) => sum + v * v, 0));
    for (let i = 0; i < vecA.length; i++) {
      vecA[i] /= normA;
      vecB[i] /= normB;
    }

    const similarity = service.cosineSimilarity(vecA, vecB);
    expect(similarity).toBeGreaterThan(SEMANTIC_SIMILARITY_THRESHOLD);
  });

  it('should correctly identify vectors below threshold as unique', () => {
    // Two vectors at ~60 degrees apart (cos(60) = 0.5)
    const vecA = new Float32Array([1, 0, 0, 0]);
    const vecB = new Float32Array([0.5, 0.866, 0, 0]); // ~60 degrees

    const similarity = service.cosineSimilarity(vecA, vecB);
    expect(similarity).toBeLessThan(SEMANTIC_SIMILARITY_THRESHOLD);
  });
});
