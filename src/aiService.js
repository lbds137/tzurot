const { OpenAI } = require('openai');
const { getApiEndpoint, getModelPath } = require('../config');
const logger = require('./logger');
const { TIME, _ERROR_PATTERNS, MARKERS, DEFAULTS } = require('./constants');
const auth = require('./auth');
const webhookUserTracker = require('./utils/webhookUserTracker');
const { getPersonality } = require('./personalityManager');

// Initialize the default AI client with API key (used when user doesn't have a token)
// We need to defer creation until after auth module is loaded
let _defaultAiClient;

/**
 * Initialize the AI client - must be called after auth module is initialized
 */
function initAiClient() {
  _defaultAiClient = new OpenAI({
    apiKey: auth.API_KEY,
    baseURL: getApiEndpoint(),
    defaultHeaders: {
      // Add any default headers here that should be sent with every request
    },
  });
  logger.info('[AIService] Default AI client initialized');
}


/**
 * Get an AI client for a specific user, using their auth token if available
 * @param {string} userId - The Discord user ID
 * @returns {OpenAI|null} - An OpenAI client instance with appropriate auth, or null if no auth available
 */
function getAiClientForUser(userId, context = {}) {
  // Check if this is a webhook message that should bypass authentication
  let shouldBypassAuth = false;
  if (context.message && context.message.webhookId) {
    shouldBypassAuth = webhookUserTracker.shouldBypassNsfwVerification(context.message);
    if (shouldBypassAuth) {
      logger.info(`[AIService] Bypassing authentication for webhook message in AI client creation`);

      // For webhook users that bypass auth, use the default client with no user-specific token
      return new OpenAI({
        apiKey: auth.API_KEY,
        baseURL: getApiEndpoint(),
        defaultHeaders: {
          'X-App-ID': auth.APP_ID,
        },
      });
    }
  }

  // If user has a valid token, create a client with their token
  if (userId && auth.hasValidToken(userId)) {
    const userToken = auth.getUserToken(userId);
    logger.debug(`[AIService] Using user-specific auth token for user ${userId}`);

    // Return a client with the user's auth token
    return new OpenAI({
      apiKey: auth.API_KEY,
      baseURL: getApiEndpoint(),
      defaultHeaders: {
        'X-App-ID': auth.APP_ID,
        'X-User-Auth': userToken,
      },
    });
  }

  // SECURITY UPDATE: For unauthenticated users, we should NOT use the owner's API key
  // Instead, return null to indicate auth is required
  logger.warn(
    `[AIService] User ${userId || 'unknown'} is not authenticated and cannot use the AI service`
  );
  return null;
}

// Track in-progress API requests to prevent duplicate processing
const pendingRequests = new Map();

// Track personality-user pairs that should be blocked from generating ANY response
// after experiencing an error - essential to prevent double messages
const errorBlackoutPeriods = new Map();

// Use the centralized constants for error blackout duration instead of defining here


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


/**
 * Create a personality-user key for blackout tracking
 *
 * @param {string} personalityName - The AI personality name
 * @param {Object} context - The context object with user and channel information
 * @param {string} [context.userId] - The Discord user ID of the requester
 * @param {string} [context.channelId] - The Discord channel ID where the request originated
 * @returns {string} A unique key in the format "{personalityName}_{userId}_{channelId}"
 *
 * @example
 * // Returns "albert-einstein_123456_789012"
 * createBlackoutKey("albert-einstein", { userId: "123456", channelId: "789012" });
 *
 * // Returns "albert-einstein_anon_789012" (with default userId)
 * createBlackoutKey("albert-einstein", { channelId: "789012" });
 *
 * // Returns "albert-einstein_123456_nochannel" (with default channelId)
 * createBlackoutKey("albert-einstein", { userId: "123456" });
 *
 * @description
 * Creates a unique key that combines personality name, user ID, and channel ID.
 * This key is used to track which personality-user-channel combinations are
 * in a blackout period due to errors. If userId or channelId are not provided,
 * fallback values (DEFAULTS.ANONYMOUS_USER and DEFAULTS.NO_CHANNEL) are used to prevent key collisions.
 */
function createBlackoutKey(personalityName, context) {
  return `${personalityName}_${context.userId || DEFAULTS.ANONYMOUS_USER}_${context.channelId || DEFAULTS.NO_CHANNEL}`;
}

