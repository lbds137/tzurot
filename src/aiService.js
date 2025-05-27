const { getModelPath } = require('../config');
const logger = require('./logger');
const { MARKERS, DEFAULTS } = require('./constants');
const auth = require('./auth');
const aiAuth = require('./utils/aiAuth');
const { sanitizeContent } = require('./utils/contentSanitizer');
const aiRequestManager = require('./utils/aiRequestManager');
const { formatApiMessages } = require('./utils/aiMessageFormatter');
const webhookUserTracker = require('./utils/webhookUserTracker');
const { trackError, ErrorCategory } = require('./utils/errorTracker');

// Initialize the AI client - delegates to aiAuth module
function initAiClient() {
  aiAuth.initAiClient();
}

// Get an AI client for a specific user - delegates to aiAuth module
function getAiClientForUser(userId, context = {}) {
  return aiAuth.getAiClientForUser(userId, context);
}

// Request management is now handled by aiRequestManager module


/**
 * Detects whether an AI response contains error patterns
 *
 * @param {string|null} content - The content to check for error patterns
 * @returns {boolean} - True if the content contains error patterns or is empty, false otherwise
 * @throws {TypeError} - Will not throw but handles type errors by returning true for empty content
 * @example
 * // Returns true for error patterns
 * isErrorResponse("NoneType object has no attribute");
 *
 * // Returns false for normal responses
 * isErrorResponse("Hello, I'm an AI assistant");
 *
 * // Returns true for null or empty content
 * isErrorResponse(null);
 *
 * @description
 * This function checks if the AI response contains common error patterns that
 * indicate an API issue rather than a valid response. It's used to filter out
 * error messages from being sent to users and trigger fallback responses.
 */
