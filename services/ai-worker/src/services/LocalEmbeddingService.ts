/**
 * Local Embedding Service
 *
 * Manages a Worker Thread that runs the bge-small-en-v1.5 embedding model locally.
 * Provides semantic similarity checking for duplicate detection and will eventually
 * replace OpenAI embeddings for LTM storage.
 *
 * Architecture:
 * - Main thread: Handles requests, maintains embedding cache
 * - Worker thread: Runs CPU-intensive embedding generation
 * - Communication: Message passing with request IDs for async correlation
 *
 * Why Worker Threads?
 * Embedding generation involves matrix operations that can take 20-50ms.
 * Running this on the main thread would block the event loop, causing:
 * - Discord heartbeat failures (disconnects)
 * - Missed message events
 * - Unresponsive health checks
 */

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('LocalEmbeddingService');

// ============================================================================
// CONSTANTS
// ============================================================================

export const LOCAL_EMBEDDING_DIMENSIONS = 384;
export const SEMANTIC_SIMILARITY_THRESHOLD = 0.88;
export const EMBEDDING_SLIDING_WINDOW_SIZE = 10;

const WORKER_TIMEOUT_MS = 30_000; // 30s timeout for embedding requests
const WORKER_INIT_TIMEOUT_MS = 60_000; // 60s for initial model load

// ============================================================================
// TYPES
// ============================================================================

/** Message sent to the worker */
interface WorkerMessage {
  type: 'embed' | 'health';
  text?: string;
  id: number;
}

/** Response from the worker */
interface WorkerResponse {
  id: number;
  status: 'success' | 'error' | 'ready';
  vector?: number[];
  error?: string;
  modelLoaded?: boolean;
}

/** Pending request waiting for worker response */
interface PendingRequest {
  resolve: (value: WorkerResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/** Cached embedding with metadata */
interface CachedEmbedding {
  hash: string;
  vector: Float32Array;
  timestamp: number;
}

// ============================================================================
// SERVICE
// ============================================================================

/**
 * Service for generating embeddings locally using a Worker Thread
 */
export class LocalEmbeddingService {
  private worker: Worker | null = null;
  private isReady = false;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private recentEmbeddings: CachedEmbedding[] = [];

  /**
   * Initialize the service by spawning the worker and loading the model
   * @returns true if initialization succeeded, false otherwise
   */
  async initialize(): Promise<boolean> {
    if (this.isReady) {
      logger.debug('[LocalEmbeddingService] Already initialized');
      return true;
    }

    try {
      logger.info('[LocalEmbeddingService] Spawning embedding worker...');

      // Get the worker script path
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const workerPath = join(__dirname, '..', 'workers', 'embeddingWorker.js');

      // Spawn the worker
      this.worker = new Worker(workerPath);

      // Set up message handler
      this.worker.on('message', (response: WorkerResponse) => {
        this.handleWorkerMessage(response);
      });

      this.worker.on('error', error => {
        logger.error({ err: error }, '[LocalEmbeddingService] Worker error');
        this.handleWorkerCrash();
      });

      this.worker.on('exit', code => {
        if (code !== 0) {
          logger.error({ code }, '[LocalEmbeddingService] Worker exited with error code');
          this.handleWorkerCrash();
        }
      });

      // Wait for worker to signal ready
      await this.waitForReady();

      // Pre-load the model by doing a health check
      // This triggers model download/load in the worker
      logger.info('[LocalEmbeddingService] Pre-loading embedding model...');
      const healthResult = await this.sendMessage({ type: 'health' }, WORKER_INIT_TIMEOUT_MS);

      if (healthResult.status === 'success' && healthResult.modelLoaded === true) {
        this.isReady = true;
        logger.info('[LocalEmbeddingService] Service initialized successfully');
        return true;
      } else {
        logger.error({ error: healthResult.error }, '[LocalEmbeddingService] Model failed to load');
        return false;
      }
    } catch (error) {
      logger.error({ err: error }, '[LocalEmbeddingService] Failed to initialize');
      return false;
    }
  }

  /**
   * Wait for the worker to send the 'ready' signal
   */
  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker failed to become ready within timeout'));
      }, WORKER_INIT_TIMEOUT_MS);

