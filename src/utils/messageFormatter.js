/**
 * Message formatting utilities for Discord messages
 * Handles splitting long messages and preparing message data
 */

const { EmbedBuilder } = require('discord.js');
const logger = require('../logger');

// Discord limitations
const MESSAGE_CHAR_LIMIT = 2000;

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
 * Split a sentence into smaller chunks if needed
 * @param {string} sentence - Sentence to split
 * @param {Array<string>} chunks - Array to add chunks to
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
      }

      // Split the sentence by character limit
      const sentenceChunks = splitByCharacterLimit(sentence);
      chunks.push(...sentenceChunks);

      // Start with a fresh chunk
      return '';
    } else {
      // Sentence is within limit but combined is too long
      chunks.push(currentChunk);
      return sentence;
    }
  } else {
    // Add sentence to current chunk with space if needed
    return currentChunk.length > 0 ? `${currentChunk} ${sentence}` : sentence;
  }
}

/**
 * Process a single line of text
 * @param {string} line - Line to process
 * @param {Array<string>} chunks - Array to add chunks to
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
      }

      // Split by sentences and process each
      const sentences = line.split(/(?<=[.!?])\s+/);
      const sentenceChunk = '';
      const processedChunk = sentences.reduce((chunk, sentence) => {
        return processSentence(sentence, chunks, chunk);
      }, sentenceChunk);

      // Add any remaining content
      if (processedChunk.length > 0) {
        chunks.push(processedChunk);
      }

      return '';
    } else {
      // Line is within limit but combined is too long
      chunks.push(currentChunk);
      return line;
    }
  } else {
    // Add line to current chunk with newline if needed
    return currentChunk.length > 0 ? `${currentChunk}\n${line}` : line;
  }
}

/**
 * Process a paragraph
 * @param {string} paragraph - Paragraph to process
 * @param {Array<string>} chunks - Array to add chunks to
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
      }

      // Split paragraph by lines and process each
      const lines = paragraph.split(/\n/);
      const lineChunk = '';
      const processedChunk = lines.reduce((chunk, line) => {
        return processLine(line, chunks, chunk);
      }, lineChunk);

      // Add any remaining content
      if (processedChunk.length > 0) {
        chunks.push(processedChunk);
      }

      return '';
    } else {
      // Paragraph is within limit but combined is too long
      chunks.push(currentChunk);
      return paragraph;
    }
  } else {
    // Add paragraph to current chunk with newlines if needed
    return currentChunk.length > 0 ? `${currentChunk}\n\n${paragraph}` : paragraph;
  }
}

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
 * Mark content that contains error patterns
 * @param {string} content - Content to check
 * @returns {string} Content with error prefix if needed
 */
function markErrorContent(content) {
  if (!content) return '';

  // Use the centralized error messages and markers from constants
  const { ERROR_MESSAGES, MARKERS } = require('../constants');

  // Special case for combined terms
  if (content.includes('connection') && content.includes('unstable')) {
    logger.info(`[MessageFormatter] Detected error message (unstable connection), adding special prefix`);
    return MARKERS.ERROR_PREFIX + ' ' + content;
  }

  // Check for standard error patterns
  for (const pattern of ERROR_MESSAGES) {
    // Skip the marker patterns themselves to avoid duplication
    if (pattern === MARKERS.ERROR_PREFIX || pattern === MARKERS.HARD_BLOCKED_RESPONSE) {
      continue;
    }

    if (content.includes(pattern)) {
      logger.info(
        `[MessageFormatter] Detected error message with pattern "${pattern}", adding special prefix`
      );
      return MARKERS.ERROR_PREFIX + ' ' + content;
    }
  }

  return content;
}

/**
 * Prepare message data for sending via webhook
 * @param {string} content - Message content
 * @param {string} username - Standardized username
 * @param {string} avatarUrl - Avatar URL
 * @param {boolean} isThread - Whether the channel is a thread
 * @param {string} threadId - Thread ID if applicable
 * @param {Object} options - Additional options
 * @returns {Object} Prepared message data
 */
function prepareMessageData(content, username, avatarUrl, isThread, threadId, options = {}) {
  // Enhanced logging for thread troubleshooting
  if (isThread) {
    logger.info(`[MessageFormatter] Preparing message data for thread with ID: ${threadId}`);
    if (!threadId) {
      logger.warn('[MessageFormatter] Thread flagged as true but no threadId provided!');
    }
  }

  // Thread-specific handling
  const threadData = isThread
    ? {
        threadId,
        // Store information about the original channel for recovery attempts
        _isThread: true,
        _originalChannel: options._originalChannel, // Will be set by calling functions
      }
    : {};

  const messageData = {
    content: content,
    username: username,
    avatarURL: avatarUrl || null,
    allowedMentions: { parse: ['users', 'roles'] },
    ...threadData,
  };

  // Double-check threadId was properly set if isThread is true
  if (isThread && !messageData.threadId) {
    logger.error(
      '[MessageFormatter] Error: threadId not set properly in messageData despite isThread=true'
    );
  } else if (isThread) {
    logger.info(
      `[MessageFormatter] Successfully set threadId ${messageData.threadId} in messageData`
    );
  }

  // Add optional embed if provided
  if (options.embed) {
    messageData.embeds = [new EmbedBuilder(options.embed)];
  }

  // Add optional files if provided
  if (options.files) {
    messageData.files = options.files;
  }

  // Add audio attachments if provided
  if (options.attachments && options.attachments.length > 0) {
    // Initialize files array if it doesn't exist
    messageData.files = messageData.files || [];
    // Add attachments to files
    messageData.files.push(...options.attachments);
    logger.debug(`[MessageFormatter] Added ${options.attachments.length} audio attachments to message`);
  }

  return messageData;
}

module.exports = {
  MESSAGE_CHAR_LIMIT,
  splitByCharacterLimit,
  processSentence,
  processLine,
  processParagraph,
  splitMessage,
  markErrorContent,
  prepareMessageData,
};