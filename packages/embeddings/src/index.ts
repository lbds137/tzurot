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
export type { IEmbeddingService } from './types.js';

// Constants
// EMBEDDING_MAX_INPUT_TOKENS is deliberately NOT re-exported: it is the
// package's own constraint, and consumers learn about overflow from the warn
// LocalEmbeddingService emits rather than by budgeting against it themselves.
// Export it when a caller actually needs to size an input against the window.
export {
  LOCAL_EMBEDDING_DIMENSIONS,
  SEMANTIC_SIMILARITY_THRESHOLD,
  EMBEDDING_SLIDING_WINDOW_SIZE,
} from './constants.js';

// Service
export { LocalEmbeddingService } from './LocalEmbeddingService.js';