      const readyHandler = (response: WorkerResponse): void => {
        if (response.status === 'ready') {
          clearTimeout(timeout);
          this.worker?.off('message', readyHandler);
          resolve();
        }
      };

      this.worker?.on('message', readyHandler);
    });
  }

  /**
   * Handle worker crash - reject all pending requests and mark as not ready
   */
  private handleWorkerCrash(): void {
    this.isReady = false;

    // Reject all pending requests
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Worker crashed'));
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Handle messages from the worker
   */
  private handleWorkerMessage(response: WorkerResponse): void {
    // Skip 'ready' messages - handled separately
    if (response.status === 'ready') {
      return;
    }

    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(response);
      this.pendingRequests.delete(response.id);
    }
  }

  /**
   * Send a message to the worker and wait for response
   */
  private sendMessage(
    message: Omit<WorkerMessage, 'id'>,
    timeoutMs = WORKER_TIMEOUT_MS
  ): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      const id = this.nextRequestId++;
      const fullMessage: WorkerMessage = { ...message, id };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Worker request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.worker.postMessage(fullMessage);
    });
  }

  /**
   * Generate embedding for text
   * @returns Float32Array of 384 dimensions, or undefined if service unavailable
   */
  async getEmbedding(text: string): Promise<Float32Array | undefined> {
    if (!this.isReady || this.worker === null) {
      logger.warn({}, '[LocalEmbeddingService] Service not ready, skipping embedding');
      return undefined;
    }

    try {
      const response = await this.sendMessage({ type: 'embed', text });

      if (response.status === 'success' && response.vector) {
        return new Float32Array(response.vector);
      }

      logger.error({ error: response.error }, '[LocalEmbeddingService] Embedding failed');
      return undefined;
    } catch (error) {
      logger.error({ err: error }, '[LocalEmbeddingService] Failed to get embedding');
      return undefined;
    }
  }

  /**
   * Calculate cosine similarity between two normalized vectors
   * Returns value between -1 (opposite) and 1 (identical)
   *
   * Note: Since our embeddings are L2-normalized, cosine similarity
   * is equivalent to the dot product.
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
    }

    return dotProduct;
  }

  /**
   * Store an embedding in the sliding window cache
   * Used to compare new responses against recent ones
   */
  storeEmbedding(contentHash: string, embedding: Float32Array): void {
    // Remove existing entry with same hash (update case)
    this.recentEmbeddings = this.recentEmbeddings.filter(e => e.hash !== contentHash);

    // Add new entry
    this.recentEmbeddings.push({
      hash: contentHash,
      vector: embedding,
      timestamp: Date.now(),
    });

    // Evict oldest if over limit
    while (this.recentEmbeddings.length > EMBEDDING_SLIDING_WINDOW_SIZE) {
      this.recentEmbeddings.shift();
    }

    logger.debug(
      { cacheSize: this.recentEmbeddings.length },
      '[LocalEmbeddingService] Stored embedding in cache'
    );
  }

  /**
   * Get a stored embedding by content hash
   */
  getStoredEmbedding(contentHash: string): Float32Array | undefined {
    const cached = this.recentEmbeddings.find(e => e.hash === contentHash);
    return cached?.vector;
  }

  /**
   * Get all stored embeddings for comparison
   */
  getAllStoredEmbeddings(): { hash: string; vector: Float32Array }[] {
    return this.recentEmbeddings.map(e => ({ hash: e.hash, vector: e.vector }));
  }

  /**
   * Check if the service is ready to generate embeddings
   */
  isServiceReady(): boolean {
    return this.isReady;
  }

  /**
   * Hash text content for cache key
   */
  static hashContent(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
  }

  /**
   * Shutdown the service gracefully
   */
  async shutdown(): Promise<void> {
    if (this.worker) {
      logger.info('[LocalEmbeddingService] Shutting down worker...');

      // Clear pending requests
      for (const [id, request] of this.pendingRequests) {
        clearTimeout(request.timeout);
        request.reject(new Error('Service shutting down'));
        this.pendingRequests.delete(id);
      }

      await this.worker.terminate();
      this.worker = null;
      this.isReady = false;

      logger.info('[LocalEmbeddingService] Worker terminated');
    }
  }
}
