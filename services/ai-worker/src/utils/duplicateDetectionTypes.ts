/**
 * Duplicate Detection Types
 *
 * Shared interfaces for the duplicate detection system.
 * Extracted to prevent circular dependencies between detection and history modules.
 */

/**
 * Interface for embedding services used in semantic duplicate detection.
 * Implements Dependency Inversion - detection logic doesn't depend on concrete service.
 */
export interface EmbeddingServiceInterface {
  /** Check if the service is ready to generate embeddings */
  isServiceReady(): boolean;
  /** Generate embedding for text (undefined if service unavailable) */
  getEmbedding(text: string): Promise<Float32Array | undefined>;
  /** Calculate cosine similarity between two normalized vectors */
  cosineSimilarity(a: Float32Array, b: Float32Array): number;
  /** Store embedding in sliding window cache */
  storeEmbedding(hash: string, embedding: Float32Array): void;
  /** Get all stored embeddings for comparison */
  getAllStoredEmbeddings(): { hash: string; vector: Float32Array }[];
}
