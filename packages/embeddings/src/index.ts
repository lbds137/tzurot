/**
 * @tzurot/embeddings
 *
 * Local embedding service using bge-small-en-v1.5 for semantic similarity.
 *
 * Usage:
 * ```typescript
 * import { LocalEmbeddingService } from '@tzurot/embeddings';
 *
 * const service = new LocalEmbeddingService();
 * await service.initialize();
 *
 * const embedding = await service.getEmbedding('Hello world');
 * if (embedding) {
 *   console.log(`Generated ${embedding.length} dimensions`);
 * }
 *
 * await service.shutdown();
 * ```
 */

// Types
export type {
  IEmbeddingService,
  WorkerMessage,
  WorkerResponse,
  PendingRequest,
  CachedEmbedding,
} from './types.js';

// Constants
export {
  LOCAL_EMBEDDING_DIMENSIONS,
  SEMANTIC_SIMILARITY_THRESHOLD,
  EMBEDDING_SLIDING_WINDOW_SIZE,
  WORKER_TIMEOUT_MS,
  WORKER_INIT_TIMEOUT_MS,
  EMBEDDING_MODEL_NAME,
} from './constants.js';

// Service
export { LocalEmbeddingService } from './LocalEmbeddingService.js';
