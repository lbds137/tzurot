/**
 * Content Sanitization Module
 *
 * Handles text sanitization for AI responses and API requests.
 * This module ensures that content can be safely displayed in Discord
 * and processed by the AI API without formatting or encoding issues.
 */

const logger = require('../logger');

/**
 * Sanitizes content by removing control characters and invalid sequences.
 * This is used for AI responses before sending to Discord.
 *
 * @param {string} content - The content to sanitize
 * @returns {string} The sanitized content
 *
 * @example
 * // Remove null bytes and control characters
 * sanitizeContent("Hello\x00World\x1F");  // Returns "HelloWorld"
 *
 * // Remove unicode escape sequences
 * sanitizeContent("Test\\u0000Message");  // Returns "TestMessage"
 *
 * @description
 * This function removes:
 * 1. Null bytes and control characters (except newlines and tabs)
 * 2. Unicode escape sequences like \\u0000
 * 3. Any non-printable characters that could cause display issues
 *
 * This function is critical for ensuring that AI responses can be safely
 * displayed in Discord without causing formatting or rendering issues.
 */
function sanitizeContent(content) {
  if (!content) return '';

  try {
    return (
      content
        // Remove null bytes and control characters, but preserve newlines and tabs
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        // Remove escape sequences
        .replace(/\\u[0-9a-fA-F]{4}/g, '')
        // Remove any non-printable characters except newlines and tabs (using safer pattern)
        // eslint-disable-next-line no-control-regex
        .replace(/[^\u0009\u000A\u000D\u0020-\u007E\u00A0-\u00FF\u0100-\uFFFF]/g, '')
        // Ensure proper string encoding
        .toString()
    );
  } catch (_error) {
    // Log sanitization errors for debugging - content input was malformed
    logger.warn(
      `[ContentSanitizer] Text sanitization failed, returning empty string. Input type: ${typeof content}, length: ${content?.length || 'N/A'}. Error: ${_error.message || 'Unknown sanitization error'}`
    );
    if (content && typeof content === 'string' && content.length > 0) {
      logger.debug(`[ContentSanitizer] Problematic content sample: ${content.substring(0, 50)}...`);
    }
    return '';
  }
}

/**
 * Sanitize text for safe inclusion in API messages.
 * This is a lighter sanitization used for user input before sending to the AI.
 *
 * @param {string} text - The text to sanitize
 * @returns {string} The sanitized text
 *
 * @description
 * This function performs minimal sanitization, only removing control characters
 * that might break API communication. It preserves most content to maintain
 * the user's original intent while ensuring safe transmission.
 */
function sanitizeApiText(text) {
  // Handle empty or null text
  if (!text) return '';

  // Just return the text with minimal sanitization
  // Only removing control characters that might actually break things
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/**
 * Checks if content needs sanitization by detecting problematic characters
 *
 * @param {string} content - The content to check
 * @returns {boolean} True if content contains characters that need sanitization
 */
function needsSanitization(content) {
  if (!content || typeof content !== 'string') return false;

  // Check for control characters
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(content)) return true;

  // Check for escape sequences
  if (/\\u[0-9a-fA-F]{4}/.test(content)) return true;

  // Check for non-printable characters
  // eslint-disable-next-line no-control-regex
  if (/[^\u0009\u000A\u000D\u0020-\u007E\u00A0-\u00FF\u0100-\uFFFF]/.test(content)) return true;

  return false;
}

/**
 * Sanitizes content and returns information about what was changed
 *
 * @param {string} content - The content to sanitize
 * @returns {Object} Object containing sanitized content and change information
 * @returns {string} .content - The sanitized content
 * @returns {boolean} .changed - Whether any changes were made
 * @returns {number} .removedChars - Number of characters removed
 */
function sanitizeWithInfo(content) {
  if (!content) {
    return { content: '', changed: false, removedChars: 0 };
  }

  const original = content;
  const sanitized = sanitizeContent(content);
  const changed = original !== sanitized;
  const removedChars = original.length - sanitized.length;

  return { content: sanitized, changed, removedChars };
}

module.exports = {
  sanitizeContent,
  sanitizeApiText,
  needsSanitization,
  sanitizeWithInfo,
};
