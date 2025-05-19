/**
 * PluralKit Proxy Pattern Detection
 * 
 * This module helps identify messages that might be destined for PluralKit proxying
 * based on common PluralKit trigger patterns.
 */

const logger = require('../logger');

// Common PluralKit bracket patterns
const BRACKET_PATTERNS = [
  { start: '[', end: ']' },  // [message]
  { start: '{', end: '}' },  // {message}
  { start: '<', end: '>' },  // <message>
  { start: '(', end: ')' },  // (message)
  { start: '「', end: '」' }, // 「message」 Japanese quotation marks
  { start: '『', end: '』' }, // 『message』 Japanese double quotation marks
  { start: '"', end: '"' },  // "message" quotation marks
  { start: '\'', end: '\'' } // 'message' apostrophes
];

// Common PluralKit prefix/suffix patterns
const COMMON_PREFIX_CHARS = [':', '-', '/', '\\', '~', '=', '*', '$', '#', '|', '>'];

/**
 * Check if a message appears to use PluralKit proxy patterns
 * 
 * @param {string} content - The message content to check
 * @returns {boolean} - True if the message appears to use PluralKit patterns
 */
function isPotentialProxyMessage(content) {
  if (!content || typeof content !== 'string') {
    return false;
  }
  
  const trimmedContent = content.trim();
  
  // Check for empty content
  if (trimmedContent.length === 0) {
    return false;
  }
  
  // Check for bracket patterns - message must start and end with matching brackets
  for (const pattern of BRACKET_PATTERNS) {
    if (trimmedContent.startsWith(pattern.start) && trimmedContent.endsWith(pattern.end)) {
      logger.debug(`[PluralKitPatterns] Detected bracket pattern ${pattern.start}...${pattern.end} in message`);
      return true;
    }
  }
  
  // Check for prefix patterns - look for common prefix characters after first word
  const firstSpaceIndex = trimmedContent.indexOf(' ');
  if (firstSpaceIndex > 0 && firstSpaceIndex < 20) { // Reasonable prefix length
    const possiblePrefix = trimmedContent.substring(0, firstSpaceIndex);
    
    // Check if the possible prefix ends with a common prefix character
    for (const char of COMMON_PREFIX_CHARS) {
      if (possiblePrefix.endsWith(char)) {
        logger.debug(`[PluralKitPatterns] Detected potential prefix pattern ${possiblePrefix} in message`);
        return true;
      }
    }
    
    // Special check for "pk;" prefix which is a documented PluralKit command prefix
    if (possiblePrefix.toLowerCase().startsWith('pk;')) {
      logger.debug(`[PluralKitPatterns] Detected pk; command in message`);
      return true;
    }
  }
  
  // Check for more complex PluralKit system message patterns
  if (trimmedContent.includes('pk:') || 
      trimmedContent.includes('pk!') ||
      trimmedContent.includes('pk;') ||
      trimmedContent.toLowerCase().includes('system:') || 
      trimmedContent.toLowerCase().includes('member:')) {
    logger.debug(`[PluralKitPatterns] Detected PluralKit command pattern in message`);
    return true;
  }
  
  return false;
}

/**
 * Get a reasonable delay time for waiting for PluralKit to proxy a message
 * 
 * @returns {number} - Delay in milliseconds
 */
function getProxyDelayTime() {
  // PluralKit typically takes 1-2 seconds to delete and proxy a message
  // We use a slightly longer delay to be safe
  return 2000; // 2 seconds
}

module.exports = {
  isPotentialProxyMessage,
  getProxyDelayTime
};