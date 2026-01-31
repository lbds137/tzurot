/**
 * Discord-specific utility functions
 */

import { BOT_FOOTER_PATTERNS } from '../constants/discord.js';

const DISCORD_MAX_MESSAGE_LENGTH = 2000;

/** Default ellipsis for truncated text */
const DEFAULT_ELLIPSIS = '…';

/**
 * Truncates text to a maximum length, adding ellipsis if truncated.
 *
 * @param text - The text to truncate
 * @param maxLength - Maximum length including ellipsis (must be > ellipsis length)
 * @param ellipsis - String to append when truncated (default: '…')
 * @returns The truncated text, or original if within limit
 *
 * @example
 * truncateText('Hello World', 8) // 'Hello W…'
 * truncateText('Hi', 8) // 'Hi' (no truncation needed)
 * truncateText('Long text here', 10, '...') // 'Long te...'
 */
export function truncateText(
  text: string,
  maxLength: number,
  ellipsis: string = DEFAULT_ELLIPSIS
): string {
  // Defensive checks for text parameter
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Defensive checks for ellipsis parameter
  if (typeof ellipsis !== 'string') {
    ellipsis = DEFAULT_ELLIPSIS;
  }

  // Defensive checks for maxLength parameter
  // Handle NaN, negative, and non-finite values
  if (!Number.isFinite(maxLength) || maxLength < 0) {
    return '';
  }

  // Ensure maxLength is an integer (floor it)
  maxLength = Math.floor(maxLength);

  if (maxLength === 0) {
    return '';
  }

  if (maxLength <= ellipsis.length) {
    // Can't fit anything useful, just return ellipsis truncated
    return ellipsis.slice(0, maxLength);
  }

  if (text.length <= maxLength) {
    return text;
  }

  // Truncate and add ellipsis
  return text.slice(0, maxLength - ellipsis.length) + ellipsis;
}

/** State for chunk accumulation during splitting */
interface ChunkState {
  chunks: string[];
  currentChunk: string;
}

/**
 * Force-splits a long word (like a URL) that exceeds maxLength
 * @internal
 */
function splitLongWord(word: string, maxLength: number): string[] {
  const wordChunks: string[] = [];
  const chunkSize = maxLength - 10; // Leave room for "..."
  for (let i = 0; i < word.length; i += chunkSize) {
    wordChunks.push(word.slice(i, i + chunkSize) + '...');
  }
  return wordChunks;
}

/**
 * Processes words into chunks, handling long words by force-splitting
 * @internal
 */
function processWordsIntoChunks(words: string[], maxLength: number, state: ChunkState): void {
  for (const word of words) {
    if (word.length > maxLength) {
      // Flush current chunk before adding split word pieces
      if (state.currentChunk) {
        state.chunks.push(state.currentChunk.trim());
        state.currentChunk = '';
      }
      state.chunks.push(...splitLongWord(word, maxLength));
    } else if ((state.currentChunk + ' ' + word).length > maxLength) {
      state.chunks.push(state.currentChunk.trim());
      state.currentChunk = word;
    } else {
      state.currentChunk = state.currentChunk ? state.currentChunk + ' ' + word : word;
    }
  }
}

/**
 * Processes sentences into chunks, splitting on words if needed
 * @internal
 */
function processSentencesIntoChunks(
  sentences: string[],
  maxLength: number,
  state: ChunkState
): void {
  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      // Flush current chunk before word splitting
      if (state.currentChunk) {
        state.chunks.push(state.currentChunk.trim());
        state.currentChunk = '';
      }
      const words = sentence.split(/\s+/);
      processWordsIntoChunks(words, maxLength, state);
    } else if ((state.currentChunk + ' ' + sentence).length > maxLength) {
      state.chunks.push(state.currentChunk.trim());
      state.currentChunk = sentence;
    } else {
      state.currentChunk = state.currentChunk ? state.currentChunk + ' ' + sentence : sentence;
    }
  }
}

/**
 * Internal helper: splits text at natural boundaries (paragraphs, sentences, words)
 * This is an implementation detail - use splitMessage() for the public API
 * @internal
 */