/**
 * Prepare request headers for the AI API call
 *
 * @param {Object} context - The context object with user and channel information
 * @param {string} [context.userId] - The Discord user ID of the requester
 * @param {string} [context.channelId] - The Discord channel ID where the request originated
 * @returns {Object} Headers object with user and channel IDs if provided
 *
 * @example
 * // Prepare headers with both user and channel IDs
 * const headers = prepareRequestHeaders({
 *   userId: "123456789",
 *   channelId: "987654321"
 * });
 * // Returns: { "X-User-Id": "123456789", "X-Channel-Id": "987654321" }
 *
 * // Prepare headers with only userId
 * const headers = prepareRequestHeaders({ userId: "123456789" });
 * // Returns: { "X-User-Id": "123456789" }
 *
 * // Prepare headers with neither (empty object)
 * const headers = prepareRequestHeaders({});
 * // Returns: {}
 *
 * @description
 * Creates the headers object for the AI API request, adding any available
 * user and channel identification to help with request tracing and debugging.
 *
 * The function:
 * 1. Creates an empty headers object
 * 2. Adds X-User-Id header if context.userId is provided
 * 3. Adds X-Channel-Id header if context.channelId is provided
 * 4. Returns the populated headers object
 *
 * These headers enhance logging and debugging by allowing API requests
 * to be correlated with specific Discord users and channels.
 */
function prepareRequestHeaders(context) {
  const headers = {};

  // Add user/channel ID headers if provided
  if (context.userId) headers['X-User-Id'] = context.userId;
  if (context.channelId) headers['X-Channel-Id'] = context.channelId;

  return headers;
}


/**
 * Check if a personality-user combination is currently in a blackout period
 *
 * @param {string} personalityName - The AI personality name
 * @param {Object} context - The context object with user and channel information
 * @param {string} [context.userId] - The Discord user ID of the requester
 * @param {string} [context.channelId] - The Discord channel ID where the request originated
 * @returns {boolean} True if the combination is in a blackout period
 *
 * @example
 * // Check if a specific personality-user-channel combination is in blackout
 * const isBlocked = isInBlackoutPeriod("albert-einstein", {
 *   userId: "123456",
 *   channelId: "789012"
 * });
 *
 * // Returns true if the combination was added to blackout list within
 * // the last TIME.ERROR_BLACKOUT_DURATION (30 seconds)
 * if (isBlocked) {
 *   console.log("This request is blocked due to recent errors");
 * } else {
 *   console.log("This request is allowed to proceed");
 * }
 *
 * @description
 * Determines if a specific personality-user-channel combination is currently
 * in an error blackout period. A blackout period is a time window after an error
 * during which no new API requests should be made for this combination to prevent
 * duplicate error messages and improve user experience.
 *
 * The function performs these operations:
 * 1. Creates a unique key for the personality-user-channel combination
 * 2. Checks if the key exists in the errorBlackoutPeriods Map
 * 3. If it exists, compares the current time with the expiration time
 * 4. If the blackout period has expired, removes the entry from the Map
 * 5. Returns true if the combination is still in an active blackout period
 *
 * The automatic cleanup of expired entries prevents memory leaks and ensures
 * accurate tracking over time without requiring a separate cleanup process.
 */
function isInBlackoutPeriod(personalityName, context) {
  const key = createBlackoutKey(personalityName, context);
  if (errorBlackoutPeriods.has(key)) {
    const expirationTime = errorBlackoutPeriods.get(key);
    if (Date.now() < expirationTime) {
      return true;
    } else {
      // Clean up expired entry
      errorBlackoutPeriods.delete(key);
    }
  }
  return false;
}

/**
 * Add a personality-user combination to the blackout list
 *
 * @param {string} personalityName - The AI personality name
 * @param {Object} context - The context object with user and channel information
 * @param {string} [context.userId] - The Discord user ID of the requester
 * @param {string} [context.channelId] - The Discord channel ID where the request originated
 * @param {number} [duration] - Custom blackout duration in milliseconds. If not provided, defaults to TIME.ERROR_BLACKOUT_DURATION
 * @returns {void}
 *
 * @example
 * // Add a specific personality-user-channel combination to blackout list with default duration
 * addToBlackoutList("albert-einstein", { userId: "123456", channelId: "789012" });
 *
 * // Add with a custom duration of 5 minutes
 * addToBlackoutList("albert-einstein", { userId: "123456", channelId: "789012" }, 5 * 60 * 1000);
 *
 * // The combination will be blocked for the specified duration
 * // Any requests for this combination during the blackout period will be blocked
 * isInBlackoutPeriod("albert-einstein", { userId: "123456", channelId: "789012" }); // Returns true
 *
 * @description
 * Adds a personality-user-channel combination to the blackout list after an error occurs.
 * During the blackout period (defined by duration parameter or TIME.ERROR_BLACKOUT_DURATION),
 * all requests for this combination will be blocked to prevent duplicate error messages.
 *
 * This is a critical function for error prevention that helps ensure users don't see
 * multiple error messages in quick succession when a personality API call is failing.
 * The function:
 * 1. Creates a unique key for the personality-user-channel combination
 * 2. Calculates an expiration time based on current time plus blackout duration
 * 3. Stores the expiration time in the errorBlackoutPeriods Map
 */
