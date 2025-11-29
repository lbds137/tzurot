/**
 * Token Counter Utilities
 *
 * Provides accurate token counting for LLM context window management.
 * Uses tiktoken for text, with estimation for multimodal content.
 */

import { encoding_for_model, type TiktokenModel, type Tiktoken } from 'tiktoken';

/**
 * Token estimation constants based on research and model documentation
 */
export const TOKEN_ESTIMATES = {
  /** Average tokens per image (conservative estimate for high-res) */
  IMAGE: 1000,
  /** Tokens per second of audio/voice */
  AUDIO_PER_SECOND: 32,
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

/**
 * Estimate tokens for an image
 *
 * @param imageCount - Number of images (defaults to 1)
 * @returns Estimated token count
 */
export function estimateImageTokens(imageCount = 1): number {
  return TOKEN_ESTIMATES.IMAGE * imageCount;
}

/**
 * Estimate tokens for audio/voice content
 *
 * @param durationSeconds - Duration of audio in seconds
 * @returns Estimated token count
 */
export function estimateAudioTokens(durationSeconds: number): number {
  return Math.ceil(TOKEN_ESTIMATES.AUDIO_PER_SECOND * durationSeconds);
}

/**
 * Estimate tokens for a message with mixed content
 *
 * @param options - Message content options
 * @returns Total estimated token count
 */
export function estimateMessageTokens(options: {
  text?: string;
  imageCount?: number;
  audioDurationSeconds?: number;
  model?: TiktokenModel;
}): number {
  const { text = '', imageCount = 0, audioDurationSeconds = 0, model } = options;

  let totalTokens = 0;

  // Count text tokens
  if (text) {
    totalTokens += countTextTokens(text, model);
  }

  // Estimate image tokens
  if (imageCount > 0) {
    totalTokens += estimateImageTokens(imageCount);
  }

  // Estimate audio tokens
  if (audioDurationSeconds > 0) {
    totalTokens += estimateAudioTokens(audioDurationSeconds);
  }

  return totalTokens;
}

/**
 * Calculate how many messages fit within a token budget
 *
 * @param messages - Array of messages with token counts
 * @param tokenBudget - Maximum tokens allowed
 * @returns Number of messages that fit within budget (from the end)
 */
export function calculateMessagesFitInBudget(
  messages: { tokenCount: number }[],
  tokenBudget: number
): number {
  let currentTokens = 0;
  let messageCount = 0;

  // Work backwards from newest message
  for (let i = messages.length - 1; i >= 0; i--) {
    const messageTokens = messages[i].tokenCount;

    // Check if adding this message would exceed budget
    if (currentTokens + messageTokens > tokenBudget) {
      break;
    }

    currentTokens += messageTokens;
    messageCount++;
  }

  return messageCount;
}
