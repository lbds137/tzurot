/**
 * Webhook Error Utilities
 *
 * Handles error detection and marking for webhook messages
 */

const logger = require('../logger');

// Regular expressions for error detection
const ERROR_PATTERNS = [
  /error/i,
  /failed/i,
  /unable/i,
  /cannot/i,
  /invalid/i,
  /exception/i,
  /denied/i,
  /forbidden/i,
  /unauthorized/i,
];

/**
 * Check if content appears to be an error message
 * @param {string} content - Message content to check
 * @returns {boolean} True if content appears to be an error
 */
function isErrorContent(content) {
  if (!content || typeof content !== 'string') {
    return false;
  }

  // Use the centralized error messages from constants
  const { ERROR_MESSAGES } = require('../constants');

  // Special case for combined terms
  if (content.includes('connection') && content.includes('unstable')) {
    return true;
  }

  // Check against the standard error message patterns
  return ERROR_MESSAGES.some(pattern => content.includes(pattern));
}

/**
 * Mark content as an error by adding a prefix
 * @param {string} content - Original content
 * @returns {string} Content marked as error
 */
function markErrorContent(content) {
  // Handle null/undefined
  if (!content) {
    return '';
  }

  // Check if already prefixed
  if (content.startsWith('ERROR_MESSAGE_PREFIX:')) {
    return content;
  }

  // Only add prefix to actual error content
  if (isErrorContent(content)) {
    return `ERROR_MESSAGE_PREFIX: ${content}`;
  }

  // Return normal messages unchanged
  return content;
}

/**
 * Check if a pending webhook message might be an error
 * @param {Object} options - Webhook message options
 * @returns {boolean} - True if the message appears to be an error
 */
function isErrorWebhookMessage(options) {
  // If there's no content, it can't be an error
  if (!options || !options.content) return false;

  // Allow all thread messages to pass through, regardless of content
  // This prevents the error filter from blocking @mentions in threads
  if (options.threadId || options.thread_id) {
    logger.info(
      `[ErrorUtils] Allowing potential error message in thread ${options.threadId || options.thread_id}`
    );
    return false;
  }

  // Improved error detection: check multiple patterns
  const content = options.content.toLowerCase();
  const errorIndicators = [
    'error occurred',
    'error:',
    'failed to',
    'unable to',
    'cannot ',
    'invalid',
    'exception',
    'not found',
    'denied',
    'forbidden',
    'unauthorized',
    'rate limit',
    'timeout',
    'bad request',
  ];

  // Check if content contains error indicators
  const hasErrorIndicator = errorIndicators.some(indicator => content.includes(indicator));

  // Also check for error-like formatting
  const hasErrorFormatting =
    content.startsWith('[error]') ||
    content.startsWith('error:') ||
    content.startsWith('⚠️') ||
    content.startsWith('❌');

  return hasErrorIndicator || hasErrorFormatting;
}

module.exports = {
  isErrorContent,
  markErrorContent,
  isErrorWebhookMessage,
};