function splitAtNaturalBoundaries(
  content: string,
  maxLength = DISCORD_MAX_MESSAGE_LENGTH
): string[] {
  if (content.length <= maxLength) {
    return [content];
  }

  const state: ChunkState = { chunks: [], currentChunk: '' };

  // First try to split on double newlines (paragraphs)
  const paragraphs = content.split(/\n\n+/);

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxLength) {
      // Flush current chunk before processing long paragraph
      if (state.currentChunk) {
        state.chunks.push(state.currentChunk.trim());
        state.currentChunk = '';
      }
      // Split long paragraph on sentences
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      processSentencesIntoChunks(sentences, maxLength, state);
    } else if ((state.currentChunk + '\n\n' + paragraph).length > maxLength) {
      // Paragraph fits but would exceed limit with current chunk
      state.chunks.push(state.currentChunk.trim());
      state.currentChunk = paragraph;
    } else {
      // Add paragraph to current chunk
      state.currentChunk = state.currentChunk ? state.currentChunk + '\n\n' + paragraph : paragraph;
    }
  }

  // Don't forget the last chunk
  if (state.currentChunk) {
    state.chunks.push(state.currentChunk.trim());
  }

  return state.chunks.filter(chunk => chunk.length > 0);
}

/**
 * Splits a message for Discord's character limit while preserving code blocks
 *
 * This is the main entry point for message splitting. It:
 * 1. Preserves code blocks (``` ```) when possible
 * 2. Falls back to natural boundary splitting (paragraphs, sentences, words)
 * 3. Force-splits only when absolutely necessary
 *
 * @param content - The content to split
 * @param maxLength - Maximum length per chunk (default: Discord's 2000 char limit)
 */
export function splitMessage(content: string, maxLength = DISCORD_MAX_MESSAGE_LENGTH): string[] {
  // Defensive check: handle undefined/null/non-string input
  // Utility functions should be robust to bad input
  if (!content || typeof content !== 'string') {
    return [];
  }

  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = content.match(codeBlockRegex) ?? [];

  // No code blocks - use simple natural boundary splitting
  if (codeBlocks.length === 0) {
    return splitAtNaturalBoundaries(content, maxLength);
  }

  // Replace code blocks with placeholders to protect them during splitting
  let processedContent = content;
  const placeholders: string[] = [];

  codeBlocks.forEach((block, index) => {
    const placeholder = `__CODE_BLOCK_${index}__`;
    placeholders.push(placeholder);
    processedContent = processedContent.replace(block, placeholder);
  });

  // Split the content with placeholders
  const chunks = splitAtNaturalBoundaries(processedContent, maxLength);

  // Restore code blocks
  const restoredChunks = chunks.map(chunk => {
    let restoredChunk = chunk;
    codeBlocks.forEach((block, index) => {
      restoredChunk = restoredChunk.replace(`__CODE_BLOCK_${index}__`, block);
    });
    return restoredChunk;
  });

  // Check if any restored chunks exceed the limit (can happen if code block is large)
  // If so, re-split those chunks (code block will be split, but that's unavoidable)
  const finalChunks: string[] = [];
  for (const chunk of restoredChunks) {
    if (chunk.length > maxLength) {
      // Re-split this chunk at natural boundaries (code block protection disabled to avoid infinite loop)
      finalChunks.push(...splitAtNaturalBoundaries(chunk, maxLength));
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks;
}

/**
 * Strip bot-added footer lines from content.
 *
 * Only removes our specific footer patterns (model indicator, guest mode,
 * auto-response), not user `-#` formatting.
 *
 * @param content - Message content that may contain bot footers
 * @returns Content with bot footers removed
 */
export function stripBotFooters(content: string): string {
  let result = content;
  for (const pattern of Object.values(BOT_FOOTER_PATTERNS)) {
    // Reset lastIndex since patterns have 'g' flag
    pattern.lastIndex = 0;
    result = result.replace(pattern, '');
  }
  return result;
}

/**
 * Pattern for DM personality prefix added by DiscordResponseSender.
 * Format: **Display Name:** at the start of the message
 *
 * This prefix is added for DM messages so users can see which personality
 * is responding (since webhooks don't work in DMs). However, it should
 * NOT be stored in conversation history - it pollutes long-term memory.
 */
const DM_PREFIX_PATTERN = /^\*\*[^*]+:\*\*\s*/;

/**
 * Strip the DM personality prefix from message content.
 *
 * In DMs, we add "**Display Name:** " prefix for display purposes.
 * This should be stripped when syncing back to conversation history.
 *
 * @param content - Message content that may have DM prefix
 * @returns Content with DM prefix removed
 */
export function stripDmPrefix(content: string): string {
  return content.replace(DM_PREFIX_PATTERN, '');
}