function addToBlackoutList(personalityName, context, duration) {
  const key = createBlackoutKey(personalityName, context);
  const blackoutDuration = duration || TIME.ERROR_BLACKOUT_DURATION;
  const expirationTime = Date.now() + blackoutDuration;
  errorBlackoutPeriods.set(key, expirationTime);
}

/**
 * Create a unique request ID for tracking API requests
 *
 * @param {string} personalityName - The AI personality name
 * @param {string|Array} message - The message content or array of content objects for multimodal
 * @param {Object} context - The context object with user and channel information
 * @param {string} [context.userId] - The Discord user ID of the requester
 * @param {string} [context.channelId] - The Discord channel ID where the request originated
 * @returns {string} A unique request ID that can be used for deduplication
 *
 * @example
 * // Returns "einstein_123_456_HellohowareyouImfine"
 * createRequestId("einstein", "Hello how are you? I'm fine", {
 *   userId: "123",
 *   channelId: "456"
 * });
 *
 * // With longer message, truncates to 30 chars
 * createRequestId("einstein", "This is a very long message that will be truncated", {
 *   userId: "123",
 *   channelId: "456"
 * });
 * // Returns "einstein_123_456_Thisisaverylongmessagethatwill"
 *
 * // With multimodal content array (image)
 * createRequestId("einstein", [
 *   { type: "text", text: "What is in this image?" },
 *   { type: "image_url", image_url: { url: "https://example.com/image.jpg" }}
 * ], { userId: "123", channelId: "456" });
 *
 * // With multimodal content array (audio)
 * createRequestId("einstein", [
 *   { type: "text", text: "Please transcribe this" },
 *   { type: "audio_url", audio_url: { url: "https://example.com/audio.mp3" }}
 * ], { userId: "123", channelId: "456" });
 *
 * @description
 * Creates a unique identifier string for tracking API requests and preventing duplicate
 * calls from being processed simultaneously. The ID combines four components:
 *
 * 1. Personality name - Identifies which AI personality is being used
 * 2. User ID - From context.userId or DEFAULTS.ANONYMOUS_USER fallback
 * 3. Channel ID - From context.channelId or DEFAULTS.NO_CHANNEL fallback
 * 4. Message prefix -
 *    - For string messages: First 30 characters with spaces removed
 *    - For multimodal content arrays: Content hash based on text and media URLs (image or audio)
 *
 * This ensures that identical requests from the same user to the same personality
 * will be properly deduplicated, while different requests will have unique IDs.
 * The function is used by the request deduplication system to prevent duplicate API calls.
 */
