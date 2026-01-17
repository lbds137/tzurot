/**
 * Embedding Service Types
 *
 * Common types and interfaces for embedding services.
 * Both LocalEmbeddingService (BGE) and any future embedding providers
 * should implement IEmbeddingService.
 */

/**
 * Interface for embedding services
 *
 * Abstracts the embedding provider so consumers don't need to know
 * whether embeddings are generated locally (BGE) or via API (OpenAI).
 */
export interface IEmbeddingService {
  /**
   * Initialize the embedding service
   * @returns true if initialization succeeded, false otherwise
   */
  initialize(): Promise<boolean>;

  /**
   * Generate embedding for text
   * @param text The text to embed
   * @returns Float32Array of embedding dimensions, or undefined if unavailable
   */
  getEmbedding(text: string): Promise<Float32Array | undefined>;

  /**
   * Get the number of dimensions in embeddings produced by this service
   */
  getDimensions(): number;

  /**
   * Check if the service is ready to generate embeddings
   */
  isServiceReady(): boolean;

  /**
   * Shutdown the service gracefully
   */
  shutdown(): Promise<void>;
}

/**
 * Message sent to the embedding worker
 */
export interface WorkerMessage {
  type: 'embed' | 'health';
  text?: string;
  id: number;
}

/**
 * Response from the embedding worker
 */
export interface WorkerResponse {
  id: number;
  status: 'success' | 'error' | 'ready';
  vector?: number[];
  error?: string;
  modelLoaded?: boolean;
}

/**
 * Pending request waiting for worker response
 */
export interface PendingRequest {
  resolve: (value: WorkerResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Cached embedding with metadata
 */
export interface CachedEmbedding {
  hash: string;
  vector: Float32Array;
  timestamp: number;
}