function isErrorResponse(content) {
  if (!content) return true;

  // Use the centralized error patterns from constants

  // A more careful approach to error detection:
  // 1. For likely direct error outputs (like NoneType, AttributeError), check for inclusion
  // 2. For more common terms that might be part of normal responses (like Error),
  //    require more context to reduce false positives

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


// Blackout key creation is now handled by aiRequestManager module
const createBlackoutKey = aiRequestManager.createBlackoutKey;

// Request header preparation is now handled by aiRequestManager module
const prepareRequestHeaders = aiRequestManager.prepareRequestHeaders;


// Blackout period checking is now handled by aiRequestManager module
const isInBlackoutPeriod = aiRequestManager.isInBlackoutPeriod;

// Adding to blackout list is now handled by aiRequestManager module
const addToBlackoutList = aiRequestManager.addToBlackoutList;

// Request ID creation is now handled by aiRequestManager module
const createRequestId = aiRequestManager.createRequestId;


// Content sanitization function moved to utils/contentSanitizer.js

/**
 * Gets a response from the AI service for the specified personality
 *
 * @async
 * @param {string} personalityName - The personality name to use for AI generation
 * @param {string} message - The user's message to respond to
 * @param {Object} [context={}] - Additional context information
 * @param {string} [context.userId] - The Discord user ID of the requester
 * @param {string} [context.channelId] - The Discord channel ID where the request originated
 * @param {Object} [context.conversationHistory] - Previous conversation history
 * @returns {Promise<string>} The AI response text or special marker for blocked responses
 * @throws {Error} Errors are caught internally and converted to user-friendly responses
 *
 * @example
 * // Basic usage
 * const response = await getAiResponse('personality-name', 'Hello, how are you?', {
 *   userId: '123456789',
 *   channelId: '987654321'
 * });
 *
 * // Handle blocked responses
 * if (response === MARKERS.HARD_BLOCKED_RESPONSE) {
 *   // Do not display anything to the user
 * } else {
 *   // Show the response to the user
 * }
 *
 * @description
 * This is the core function that handles AI interactions with sophisticated
 * error handling and request deduplication. It provides these key features:
 *
 * 1. Blackout period checking - Prevents repeated API calls for problematic combinations
 * 2. Error handling - Detects and filters error responses with custom fallbacks
 * 3. Deduplication - Prevents duplicate API calls for identical requests
 * 4. Problematic personality detection - Tracks personalities with recurring issues
 * 5. Automatic retries - Attempts to recover from temporary errors
 *
 * The function returns either a valid AI response or a special marker (HARD_BLOCKED_RESPONSE)
 * that indicates no response should be shown to the user. This happens when an error
 * occurs or when the personality+user combination is in a blackout period.
 */
async function getAiResponse(personalityName, message, context = {}) {
  // Validate input parameters first
  if (!personalityName) {
    logger.error('[AIService] Error: personalityName is required but was not provided');
    return "I'm experiencing an issue with my configuration. Please try again later.";
  }

  if (!message) {
    logger.warn('[AIService] Warning: Empty message received, using default prompt');
    message = DEFAULTS.DEFAULT_PROMPT;
  }

  // NOTE: We no longer block errors - users should always get feedback when something goes wrong
  // The blackout tracking is maintained for logging/monitoring purposes only

  // Create a unique request ID to prevent duplicate requests
  const requestId = createRequestId(personalityName, message, context);
  logger.debug(`[AIService] Created request ID: ${requestId}`);

  // Check if this exact request is already in progress
  const pendingRequest = aiRequestManager.getPendingRequest(requestId);
  if (pendingRequest) {
    // Return the existing promise to avoid duplicate API calls
    logger.info(
      `[AIService] Duplicate request detected for ${personalityName}, reusing existing promise`
    );
    return pendingRequest.promise;
  }

  // Create a promise that we'll store to prevent duplicate calls
  const responsePromise = (async () => {
    try {
      // Get the complete model path
      const modelPath = getModelPath(personalityName);

      // Set request-specific headers for user/channel identification
      const headers = prepareRequestHeaders(context);

      // SECURITY UPDATE: Check if the user is authenticated
      const userId = context.userId || null;

      // Check if this is from a webhook that should bypass authentication
      const isWebhookMessage = !!(context.message && context.message.webhookId);
      let shouldBypassAuth = false;

      if (isWebhookMessage) {
        shouldBypassAuth = webhookUserTracker.shouldBypassNsfwVerification(context.message);
        if (shouldBypassAuth) {
          logger.info(
            `[AIService] Bypassing authentication for webhook user: ${context.message.author?.username || 'unknown webhook user'}`
          );
        }
      }

      // If this is NOT a proxy system webhook that should bypass auth, check auth
      if (!shouldBypassAuth && (!userId || !auth.hasValidToken(userId))) {
        logger.warn(
          `[AIService] Unauthenticated user attempting to access AI service: ${userId || 'unknown'}`
        );
        // Return special marker for bot-level error message, not from the personality
        return `${MARKERS.BOT_ERROR_MESSAGE}⚠️ Authentication required. Please use \`!tz auth start\` to begin authentication.`;
      }


      // NORMAL AI CALL PATH: Make the API request
      logger.info(`[AIService] Using normal handling path for personality: ${personalityName}`);
      try {
        return await handleNormalPersonality(personalityName, message, context, modelPath, headers);
      } catch (apiError) {
        // Check if this is an authentication error
        if (apiError.message && apiError.message.includes('Authentication required')) {
          return `${MARKERS.BOT_ERROR_MESSAGE}⚠️ Authentication required. Please use \`!tz auth start\` to begin authentication.`;
        }

        // Add this personality+user combo to blackout list
        logger.error(
          `[AIService] API error with normal personality ${personalityName}: ${apiError.message}`
        );
        
        // Track the API error
        trackError(apiError, {
          category: ErrorCategory.AI_SERVICE,
          operation: 'handleNormalPersonality',
          metadata: {
            personalityName,
            userId: context.userId || 'unknown',
            channelId: context.channelId || 'unknown',
            errorMessage: apiError.message || 'Unknown error',
            errorCode: apiError.code || 'NO_CODE',
            modelPath: modelPath || 'unknown'
          },
          isCritical: true
        });
        
        addToBlackoutList(personalityName, context);

        // Return our special HARD_BLOCKED_RESPONSE marker
        logger.info(
          `[AIService] Returning HARD_BLOCKED_RESPONSE after API error for ${personalityName}`
        );
        return MARKERS.HARD_BLOCKED_RESPONSE;
      }
    } catch (error) {
      // Add this personality+user combo to blackout list to prevent duplicates
      logger.error(
        `[AIService] General error with personality ${personalityName}: ${error.message || 'No message'}`
      );
      logger.error(`[AIService] Error type: ${error.name || 'Unknown'}`);
      logger.error(`[AIService] Error stack: ${error.stack || 'No stack trace'}`);

      // Log the message content for debugging
      let messagePreview = 'Unknown';
      try {
        messagePreview = typeof message === 'string'
          ? message.substring(0, 100) + '...'
          : 'Complex message type: ' + JSON.stringify(message).substring(0, 200);
        logger.error(`[AIService] Message content: ${messagePreview}`);
      } catch (logError) {
        logger.error(`[AIService] Error logging message details: ${logError.message}`);
      }
      
      // Track the general error
      trackError(error, {
        category: ErrorCategory.AI_SERVICE,
        operation: 'getAiResponse',
        metadata: {
          personalityName,
          userId: context.userId || 'unknown',
          channelId: context.channelId || 'unknown',
          errorType: error.name || 'Unknown',
          messagePreview,
          hasConversationHistory: !!context.conversationHistory
        },
        isCritical: true
      });

      addToBlackoutList(personalityName, context);


      // Return our special HARD_BLOCKED_RESPONSE marker
      logger.info(
        `[AIService] Returning HARD_BLOCKED_RESPONSE after general error for ${personalityName}`
      );
      return MARKERS.HARD_BLOCKED_RESPONSE;
    } finally {
      // Clean up immediately when the request completes (success or error)
      logger.debug(
        `[AIService] Cleaning up pending request for ${personalityName} (ID: ${requestId})`
      );
      aiRequestManager.removePendingRequest(requestId);
    }
  })();

  // Store this promise in our pending requests map
  aiRequestManager.storePendingRequest(requestId, responsePromise);

  // Return the promise that will resolve to the API response
  return responsePromise;
}

// API text sanitization function moved to utils/contentSanitizer.js

// Message formatting function moved to utils/aiMessageFormatter.js

async function handleNormalPersonality(personalityName, message, context, modelPath, headers) {
  logger.info(`[AIService] Making API request for normal personality: ${personalityName}`);
  logger.debug(`[AIService] Using model path: ${modelPath}`);

  // Extract user name and proxy message flag from context if available
  const userName = context.userName || 'a user';
  const isProxyMessage = context.isProxyMessage || false;

  // Format the message content properly for the API
  const messages = formatApiMessages(message, personalityName, userName, isProxyMessage);

  // Debug log the exact messages being sent to detect issues
  if (typeof message === 'object' && message.referencedMessage) {
    // Use webhook name as fallback if personalityName is not available
    const referenceSource =
      message.referencedMessage.personalityName ||
      (message.referencedMessage.webhookName
        ? `webhook:${message.referencedMessage.webhookName}`
        : message.referencedMessage.author
          ? `user:${message.referencedMessage.author}`
          : 'unknown-source');

    logger.info(`[AIService] Sending message with reference to ${referenceSource}`);

    // Additional logging to help diagnose message content issues
    try {
      if (typeof message.messageContent === 'string') {
        logger.debug(
          `[AIService] User message (text): "${message.messageContent.substring(0, 100)}..."`
        );
      } else {
        logger.debug(
          `[AIService] User message (complex): ${JSON.stringify(message.messageContent).substring(0, 100)}...`
        );
      }
      logger.debug(
        `[AIService] Referenced message: "${message.referencedMessage.content.substring(0, 100)}..."`
      );
    } catch (logError) {
      logger.warn(`[AIService] Error logging message details: ${logError.message}`);
    }
  }

  // Get the appropriate AI client for this user
  const userId = context.userId || null;
  const aiClient = await getAiClientForUser(userId, context);

  // SECURITY UPDATE: Check if we have a valid AI client (authenticated user)
  if (!aiClient) {
    logger.error(
      `[AIService] Cannot make API request: User ${userId || 'unknown'} is not authenticated`
    );
    throw new Error('Authentication required to use this service');
  }

  const response = await aiClient.chat.completions.create({
    model: modelPath,
    messages: messages,
    temperature: 0.7,
    headers: headers,
  });

  logger.debug(`[AIService] Received response for ${personalityName}`);
  // Validate and sanitize response
  if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
    logger.error(`[AIService] Invalid response structure from ${personalityName}`);

    return 'I received an incomplete response. Please try again.';
  }

  let content = response.choices[0].message.content;
  if (typeof content !== 'string') {
    logger.error(`[AIService] Non-string content from ${personalityName}: ${typeof content}`);

    return 'I received an unusual response format. Please try again.';
  }

  // Check if the content appears to be an error before sanitization
  if (isErrorResponse(content)) {
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
      } else if (content.toLowerCase().includes('internal server error') || 
                 content.toLowerCase().includes('500')) {
        errorType = 'api_server_error';
        errorDetails = 'API service internal error';
      } else if (content.toLowerCase().includes('rate limit') || 
                 content.toLowerCase().includes('too many requests')) {
        errorType = 'rate_limit_error';
        errorDetails = 'API rate limit exceeded';
      } else if (content.toLowerCase().includes('timeout') || 
                 content.toLowerCase().includes('timed out')) {
        errorType = 'timeout_error';
        errorDetails = 'API request timed out';
      }

      // Log the error with more detailed information
      logger.error(`[AIService] Error in content from ${personalityName}: ${errorType}`);
      logger.error(`[AIService] Error details: ${errorDetails}`);
      logger.error(`[AIService] Error content sample: ${errorSample}`);
      
      // Log message context for debugging
      if (context.userId) {
        logger.error(`[AIService] Error context - User: ${context.userId}, Channel: ${context.channelId || 'DM'}`);
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
          sampleContent: errorSample.substring(0, 200)
        },
        isCritical: errorType !== 'error_in_content' && errorType !== 'empty_response'
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
          sampleContent: errorSample
        },
        isCritical: true
      });
    }

    // Check if this is the generic 'error_in_content' or a more specific error
    const isGenericError = errorType === 'error_in_content';
    
    // Determine if this error type should show a message to users
    const userFriendlyErrors = ['empty_response', 'rate_limit_error', 'timeout_error', 'api_server_error'];
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
    
    let userMessage = '';
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

  // Apply sanitization to all personality responses to be safe
  try {
    // Always perform sanitization for consistency
      logger.debug(
        `[AIService] Starting content sanitization for ${personalityName}, original length: ${content.length}`
      );

      // Apply content sanitization
      const sanitizedContent = sanitizeContent(content);
      logger.debug(
        `[AIService] After content sanitization for ${personalityName}, length: ${sanitizedContent.length}`
      );

      if (sanitizedContent.length === 0) {
        logger.error(`[AIService] Empty content after sanitization from ${personalityName}`);

        return 'I received an empty response. Please try again.';
      }

      // Replace the original content with the sanitized version
      content = sanitizedContent;
  } catch (sanitizeError) {
    logger.error(
      `[AIService] Sanitization error for ${personalityName}: ${sanitizeError.message}`
    );

    return 'I encountered an issue processing my response. Please try again.';
  }

  logger.info(
    `[AIService] Successfully generated response for ${personalityName} (${content.length} chars)`
  );
  return content;
}

module.exports = {
  getAiResponse,
  isErrorResponse,
  getAiClientForUser,
  initAiClient,

  // Export for testing
  handleNormalPersonality,
  
  // Re-export from aiRequestManager for backward compatibility
  createRequestId,
  isInBlackoutPeriod,
  addToBlackoutList,
  createBlackoutKey,
  prepareRequestHeaders,
  get pendingRequests() { return aiRequestManager.pendingRequests; },
  get errorBlackoutPeriods() { return aiRequestManager.errorBlackoutPeriods; },
  
  // Re-export from aiMessageFormatter for backward compatibility
  formatApiMessages
};
