const logger = require('../logger');
const { MARKERS } = require('../constants');
const { ErrorCategory, trackError } = require('./errorTracker');
const { getPersonality } = require('../core/personality');

/**
 * AI Error Handler Module
 *
 * Handles error detection, analysis, and user-friendly message generation
 * for AI service responses. This module was extracted from aiService.js
 * to improve modularity and maintainability.
 */

/**
 * Detects whether an AI response contains error patterns
 *
 * @param {string|null} content - The content to check for error patterns
 * @returns {boolean} - True if the content contains error patterns or is empty, false otherwise
 * @example
 * // Returns true for error patterns
 * isErrorResponse("NoneType object has no attribute");
 *
 * // Returns false for normal responses
 * isErrorResponse("Hello, I'm an AI assistant");
 */
function isErrorResponse(content) {
  if (!content) return true;

  // These patterns are more definitively errors and less likely to be in normal content
  const highConfidencePatterns = [
    'NoneType',
    'AttributeError',
    'TypeError',
    'ValueError',
    'KeyError',
    'IndexError',
    'ModuleNotFoundError',
    'ImportError',
  ];

  // Check for high confidence error patterns first
  const hasHighConfidencePattern = highConfidencePatterns.some(pattern =>
    content.includes(pattern)
  );
  if (hasHighConfidencePattern) {
    return true;
  }

  // For more common terms that might appear in valid content, require more specific context
  // For example, only flag "Error:" if it's at the beginning of a line or standalone
  if (content.match(/^Error:/m) || content.match(/\nError:/m)) {
    return true;
  }

  // Only flag Traceback when it's likely part of an actual traceback message
  if (
    content.includes('Traceback') &&
    (content.includes('line') || content.includes('File') || content.includes('stack'))
  ) {
    return true;
  }

  // For "Exception", also require more specific context
  if (
    content.includes('Exception') &&
    (content.includes('raised') ||
      content.includes('caught') ||
      content.includes('thrown') ||
      content.includes('threw'))
  ) {
    return true;
  }

  // If we get here, the content doesn't match any error patterns with sufficient confidence
  return false;
}

/**
 * Analyzes error content and generates appropriate user-friendly messages
 *
 * @param {string} content - The error content to analyze
 * @param {string} personalityName - The personality that generated the error
 * @param {Object} context - Request context for logging
 * @param {Function} addToBlackoutList - Function to add to blackout tracking
 * @returns {string} - User-friendly error message
 */