function createRequestId(personalityName, message, context) {
  let messagePrefix;

  try {
    if (!message) {
      // Handle undefined or null message
      messagePrefix = 'empty-message';
    } else if (Array.isArray(message)) {
      // For multimodal content, create a prefix based on content
      const textContent = message.find(item => item.type === 'text')?.text || '';
      const imageUrl = message.find(item => item.type === 'image_url')?.image_url?.url || '';
      const audioUrl = message.find(item => item.type === 'audio_url')?.audio_url?.url || '';

      // Create a prefix using text and any media URLs, adding type identifiers to distinguish them
      messagePrefix = (
        textContent.substring(0, 20) +
        (imageUrl ? 'IMG-' + imageUrl.substring(0, 8) : '') +
        (audioUrl ? 'AUD-' + audioUrl.substring(0, 8) : '')
      ).replace(/\s+/g, '');
    } else if (typeof message === 'string') {
      // For regular string messages, use the first 30 chars
      messagePrefix = message.substring(0, 30).replace(/\s+/g, '');
    } else if (typeof message === 'object' && message.messageContent) {
      // Handle our special reference format
      // Process message content as before
      let contentPrefix = '';
      if (typeof message.messageContent === 'string') {
        contentPrefix = message.messageContent.substring(0, 30).replace(/\s+/g, '');
      } else if (Array.isArray(message.messageContent)) {
        // Extract text from multimodal content
        const textContent = message.messageContent.find(item => item.type === 'text')?.text || '';
        const imageUrl =
          message.messageContent.find(item => item.type === 'image_url')?.image_url?.url || '';
        const audioUrl =
          message.messageContent.find(item => item.type === 'audio_url')?.audio_url?.url || '';

        contentPrefix = (
          textContent.substring(0, 20) +
          (imageUrl ? 'IMG-' + imageUrl.substring(0, 8) : '') +
          (audioUrl ? 'AUD-' + audioUrl.substring(0, 8) : '')
        ).replace(/\s+/g, '');
      } else {
        contentPrefix = 'complex-object';
      }

      // Also check for referenced message with media
      let referencePrefix = '';
      if (message.referencedMessage && message.referencedMessage.content) {
        const refContent = message.referencedMessage.content;

        // Check for media in the referenced message
        if (refContent.includes('[Image:')) {
          const imageMatch = refContent.match(/\[Image: (https?:\/\/[^\s\]]+)\]/);
          if (imageMatch && imageMatch[1]) {
            referencePrefix += 'IMG-' + imageMatch[1].substring(0, 8);
          }
        }

        if (refContent.includes('[Audio:')) {
          const audioMatch = refContent.match(/\[Audio: (https?:\/\/[^\s\]]+)\]/);
          if (audioMatch && audioMatch[1]) {
            referencePrefix += 'AUD-' + audioMatch[1].substring(0, 8);
          }
        }
      }

      // Combine prefixes to create a unique ID that includes both content and reference info
      messagePrefix = contentPrefix + referencePrefix;
    } else {
      // Fallback for any other type
      messagePrefix = `type-${typeof message}`;
    }
  } catch (error) {
    // Log the error but continue with a safe fallback
    logger.error(`[AIService] Error creating request ID: ${error.message}`);
    logger.error(`[AIService] Message type: ${typeof message}, Array? ${Array.isArray(message)}`);
    if (message) {
      logger.error(`[AIService] Message sample: ${JSON.stringify(message).substring(0, 100)}`);
    }

    // Use a safe fallback
    messagePrefix = `fallback-${Date.now()}`;
  }

  return `${personalityName}_${context.userId || DEFAULTS.ANONYMOUS_USER}_${context.channelId || DEFAULTS.NO_CHANNEL}_${messagePrefix}`;
}


/**
 * Sanitize API response content
 *
 * @param {string} content - Raw content from API response
 * @returns {string} Sanitized content with control characters and problematic sequences removed
 * @throws {TypeError} If content is not a string or cannot be converted to a string
 * @throws {Error} If content cannot be sanitized for other reasons
 *
 * @example
 * // Returns sanitized string with control characters removed
 * sanitizeContent("Hello\x00World\x1F");  // Returns "HelloWorld"
 *
 * // Returns sanitized string with escape sequences removed
 * sanitizeContent("Test\\u0000Message");  // Returns "TestMessage"
 *
 * @description
 * Sanitizes the raw API response content by removing:
 * 1. Null bytes and control characters (while preserving newlines and tabs)
 * 2. Unicode escape sequences that might render as control characters
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
    logger.warn(`[AIService] Text sanitization failed, returning empty string. Input type: ${typeof content}, length: ${content?.length || 'N/A'}. Error: ${_error.message || 'Unknown sanitization error'}`);
    if (content && typeof content === 'string' && content.length > 0) {
      logger.debug(`[AIService] Problematic content sample: ${content.substring(0, 50)}...`);
    }
    return '';
  }
}

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

  // Check if this personality+user is in a blackout period to prevent error spam
  if (isInBlackoutPeriod(personalityName, context)) {
    // Return a special no-response marker that our bot will completely ignore
    logger.info(
      `[AIService] Personality ${personalityName} is in blackout period, returning blocked response`
    );
    return MARKERS.HARD_BLOCKED_RESPONSE;
  }

  // Create a unique request ID to prevent duplicate requests
  const requestId = createRequestId(personalityName, message, context);
  logger.debug(`[AIService] Created request ID: ${requestId}`);

  // Check if this exact request is already in progress
  if (pendingRequests.has(requestId)) {
    const { timestamp, promise } = pendingRequests.get(requestId);

    // If this request was created within the last minute, return the existing promise
    if (Date.now() - timestamp < TIME.ONE_MINUTE) {
      // Return the existing promise to avoid duplicate API calls
      logger.info(
        `[AIService] Duplicate request detected for ${personalityName}, reusing existing promise`
      );
      return promise;
    } else {
      // Timed out, clean up and proceed with a new request
      logger.info(`[AIService] Request for ${personalityName} timed out, creating new request`);
      pendingRequests.delete(requestId);
    }
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
        return `${MARKERS.BOT_ERROR_MESSAGE}⚠️ Authentication required. Please use \`!tz auth\` to set up your account before using this service.`;
      }


      // NORMAL AI CALL PATH: Make the API request
      logger.info(`[AIService] Using normal handling path for personality: ${personalityName}`);
      try {
        return await handleNormalPersonality(personalityName, message, context, modelPath, headers);
      } catch (apiError) {
        // Check if this is an authentication error
        if (apiError.message && apiError.message.includes('Authentication required')) {
          return `${MARKERS.BOT_ERROR_MESSAGE}⚠️ Authentication required. Please use \`!tz auth\` to set up your account before using this service.`;
        }

        // Add this personality+user combo to blackout list
        logger.error(
          `[AIService] API error with normal personality ${personalityName}: ${apiError.message}`
        );
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
      try {
        logger.error(
          `[AIService] Message content: ${
            typeof message === 'string'
              ? message.substring(0, 100) + '...'
              : 'Complex message type: ' + JSON.stringify(message).substring(0, 200)
          }`
        );
      } catch (logError) {
        logger.error(`[AIService] Error logging message details: ${logError.message}`);
      }

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
      pendingRequests.delete(requestId);
    }
  })();

  // Store this promise in our pending requests map
  pendingRequests.set(requestId, {
    timestamp: Date.now(),
    promise: responsePromise,
  });

  // Return the promise that will resolve to the API response
  return responsePromise;
}

/**
 * Sanitize and truncate text for safe inclusion in API messages
 * TEMPORARILY DISABLED - For testing whether role change alone fixes the issue
 * @param {string} text - The text to sanitize
 * @param {number} [maxLength=1000] - Maximum length before truncation (not used currently)
 * @returns {string} The original text with minimal sanitization
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
 * Format messages for API request, handling text, images, and referenced messages
 * @param {string|Array|Object} content - Text message, array of content objects, or complex object with reference
 * @param {string} personalityName - The name of the personality to use in media prompts
 * @param {string} [userName] - The user's formatted name (displayName + username)
 * @returns {Array} Formatted messages array for API request
 */
