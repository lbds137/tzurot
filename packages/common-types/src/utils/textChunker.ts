/**
 * Token-Based Text Chunker
 *
 * Splits text into chunks that fit within embedding model token limits.
 * Uses natural boundaries (paragraphs, sentences, words) to preserve semantic coherence.
 * Tracks speaker context ({user}/{assistant}) and adds continuation prefixes for mid-turn splits.
 */

import { type TiktokenModel } from 'tiktoken';
import { countTextTokens } from './tokenCounter.js';
import { AI_DEFAULTS } from '../constants/ai.js';

/**
 * Result of splitting text by tokens
 */
export interface ChunkResult {
  /** Array of text chunks, each within the token limit */
  chunks: string[];
  /** Token count of the original (unsplit) text */
  originalTokenCount: number;
  /** Whether the text was actually split (false if under limit) */
  wasChunked: boolean;
}

/**
 * Options for text chunking
 */
export interface ChunkOptions {
  /** Tiktoken model for token counting (default: 'gpt-4') */
  model?: TiktokenModel;
}

/** State for chunk accumulation during splitting */
interface ChunkState {
  chunks: string[];
  currentChunk: string;
  currentTokens: number;
  lastSpeaker: SpeakerType | null;
}

/** Speaker markers in conversation text */
type SpeakerType = 'user' | 'assistant';

/** Regex to detect speaker markers at line start */
const SPEAKER_REGEX = /^\{(user|assistant)\}:/i;

/**
 * Detects the speaker from a line of text
 * @internal
 */
function detectSpeaker(line: string): SpeakerType | null {
  const match = SPEAKER_REGEX.exec(line);
  if (match) {
    return match[1].toLowerCase() as SpeakerType;
  }
  return null;
}

/**
 * Finds the last speaker marker in a text block
 * @internal
 */
function findLastSpeaker(text: string): SpeakerType | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const speaker = detectSpeaker(lines[i]);
    if (speaker) {
      return speaker;
    }
  }
  return null;
}

/**
 * Creates a continuation prefix for a chunk that starts mid-speaker-turn
 * @internal
 */
function createContinuationPrefix(speaker: SpeakerType | null): string {
  if (!speaker) {
    return '';
  }
  return `{${speaker}} (continued): `;
}

/**
 * Force-splits a long word (like a URL) that exceeds the token limit
 * Uses character-based splitting as a last resort
 * @internal
 */
function splitLongWord(word: string, maxTokens: number, model: TiktokenModel, depth = 0): string[] {
  // Safety: prevent infinite recursion (max 10 levels should handle any real case)
  const MAX_RECURSION_DEPTH = 10;
  if (depth >= MAX_RECURSION_DEPTH) {
    // At max depth, just return the chunk as-is (it may slightly exceed limit)
    return [word];
  }

  // Early exit: if word is short enough that it can't exceed the limit
  // (conservative estimate: 1 char ≈ 0.5 tokens for worst case)
  if (word.length <= maxTokens * 2) {
    const actualTokens = countTextTokens(word, model);
    if (actualTokens <= maxTokens) {
      return [word];
    }
  }

  const wordChunks: string[] = [];
  // Estimate safe character count per chunk (4 chars ≈ 1 token, with safety margin)
  const charsPerChunk = Math.max(1, (maxTokens - 50) * 3);

  for (let i = 0; i < word.length; i += charsPerChunk) {
    const chunk = word.slice(i, i + charsPerChunk);
    // Verify the chunk is within token limit
    const tokens = countTextTokens(chunk, model);
    if (tokens <= maxTokens) {
      wordChunks.push(chunk);
    } else {
      // Recursively split if still too large
      wordChunks.push(...splitLongWord(chunk, maxTokens, model, depth + 1));
    }
  }
  return wordChunks;
}

/**
 * Flushes the current chunk to the chunks array if non-empty
 * @internal
 */
function flushChunk(state: ChunkState): void {
  if (state.currentChunk.trim()) {
    state.chunks.push(state.currentChunk.trim());
    state.currentChunk = '';
    state.currentTokens = 0;
  }
}

/** Token estimates for different separators */
const SEPARATOR_TOKENS = {
  SPACE: 1, // Single space between words/sentences
  PARAGRAPH: 2, // Double newline between paragraphs
} as const;

/**
 * Adds content to the current chunk with a separator
 * @internal
 */
