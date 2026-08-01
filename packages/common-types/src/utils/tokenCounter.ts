/**
 * Token Counter Utilities
 *
 * Provides accurate token counting for LLM context window management.
 * Uses tiktoken for text, with estimation for multimodal content.
 */

import { encoding_for_model, type TiktokenModel, type Tiktoken } from 'tiktoken';

/**
 * Token estimation constants based on research and model documentation
 *
 * IMAGE and AUDIO_PER_SECOND were removed with the multimodal estimators that
 * were their only readers; add a constant back when a caller needs it, rather
 * than keeping unreferenced numbers that read as calibrated fact.
 */
export const TOKEN_ESTIMATES = {
  /** Average chars per token (rule of thumb: ~4 chars = 1 token) */
  CHARS_PER_TOKEN: 4,
} as const;

/**
 * Default model for tokenization
 * Using gpt-4 as it's a good general-purpose tokenizer
 */
const DEFAULT_TOKENIZER_MODEL: TiktokenModel = 'gpt-4';

/**
 * Cached encodings per model
 *
 * tiktoken's encoding_for_model() is expensive (loads WASM and vocab files).
 * Caching the encoding per model dramatically improves performance for
 * repeated token counting operations.
 */
const encodingCache = new Map<TiktokenModel, Tiktoken>();

/**
 * Get or create a cached encoding for a model
 */
function getEncoding(model: TiktokenModel): Tiktoken {
  let encoding = encodingCache.get(model);
  if (!encoding) {
    encoding = encoding_for_model(model);
    encodingCache.set(model, encoding);
  }
  return encoding;
}

/**
 * Count tokens in text using tiktoken
 *
 * @param text - The text to count tokens for
 * @param model - The model to use for tokenization (defaults to gpt-4)
 * @returns Number of tokens
 */
export function countTextTokens(
  text: string,
  model: TiktokenModel = DEFAULT_TOKENIZER_MODEL
): number {
  if (!text || text.length === 0) {
    return 0;
  }

  try {
    const encoding = getEncoding(model);
    const tokens = encoding.encode(text);
    // Note: Do NOT call encoding.free() - we're caching the encoding for reuse
    return tokens.length;
  } catch {
    // Fallback to character-based estimation if encoding fails
    // Error expected for unsupported models
    return Math.ceil(text.length / TOKEN_ESTIMATES.CHARS_PER_TOKEN);
  }
}