function formatApiMessages(content, personalityName, userName = 'a user') {
  try {
    // Check if the content is an object with a special reference format
    if (
      content &&
      typeof content === 'object' &&
      !Array.isArray(content) &&
      content.messageContent
    ) {
      // Log for debugging with user info
      logger.debug(`[AIService] Formatting message from ${userName}`);
      logger.debug(`[AIService] Formatting special reference message format`);

      // If we have a referenced message
      if (content.referencedMessage) {
        // Always use a consistent implementation without test-specific branches
        logger.debug(`[AIService] Processing referenced message`);

        // Get the name of the Discord user who is making the reference
        const userName = content.userName || 'The user';

        // Sanitize the content of the referenced message (remove control characters)
        const sanitizedReferenceContent = content.referencedMessage.content
          ? sanitizeApiText(content.referencedMessage.content)
          : '';

        logger.debug(
          `[AIService] Processing referenced message: ${JSON.stringify({
            authorType: content.referencedMessage.isFromBot ? 'bot' : 'user',
            contentPreview: sanitizedReferenceContent.substring(0, 50) || 'No content',
            referencingUser: userName,
          })}`
        );

        try {
          // Initialize cleaned reference content early for use throughout the function
          const cleanedRefContent = content.referencedMessage.content;
          
          // First, check if media URLs were provided directly (from embed extraction)
          let mediaUrl = null;
          let mediaType = null;
          
          if (content.referencedMessage.audioUrl) {
            mediaUrl = content.referencedMessage.audioUrl;
            mediaType = 'audio';
            logger.debug(`[AIService] Using provided audio URL from reference: ${mediaUrl}`);
          } else if (content.referencedMessage.imageUrl) {
            mediaUrl = content.referencedMessage.imageUrl;
            mediaType = 'image';
            logger.debug(`[AIService] Using provided image URL from reference: ${mediaUrl}`);
          } else {
            // Fallback to extracting from text content for backward compatibility
            const hasImage = sanitizedReferenceContent.includes('[Image:');
            const hasAudio = sanitizedReferenceContent.includes('[Audio:');
            
            if (hasAudio) {
              // Audio has priority over images
              const audioMatch = sanitizedReferenceContent.match(/\[Audio: (https?:\/\/[^\s\]]+)]/);
              if (audioMatch && audioMatch[1]) {
                mediaUrl = audioMatch[1];
                mediaType = 'audio';
                logger.debug(`[AIService] Found audio URL in reference text: ${mediaUrl}`);
              }
            } else if (hasImage) {
              const imageMatch = sanitizedReferenceContent.match(/\[Image: (https?:\/\/[^\s\]]+)]/);
              if (imageMatch && imageMatch[1]) {
                mediaUrl = imageMatch[1];
                mediaType = 'image';
                logger.debug(`[AIService] Found image URL in reference text: ${mediaUrl}`);
              }
            }
          }

          // Clean the referenced message content (remove media URLs and embed media references)
          let cleanContent = sanitizedReferenceContent
            .replace(/\[Image: https?:\/\/[^\s\]]+]/g, '')
            .replace(/\[Audio: https?:\/\/[^\s\]]+]/g, '')
            .replace(/\[Embed Image: https?:\/\/[^\s\]]+]/g, '')
            .replace(/\[Embed Thumbnail: https?:\/\/[^\s\]]+]/g, '')
            .trim();

          // If the content is empty after removing media URLs, add a placeholder
          if (!cleanContent && mediaUrl) {
            cleanContent = mediaType === 'image' ? '[Image]' : '[Audio Message]';
            logger.info(`[AIService] Adding media placeholder to empty reference: ${cleanContent}`);
          }

          // Get user's message content (text or multimodal)
          const userMessageContent = content.messageContent;

          // Check if user is referencing their own message (need this early for media reference text)
          const currentUserId = content.userId;
          const referencedAuthorId = content.referencedMessage.authorId;
          const currentUserName = content.userName || 'The user';
          const referencedAuthor = content.referencedMessage.author;
          // Compare by user ID if available, otherwise fall back to username comparison
          const isUserSelfReference = (currentUserId && referencedAuthorId) 
            ? currentUserId === referencedAuthorId 
            : currentUserName === referencedAuthor;

          // Create natural phrasing for referenced messages with media
          let mediaContext = '';
          if (mediaType === 'image') {
            mediaContext = isUserSelfReference ? ' (with an image I shared)' : ` (with an image)`;
            logger.debug(`[AIService] Created image reference context`);
          } else if (mediaType === 'audio') {
            mediaContext = isUserSelfReference ? ' (with audio I shared)' : ` (with audio)`;
            logger.debug(`[AIService] Created audio reference context`);
          }

          // Create natural reference text
          const authorText = isUserSelfReference ? 'I' : content.referencedMessage.author;
          const fullReferenceContent = `${authorText} said${mediaContext}:\n"${cleanContent}"`;

          // For bot messages, try to get the proper display name
          let assistantReferenceContent = '';

          if (content.referencedMessage.isFromBot) {
            // Try to get proper display name from the personality manager
            const fullName = content.referencedMessage.personalityName;
            let displayName;

            // Try to get the personality from the personality manager
            const personalityObject = fullName ? getPersonality(fullName) : null;
            if (personalityObject && personalityObject.displayName) {
              // Use display name from personality manager if available
              displayName = personalityObject.displayName;
            } else {
              // Fall back to provided display name or the personality name
              displayName = content.referencedMessage.personalityDisplayName || content.referencedMessage.displayName || fullName;
            }

            // Format name with display name and full name in parentheses, unless they're the same
            const formattedName =
              displayName && fullName && displayName !== fullName
                ? `${displayName} (${fullName})`
                : displayName || fullName || 'the bot';

            // Check if the referenced personality is the same as the current personality
            const isSamePersonality = content.referencedMessage.personalityName === personalityName;

            if (isSamePersonality) {
              // Second-person reference when user is talking to the same personality
              assistantReferenceContent = `You said${mediaContext}: "${cleanContent}"`;
            } else {
              // Third-person reference if it's a different personality
              assistantReferenceContent = `${formattedName} said${mediaContext}: "${cleanContent}"`;
            }
          }

          // When the reference is to a bot message (personality), format it as appropriate
          // For bot messages we want to use assistant role ONLY for the current personality
          // For other personalities and users, we use user role to ensure the AI can see them consistently
          let referenceDescriptor;

          if (content.referencedMessage.isFromBot) {
            // Check if it's the same personality as the one we're using now
            const isSamePersonality = content.referencedMessage.personalityName === personalityName;

            if (isSamePersonality) {
              // Use assistant role for the personality's own messages to avoid echo
              // Use cleaned content to avoid media duplication
              referenceDescriptor = {
                role: 'assistant',
                content: assistantReferenceContent || cleanedRefContent,
              };
              logger.debug(
                `[AIService] Using assistant role for reference to same personality: ${personalityName}`
              );
            } else {
              // Use user role for references to other personalities
              // Use cleaned content to avoid media duplication
              referenceDescriptor = {
                role: 'user',
                content: assistantReferenceContent || cleanedRefContent,
              };
              logger.debug(
                `[AIService] Using user role for reference to different personality: ${content.referencedMessage.personalityName}`
              );
            }
          } else {
            // Use user role for user messages
            // For user messages, create a cleaned version of the fullReferenceContent
            const cleanedFullReferenceContent = fullReferenceContent
              .replace(/\[Image: https?:\/\/[^\s\]]+\]/g, '')
              .replace(/\[Audio: https?:\/\/[^\s\]]+\]/g, '')
              .trim();
            referenceDescriptor = { role: 'user', content: cleanedFullReferenceContent };
            logger.debug(`[AIService] Using user role for reference to user message`);
          }

          // Create media message ONCE for the referenced message content (avoiding duplication)
          let mediaMessage = null;

          // Use the mediaUrl and mediaType that were already extracted earlier
          if (mediaUrl && mediaType) {
            if (mediaType === 'image') {
              mediaMessage = {
                role: 'user',
                content: [
                  { type: 'text', text: 'Please examine this image:' },
                  { type: 'image_url', image_url: { url: mediaUrl } },
                ],
              };
              logger.debug(`[AIService] Created media message for image: ${mediaUrl}`);
            } else if (mediaType === 'audio') {
              mediaMessage = {
                role: 'user',
                content: [
                  { type: 'text', text: 'Audio content:' },
                  { type: 'audio_url', audio_url: { url: mediaUrl } },
                ],
              };
              logger.debug(`[AIService] Created media message for audio: ${mediaUrl}`);
            }
          }

          // Hybrid approach: combine messages when replying to yourself, separate for different senders
          const isReplyingToSelf = currentUserName.includes(referencedAuthor);

          let messages;

          if (isReplyingToSelf) {
            // Same sender: combine into single message to avoid duplication
            const combinedContent = [];

            // Combine all text content into a single text element
            let combinedText = '';
            
            if (Array.isArray(userMessageContent)) {
              // Extract text from multimodal user content
              const userTextParts = userMessageContent
                .filter(item => item.type === 'text')
                .map(item => item.text)
                .join(' ');
              combinedText += userTextParts;
            } else {
              const sanitizedUserContent =
                typeof userMessageContent === 'string'
                  ? sanitizeApiText(userMessageContent)
                  : 'Message content missing';
              combinedText += sanitizedUserContent;
            }

            // Add reference context (with newline formatting)
            combinedText += '\n' + referenceDescriptor.content;

            // Add the combined text as first element
            combinedContent.push({
              type: 'text',
              text: combinedText
            });

            // Add user's original media content (images/audio from user's message)
            if (Array.isArray(userMessageContent)) {
              const userMediaElements = userMessageContent.filter(item => 
                item.type === 'image_url' || item.type === 'audio_url');
              combinedContent.push(...userMediaElements);
            }

            // Add referenced media content if present (just the media URL, not the prompt text)
            if (mediaMessage && Array.isArray(mediaMessage.content)) {
              const mediaElements = mediaMessage.content.filter(item => 
                item.type === 'audio_url' || item.type === 'image_url');
              combinedContent.push(...mediaElements);
            }

            // Create single combined message
            const userMessage = { role: 'user', content: combinedContent };
            messages = [userMessage];
            
            logger.debug(`[AIService] Same sender detected - combined into single message`);
          } else {
            // Different senders: combine everything into single message for better AI processing
            const combinedContent = [];

            // Combine all text content into a single text element
            let combinedText = '';
            
            if (Array.isArray(userMessageContent)) {
              // Extract text from multimodal user content
              const userTextParts = userMessageContent
                .filter(item => item.type === 'text')
                .map(item => item.text)
                .join(' ');
              combinedText += userTextParts;
            } else {
              const sanitizedUserContent =
                typeof userMessageContent === 'string'
                  ? sanitizeApiText(userMessageContent)
                  : 'Message content missing';
              combinedText += sanitizedUserContent;
            }

            // Add reference context (with newline formatting)
            combinedText += '\n' + referenceDescriptor.content;

            // Add the combined text as first element
            combinedContent.push({
              type: 'text',
              text: combinedText
            });

            // Add user's original media content (images/audio from user's message)
            if (Array.isArray(userMessageContent)) {
              const userMediaElements = userMessageContent.filter(item => 
                item.type === 'image_url' || item.type === 'audio_url');
              combinedContent.push(...userMediaElements);
            }

            // Add referenced media content if present (just the media URL, not the prompt text)
            if (mediaMessage && Array.isArray(mediaMessage.content)) {
              const mediaElements = mediaMessage.content.filter(item => 
                item.type === 'audio_url' || item.type === 'image_url');
              combinedContent.push(...mediaElements);
            }

            // Create single combined message
            const userMessage = { role: 'user', content: combinedContent };
            messages = [userMessage];
            
            logger.debug(`[AIService] Different senders detected - combined everything into single message for better AI processing`);
          }

          logger.info(`[DEBUG] Final messages being sent to AI API (count: ${messages.length}):`);
          messages.forEach((msg, index) => {
            logger.info(`[DEBUG] Message ${index + 1}: ${JSON.stringify(msg, null, 2)}`);
          });

          return messages;
        } catch (refError) {
          // If there's an error processing the reference, log it but continue
          logger.error(`[AIService] Error processing referenced message: ${refError.message}`);
          logger.error(`[AIService] Reference processing error stack: ${refError.stack}`);

          // Fall back to just sending the user's message
          const sanitizedContent =
            typeof content.messageContent === 'string'
              ? sanitizeApiText(content.messageContent)
              : Array.isArray(content.messageContent)
                ? content.messageContent
                : 'There was an error processing a referenced message.';

          return [{ role: 'user', content: sanitizedContent }];
        }
      }

      // If no reference but still using the special format, process user message normally
      if (Array.isArray(content.messageContent)) {
        return [{ role: 'user', content: content.messageContent }];
      } else {
        const sanitizedContent =
          typeof content.messageContent === 'string'
            ? sanitizeApiText(content.messageContent)
            : content.messageContent;

        return [{ role: 'user', content: sanitizedContent }];
      }
    }

    // Standard handling for non-reference formats
    if (Array.isArray(content)) {
      // Handle standard multimodal content array
      return [{ role: 'user', content }];
    }

    // Simple text message - sanitize if it's a string
    const sanitizedContent = typeof content === 'string' ? sanitizeApiText(content) : content;
    return [{ role: 'user', content: sanitizedContent }];
  } catch (formatError) {
    // Log the error for debugging
    logger.error(`[AIService] Error in formatApiMessages: ${formatError.message}`);
    logger.error(`[AIService] Format error stack: ${formatError.stack}`);

    // Fall back to a simple message
    if (typeof content === 'string') {
      return [{ role: 'user', content: sanitizeApiText(content) }];
    } else if (Array.isArray(content)) {
      return [{ role: 'user', content }];
    } else if (content && typeof content === 'object' && content.messageContent) {
      // Try to extract just the message content without references
      return [
        {
          role: 'user',
          content:
            typeof content.messageContent === 'string'
              ? sanitizeApiText(content.messageContent)
              : Array.isArray(content.messageContent)
                ? content.messageContent
                : 'There was an error formatting my message.',
        },
      ];
    }

    // Ultimate fallback for completely broken content
    return [
      { role: 'user', content: 'I wanted to reference another message but there was an error.' },
    ];
  }
}