function addToChunk(
  state: ChunkState,
  content: string,
  separator: string,
  contentTokens: number,
  separatorTokens: number
): void {
  // Check if we're adding a separator BEFORE modifying the chunk
  const addingSeparator = state.currentChunk.length > 0;
  if (addingSeparator) {
    state.currentChunk = state.currentChunk + separator + content;
  } else {
    state.currentChunk = content;
  }
  // Add separator token estimate only when we actually added a separator
  state.currentTokens += contentTokens + (addingSeparator ? separatorTokens : 0);
}

/**
 * Processes words into chunks, handling long words by force-splitting
 * @internal
 */
function processWordsIntoChunks(
  words: string[],
  maxTokens: number,
  model: TiktokenModel,
  state: ChunkState
): void {
  for (const word of words) {
    const wordTokens = countTextTokens(word, model);

    if (wordTokens > maxTokens) {
      // Flush current chunk before adding split word pieces
      flushChunk(state);
      const pieces = splitLongWord(word, maxTokens, model);
      for (const piece of pieces) {
        state.chunks.push(piece);
      }
    } else if (state.currentTokens + wordTokens + 1 > maxTokens) {
      // Word would exceed limit - flush and start new chunk
      flushChunk(state);
      state.currentChunk = word;
      state.currentTokens = wordTokens;
    } else {
      // Add word to current chunk
      addToChunk(state, word, ' ', wordTokens, SEPARATOR_TOKENS.SPACE);
    }
  }
}

/**
 * Processes sentences into chunks, splitting on words if needed
 * @internal
 */
function processSentencesIntoChunks(
  sentences: string[],
  maxTokens: number,
  model: TiktokenModel,
  state: ChunkState
): void {
  for (const sentence of sentences) {
    const sentenceTokens = countTextTokens(sentence, model);

    if (sentenceTokens > maxTokens) {
      // Sentence too long - flush and split on words
      flushChunk(state);
      const words = sentence.split(/\s+/);
      processWordsIntoChunks(words, maxTokens, model, state);
    } else if (state.currentTokens + sentenceTokens + 1 > maxTokens) {
      // Sentence would exceed limit - flush and start new chunk
      flushChunk(state);
      state.currentChunk = sentence;
      state.currentTokens = sentenceTokens;
    } else {
      // Add sentence to current chunk
      addToChunk(state, sentence, ' ', sentenceTokens, SEPARATOR_TOKENS.SPACE);
    }
  }
}

/**
 * Splits text at natural boundaries (paragraphs, sentences, words) based on tokens
 * @internal
 */
function splitAtNaturalBoundariesByTokens(
  content: string,
  maxTokens: number,
  model: TiktokenModel,
  initialSpeaker: SpeakerType | null
): string[] {
  const totalTokens = countTextTokens(content, model);
  if (totalTokens <= maxTokens) {
    return [content];
  }

  const state: ChunkState = {
    chunks: [],
    currentChunk: '',
    currentTokens: 0,
    lastSpeaker: initialSpeaker,
  };

  // Split on double newlines (paragraphs)
  const paragraphs = content.split(/\n\n+/);

  for (const paragraph of paragraphs) {
    // Track speaker changes
    const paragraphSpeaker = findLastSpeaker(paragraph);
    if (paragraphSpeaker) {
      state.lastSpeaker = paragraphSpeaker;
    }

    const paragraphTokens = countTextTokens(paragraph, model);

    if (paragraphTokens > maxTokens) {
      // Paragraph too long - flush and split on sentences
      flushChunk(state);
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      processSentencesIntoChunks(sentences, maxTokens, model, state);
    } else if (state.currentTokens + paragraphTokens + 2 > maxTokens) {
      // Paragraph would exceed limit (2 tokens estimate for \n\n)
      flushChunk(state);
      state.currentChunk = paragraph;
      state.currentTokens = paragraphTokens;
    } else {
      // Add paragraph to current chunk
      addToChunk(state, paragraph, '\n\n', paragraphTokens, SEPARATOR_TOKENS.PARAGRAPH);
    }
  }

  // Don't forget the last chunk
  flushChunk(state);

  return state.chunks.filter(chunk => chunk.length > 0);
}

/**
 * Adds continuation prefixes to chunks that start mid-speaker-turn
 * @internal
 */
