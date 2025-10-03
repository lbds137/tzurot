/**
 * Message Splitting Utilities
 * 
 * Provides common message splitting functionality used across
 * webhooks, threads, and DMs to reduce code duplication.
 */

const logger = require('../logger');

// Discord limitations
const MESSAGE_CHAR_LIMIT = 2000;

/**
 * Split a long message into chunks at natural break points
 * @param {string} content - Message content to split
 * @returns {Array<string>} Array of message chunks
 */
function splitMessage(content) {
  // If message is within limits, return as is
  if (!content || content.length <= MESSAGE_CHAR_LIMIT) {
    return [content || ''];
  }

  const chunks = [];
  let currentChunk = '';

  // First split by paragraphs (double newlines)
  const paragraphs = content.split(/\n\s*\n/);

  // Process each paragraph
  for (const paragraph of paragraphs) {
    currentChunk = processParagraph(paragraph, chunks, currentChunk);
  }

  // Add any remaining content
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Process a paragraph and add to chunks
 * @param {string} paragraph - Paragraph to process
 * @param {Array} chunks - Array of chunks
 * @param {string} currentChunk - Current chunk being built
 * @returns {string} Updated current chunk
 */
function processParagraph(paragraph, chunks, currentChunk) {
  // If adding this paragraph exceeds the limit
  if (currentChunk.length + paragraph.length + 2 > MESSAGE_CHAR_LIMIT) {
    // If paragraph itself is too long, need to split further
    if (paragraph.length > MESSAGE_CHAR_LIMIT) {
      // Add any existing content first
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      // Split by lines
      const lines = paragraph.split('\n');
      for (const line of lines) {
        currentChunk = processLine(line, chunks, currentChunk);
      }
      return currentChunk;
    }

    // Paragraph fits in a new chunk
    chunks.push(currentChunk);
    return paragraph;
  }

  // Add paragraph to current chunk with newlines if needed
  return currentChunk.length > 0 ? `${currentChunk}\n\n${paragraph}` : paragraph;
}

/**
 * Process a line and add to chunks
 * @param {string} line - Line to process
 * @param {Array} chunks - Array of chunks
 * @param {string} currentChunk - Current chunk being built
 * @returns {string} Updated current chunk
 */
function processLine(line, chunks, currentChunk) {
  // If adding this line exceeds the limit
  if (currentChunk.length + line.length + 1 > MESSAGE_CHAR_LIMIT) {
    // If the line itself is too long, need to split by sentences
    if (line.length > MESSAGE_CHAR_LIMIT) {
      // Add any existing content first
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      // Split by sentences
      const sentences = line.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        currentChunk = processSentence(sentence, chunks, currentChunk);
      }
      return currentChunk;
    }

    // Line fits in a new chunk
    chunks.push(currentChunk);
    return line;
  }

  // Add line to current chunk with newline if needed
  return currentChunk.length > 0 ? `${currentChunk}\n${line}` : line;
}

/**
 * Process a sentence and add to chunks
 * @param {string} sentence - Sentence to process
 * @param {Array} chunks - Array of chunks
 * @param {string} currentChunk - Current chunk being built
 * @returns {string} Updated current chunk
 */
function processSentence(sentence, chunks, currentChunk) {
  // If adding this sentence exceeds the limit
  if (currentChunk.length + sentence.length + 1 > MESSAGE_CHAR_LIMIT) {
    // If the sentence itself is too long, split by character limit
    if (sentence.length > MESSAGE_CHAR_LIMIT) {
      // Add any existing content first
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      // Split by character limit
      const parts = splitByCharacterLimit(sentence);
      for (let i = 0; i < parts.length - 1; i++) {
        chunks.push(parts[i]);
      }
      return parts[parts.length - 1];
    }

    // Sentence fits in a new chunk
    chunks.push(currentChunk);
    return sentence;
  }

  // Add sentence to current chunk with space if needed
  return currentChunk.length > 0 ? `${currentChunk} ${sentence}` : sentence;
}

/**
 * Split text by character limit with smart break points
 * @param {string} text - Text to split
 * @returns {Array<string>} Array of chunks
 */
function splitByCharacterLimit(text) {
  if (!text || text.length <= MESSAGE_CHAR_LIMIT) {
    return [text || ''];
  }

  const chunks = [];
  let remainingText = text;

  while (remainingText.length > MESSAGE_CHAR_LIMIT) {
    // Start from the character limit and work backwards
    let splitIndex = MESSAGE_CHAR_LIMIT;

    // Look for the last space before the limit (but not too far back)
    for (let i = MESSAGE_CHAR_LIMIT - 1; i > MESSAGE_CHAR_LIMIT - 200 && i > 0; i--) {
      if (remainingText[i] === ' ') {
        splitIndex = i;
        break;
      }
    }

    // Add the chunk to our results
    chunks.push(remainingText.substring(0, splitIndex));

    // Remove the processed chunk
    remainingText = remainingText.substring(splitIndex).trim();
  }

  // Add any remaining text
  if (remainingText.length > 0) {
    chunks.push(remainingText);
  }

  return chunks;
}

/**
 * Prepare content for splitting by appending model indicator if provided
 * and then split into chunks respecting Discord's character limit.
 * 
 * @param {string} content - The message content to split
 * @param {Object} options - Options object that may contain modelIndicator
 * @param {string} context - Context for logging (e.g., 'Webhook', 'Thread', 'DM')
 * @returns {Array<string>} Array of message chunks
 */
function prepareAndSplitMessage(content, options, context = 'Message') {
  // Append model indicator to content BEFORE splitting if provided
  let contentToSplit = content;
  if (options?.modelIndicator) {
    contentToSplit += options.modelIndicator;
  }

  // Split message if needed (Discord's character limit)
  const contentChunks = splitMessage(contentToSplit);
  logger.info(`[${context}] Split message into ${contentChunks.length} chunks`);
  
  return contentChunks;
}

/**
 * Common chunk processing helpers
 */
const chunkHelpers = {
  /**
   * Check if this is the first chunk
   * @param {number} index - Current chunk index
   * @returns {boolean}
   */
  isFirstChunk: (index) => index === 0,
  
  /**
   * Check if this is the last chunk
   * @param {number} index - Current chunk index
   * @param {number} total - Total number of chunks
   * @returns {boolean}
   */
  isLastChunk: (index, total) => index === total - 1,
  
  /**
   * Get standard chunk delay in milliseconds
   * @returns {number}
   */
  getChunkDelay: () => 750,
};

module.exports = {
  prepareAndSplitMessage,
  chunkHelpers,
  splitMessage,
  splitByCharacterLimit,
  processParagraph,
  processLine,
  processSentence,
  MESSAGE_CHAR_LIMIT,
};