async function handleNormalPersonality(personalityName, message, context, modelPath, headers) {
  logger.info(`[AIService] Making API request for normal personality: ${personalityName}`);
  logger.debug(`[AIService] Using model path: ${modelPath}`);

  // Extract user name from context if available
  const userName = context.userName || 'a user';

  // Format the message content properly for the API
  const messages = formatApiMessages(message, personalityName, userName);

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
  const aiClient = getAiClientForUser(userId, context);

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

    // Try to extract more specific error information by analyzing the content
    if (typeof content === 'string') {
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
      }

      // Log the error with more detailed information
      logger.error(`[AIService] Error in content from ${personalityName}: ${errorType}`);
      logger.error(`[AIService] Error details: ${errorDetails}`);
      logger.error(`[AIService] First 100 chars of content: ${content.substring(0, 100)}...`);
    } else {
      logger.error(`[AIService] Non-string error from ${personalityName}`);
      errorType = 'non_string_response';
      errorDetails = `Content type: ${typeof content}`;
    }

    // Check if this is the generic 'error_in_content' or a more specific error
    const isGenericError = errorType === 'error_in_content';

    // Add this personality+user combo to blackout list with appropriate duration
    if (!isGenericError) {
      // Add this personality+user combo to blackout list, but with a shorter duration
      // for transient errors (5 minutes instead of the default 30)
      addToBlackoutList(personalityName, context, 5 * 60 * 1000); // 5 minutes
    } else {
      // For generic errors, add a much shorter blackout period (30 seconds)
      // This prevents rapid duplicate messages but allows quick recovery
      logger.info(`[AIService] Using short blackout for generic error: ${errorType}`);
      addToBlackoutList(personalityName, context, 30 * 1000); // 30 seconds
    }

    // Return a more informative error message with an error ID
    const errorId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    return `I'm experiencing a temporary technical issue (${errorType}, Error ID: ${errorId}). Please try again in a few minutes.`;
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
  pendingRequests,
  createRequestId,
  isInBlackoutPeriod,
  addToBlackoutList,
  createBlackoutKey,
  errorBlackoutPeriods,
  getAiClientForUser,
  initAiClient,

  // Export for testing
  prepareRequestHeaders,
  handleNormalPersonality,
  sanitizeContent,
  sanitizeApiText,
  formatApiMessages,
};
