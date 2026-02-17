/**
 * Embedding Constants
 *
 * Configuration values for the local embedding service.
 */

/**
 * Number of dimensions in BGE-small-en-v1.5 embeddings.
 * This differs from OpenAI embeddings (1536 dimensions).
 */
export const LOCAL_EMBEDDING_DIMENSIONS = 384;

/**
 * Semantic similarity threshold for duplicate detection.
 * Vectors with cosine similarity above this threshold are considered duplicates.
 *
 * Calibrated for BGE-small-en-v1.5:
 * - 0.88 catches paraphrases and minor rewordings
 * - Higher values (0.9+) would miss subtle rephrasing
 * - Lower values (0.85-) would have false positives
 */
export const SEMANTIC_SIMILARITY_THRESHOLD = 0.88;

/**
 * Number of recent embeddings to keep in the sliding window cache.
 * Used for duplicate detection across recent responses.
 */
export const EMBEDDING_SLIDING_WINDOW_SIZE = 10;

/**
 * Timeout for embedding requests to the worker (ms).
 */
export const WORKER_TIMEOUT_MS = 30_000;

/**
 * Timeout for initial model load (ms).
 * Model download + initialization can take longer on first run.
 */
export const WORKER_INIT_TIMEOUT_MS = 60_000;

// Note: The embedding model name is defined in MODEL_DEFAULTS.EMBEDDING
// (common-types/src/constants/ai.ts) as the single source of truth.