function analyzeErrorAndGenerateMessage(content, personalityName, context, addToBlackoutList) {
  // Analyze error content to provide more detailed information
  let errorType = 'error_in_content';
  let errorDetails = 'Unknown error format';
  let errorSample = '';

  // Try to extract more specific error information by analyzing the content
  if (typeof content === 'string') {
    // Capture a sample of the error content for logging
    errorSample = content ? content.substring(0, 500) : 'Empty content';

    // Look for specific error patterns
    if (content.includes('NoneType') || content.includes('AttributeError')) {
      errorType = 'attribute_error';
      errorDetails = 'Missing attribute or null reference';
    } else if (content.includes('TypeError')) {
      errorType = 'type_error';
      errorDetails = 'Type mismatch or incompatible types';
    } else if (content.includes('ValueError')) {
      errorType = 'value_error';
      errorDetails = 'Invalid value or argument';
    } else if (content.includes('KeyError')) {
      errorType = 'key_error';
      errorDetails = 'Missing dictionary key';
    } else if (content.includes('IndexError')) {
      errorType = 'index_error';
      errorDetails = 'Index out of bounds';
    } else if (content.includes('Traceback')) {
      errorType = 'exception';
      // Extract the first line of the traceback to get more details
      const lines = content.split('\n');
      errorDetails = lines.length > 1 ? lines[1].trim() : 'Exception with traceback';
    } else if (!content || content.trim() === '') {
      errorType = 'empty_response';
      errorDetails = 'API returned empty or null content';
    } else if (
      content.toLowerCase().includes('internal server error') ||
      content.toLowerCase().includes('500')
    ) {
      errorType = 'api_server_error';
      errorDetails = 'API service internal error';
    } else if (
      content.toLowerCase().includes('rate limit') ||
      content.toLowerCase().includes('too many requests')
    ) {
      errorType = 'rate_limit_error';
      errorDetails = 'API rate limit exceeded';
    } else if (
      content.toLowerCase().includes('timeout') ||
      content.toLowerCase().includes('timed out')
    ) {
      errorType = 'timeout_error';
      errorDetails = 'API request timed out';
    }

    // Log the error with more detailed information
    logger.error(`[AIService] Error in content from ${personalityName}: ${errorType}`);
    logger.error(`[AIService] Error details: ${errorDetails}`);
    logger.error(`[AIService] Error content sample: ${errorSample}`);

    // Log message context for debugging
    if (context.userId) {
      logger.error(
        `[AIService] Error context - User: ${context.userId}, Channel: ${context.channelId || 'DM'}`
      );
    }

    // Track the error for pattern analysis
    const errorObj = new Error(`API content error: ${errorDetails}`);
    trackError(errorObj, {
      category: ErrorCategory.API_CONTENT,
      operation: 'getAiResponse',
      metadata: {
        personalityName,
        errorType,
        errorDetails,
        userId: context.userId || 'unknown',
        channelId: context.channelId || 'unknown',
        contentLength: content ? content.length : 0,
        sampleContent: errorSample.substring(0, 200),
      },
      isCritical: errorType !== 'error_in_content' && errorType !== 'empty_response',
    });
  } else {
    logger.error(`[AIService] Non-string error from ${personalityName}`);
    errorType = 'non_string_response';
    errorDetails = `Content type: ${typeof content}`;
    if (content !== null && content !== undefined) {
      errorSample = JSON.stringify(content).substring(0, 200);
      logger.error(`[AIService] Non-string content sample: ${errorSample}`);
    }

    // Track non-string response errors
    const errorObj = new Error(`Non-string API response: ${errorDetails}`);
    trackError(errorObj, {
      category: ErrorCategory.API_CONTENT,
      operation: 'getAiResponse',
      metadata: {
        personalityName,
        errorType,
        errorDetails,
        userId: context.userId || 'unknown',
        channelId: context.channelId || 'unknown',
        contentType: typeof content,
        sampleContent: errorSample,
      },
      isCritical: true,
    });
  }

  // Check if this is the generic 'error_in_content' or a more specific error
  const isGenericError = errorType === 'error_in_content';

  // Determine if this error type should show a message to users
  const userFriendlyErrors = [
    'empty_response',
    'rate_limit_error',
    'timeout_error',
    'api_server_error',
  ];
  const isUserFriendlyError = userFriendlyErrors.includes(errorType);

  // Track errors for monitoring purposes only - we no longer block any errors
  // Users should always receive feedback when something goes wrong
  if (isUserFriendlyError) {
    logger.info(`[AIService] Tracking user-friendly error for monitoring: ${errorType}`);
    // Track with short duration for rate monitoring
    addToBlackoutList(personalityName, context, 30 * 1000); // 30 seconds
  } else if (!isGenericError) {
    logger.info(`[AIService] Tracking technical error for monitoring: ${errorType}`);
    // Track technical errors for longer to identify persistent issues
    addToBlackoutList(personalityName, context, 5 * 60 * 1000); // 5 minutes
  } else {
    logger.info(`[AIService] Tracking generic error for monitoring: ${errorType}`);
    addToBlackoutList(personalityName, context, 60 * 1000); // 1 minute
  }

  // Return user-friendly error messages based on error type
  // IMPORTANT: ALL errors now show messages to users - no silent failures
  const errorId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);

  // Try to get personality-specific error message
  let userMessage = '';
  let personality = null;

  try {
    personality = getPersonality(personalityName);
    if (personality && personality.errorMessage) {
      logger.info(
        `[AIErrorHandler] Using personality-specific error message for ${personalityName}`
      );
      userMessage = personality.errorMessage;

      // Check if the error message already has the error marker pattern
      if (userMessage.includes('||*(an error has occurred)*||')) {
        // Replace with reference ID
        userMessage = userMessage.replace(
          '||*(an error has occurred)*||',
          `||*(an error has occurred; reference: ${errorId})*||`
        );
      } else if (userMessage.includes('||*') && userMessage.includes('*||')) {
        // If there's another spoiler pattern, insert reference before the closing
        userMessage = userMessage.replace(
          /\|\|\*\(([^)]+)\)\*\|\|/,
          `||*($1; reference: ${errorId})*||`
        );
      } else {
        // No existing pattern, append our own
        userMessage += ` ||*(an error has occurred; reference: ${errorId})*||`;
      }

      return userMessage;
    }
  } catch (err) {
    logger.debug(`[AIErrorHandler] Could not fetch personality data: ${err.message}`);
  }

  // Fall back to default error messages
  switch (errorType) {
    case 'empty_response':
      userMessage = `Hmm, I couldn't generate a response. Could you try rephrasing your message?`;
      break;
    case 'api_server_error':
      userMessage = `The ${process.env.SERVICE_ID} AI service seems to be having issues right now. Please try again in a moment!`;
      break;
    case 'rate_limit_error':
      userMessage = `I'm getting too many requests right now. Please wait a minute and try again.`;
      break;
    case 'timeout_error':
      userMessage = `My response took too long to generate. Let's try again with a simpler request.`;
      break;
    case 'attribute_error':
    case 'type_error':
    case 'value_error':
    case 'key_error':
    case 'index_error':
      userMessage = `I encountered a processing error. This personality might need maintenance. Please try again or contact support.`;
      break;
    case 'exception':
      userMessage = `Something unexpected happened while generating my response. Please try again or use a different personality.`;
      break;
    default:
      userMessage = `I couldn't process that request due to a technical error. Please try again or contact support if this persists.`;
  }

  // Add error reference for support purposes (avoiding filtered terms)
  userMessage += ` ||(Reference: ${errorId})||`;

  return userMessage;
}

/**
 * Handles API errors and generates appropriate user messages
 *
 * @param {Error} apiError - The API error object
 * @param {string} personalityName - The personality name
 * @param {Object} context - Request context
 * @returns {string} - User-friendly error message with BOT_ERROR_MESSAGE marker
 */
function handleApiError(apiError, personalityName, context) {
  // Check for specific error types
  if (apiError.status === 404) {
    return `${MARKERS.BOT_ERROR_MESSAGE}⚠️ I couldn't find the personality "${personalityName}". The personality might not be available on the server.`;
  } else if (apiError.status === 429) {
    return `${MARKERS.BOT_ERROR_MESSAGE}⚠️ Rate limit exceeded. Please try again in a moment.`;
  } else if (apiError.status === 500 || apiError.status === 502 || apiError.status === 503) {
    return `${MARKERS.BOT_ERROR_MESSAGE}⚠️ The AI service is temporarily unavailable. Please try again later.`;
  } else {
    return `${MARKERS.BOT_ERROR_MESSAGE}⚠️ An error occurred while processing your request. Please try again later.`;
  }
}

module.exports = {
  isErrorResponse,
  analyzeErrorAndGenerateMessage,
  handleApiError,
};