function addContinuationPrefixes(chunks: string[], initialSpeaker: SpeakerType | null): string[] {
  if (chunks.length <= 1) {
    return chunks;
  }

  const result: string[] = [chunks[0]]; // First chunk keeps original content
  let lastSpeaker = findLastSpeaker(chunks[0]) ?? initialSpeaker;

  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkStartSpeaker = detectSpeaker(chunk.split('\n')[0]);

    if (chunkStartSpeaker) {
      // Chunk starts with a speaker marker - no prefix needed
      result.push(chunk);
      lastSpeaker = findLastSpeaker(chunk) ?? lastSpeaker;
    } else if (lastSpeaker) {
      // Chunk starts mid-turn - add continuation prefix
      const prefix = createContinuationPrefix(lastSpeaker);
      result.push(prefix + chunk);
      // Update lastSpeaker from this chunk if it contains speaker markers
      const newSpeaker = findLastSpeaker(chunk);
      if (newSpeaker) {
        lastSpeaker = newSpeaker;
      }
    } else {
      // No speaker context - just add the chunk as-is
      result.push(chunk);
    }
  }

  return result;
}

/**
 * Split text into chunks that fit within the embedding token limit
 *
 * Uses natural boundaries (paragraphs → sentences → words) to preserve
 * semantic coherence. Tracks speaker context and adds continuation
 * prefixes for chunks that start mid-speaker-turn.
 *
 * @param text - The text to split
 * @param maxTokens - Maximum tokens per chunk (default: AI_DEFAULTS.EMBEDDING_CHUNK_LIMIT)
 * @param options - Optional configuration
 * @returns ChunkResult with chunks and metadata
 *
 * @example
 * const result = splitTextByTokens(longConversation);
 * if (result.wasChunked) {
 *   console.log(`Split into ${result.chunks.length} chunks`);
 * }
 */
export function splitTextByTokens(
  text: string,
  maxTokens: number = AI_DEFAULTS.EMBEDDING_CHUNK_LIMIT,
  options: ChunkOptions = {}
): ChunkResult {
  // Handle empty/null input
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return {
      chunks: [],
      originalTokenCount: 0,
      wasChunked: false,
    };
  }

  const model = options.model ?? 'gpt-4';
  const originalTokenCount = countTextTokens(text, model);

  // If under limit, return as single chunk
  if (originalTokenCount <= maxTokens) {
    return {
      chunks: [text],
      originalTokenCount,
      wasChunked: false,
    };
  }

  // Find initial speaker context (search from the beginning)
  const initialSpeaker = detectSpeaker(text.split('\n')[0]);

  // Split at natural boundaries
  let chunks = splitAtNaturalBoundariesByTokens(text, maxTokens, model, initialSpeaker);

  // Add continuation prefixes for mid-turn splits
  chunks = addContinuationPrefixes(chunks, initialSpeaker);

  return {
    chunks,
    originalTokenCount,
    wasChunked: true,
  };
}

/**
 * Reassemble chunked memories back into original text
 *
 * Removes continuation prefixes added during chunking and joins
 * chunks with double newlines (the primary paragraph separator).
 *
 * @param chunks - Array of chunk texts, should be sorted by chunkIndex
 * @returns Reassembled text with continuation markers removed
 *
 * @example
 * const memories = sortChunksByIndex(fetchedMemories);
 * const fullText = reassembleChunks(memories.map(m => m.pageContent));
 */
export function reassembleChunks(chunks: string[]): string {
  if (chunks.length === 0) {
    return '';
  }
  if (chunks.length === 1) {
    return chunks[0];
  }

  // Remove continuation prefixes from chunks 1+
  const cleaned = chunks.map((chunk, i) => {
    if (i === 0) {
      return chunk;
    }
    // Remove "{user} (continued): " or "{assistant} (continued): " prefix
    return chunk
      .replace(/^\{user\} \(continued\): /i, '')
      .replace(/^\{assistant\} \(continued\): /i, '');
  });

  // Join chunks with double newlines (they were split at natural boundaries)
  return cleaned.join('\n\n');
}

/**
 * Sort memory documents by chunkIndex for reassembly
 *
 * @param memories - Array of memory documents with metadata
 * @returns Sorted array (new array, original not modified)
 *
 * @example
 * const sorted = sortChunksByIndex(memories);
 * const text = reassembleChunks(sorted.map(m => m.pageContent));
 */
export function sortChunksByIndex<T extends { metadata?: Record<string, unknown> }>(
  memories: T[]
): T[] {
  return [...memories].sort((a, b) => {
    const indexA = (a.metadata?.chunkIndex as number | undefined) ?? 0;
    const indexB = (b.metadata?.chunkIndex as number | undefined) ?? 0;
    return indexA - indexB;
  });
}
