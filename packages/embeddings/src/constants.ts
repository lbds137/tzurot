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
 * Maximum input length the model can actually read, in ITS tokens.
 *
 * From the vendored model's own config: `tokenizer_config.json` declares
 * `model_max_length: 512` and `config.json` declares
 * `max_position_embeddings: 512`.
 *
 * **Anything past this is discarded, silently.** transformers.js hardcodes
 * `truncation: true` in `FeatureExtractionPipeline._call`, so an over-long
 * input does not error, does not warn, and does not return a partial result —
 * it returns a perfectly valid-looking vector computed from the first 512
 * tokens only. A caller that concatenates its way past the limit therefore
 * embeds a prefix while believing it embedded the whole thing.
 *
 * Counted with the model's own WordPiece tokenizer, which is not tiktoken:
 * do not budget against a GPT tokenizer's count and expect it to line up.
 * `LocalEmbeddingService` reports the real count per call so callers can see
 * overflow rather than infer it.
 */
export const EMBEDDING_MAX_INPUT_TOKENS = 512;

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
