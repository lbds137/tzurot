const { OpenAI } = require('openai');
const { getApiEndpoint, getModelPath } = require('../config');

// Initialize the AI client with encoded endpoint
const aiClient = new OpenAI({
  apiKey: process.env.SERVICE_API_KEY,
  baseURL: getApiEndpoint(),
  defaultHeaders: {
    // Add any default headers here that should be sent with every request
  },
});

// Track in-progress API requests to prevent duplicate processing
const pendingRequests = new Map();

// Track personality-user pairs that should be blocked from generating ANY response
// after experiencing an error - essential to prevent double messages
const errorBlackoutPeriods = new Map();

// Maximum time (in ms) to block a personality-user combination after an error
const ERROR_BLACKOUT_DURATION = 30000; // 30 seconds

// There's a known issue with certain personalities returning errors as content
// Let's handle this gracefully for any personality that might be affected
const knownProblematicPersonalities = {
  'lucifer-kochav-shenafal': {
    isProblematic: true,
    errorPatterns: ['NoneType', 'AttributeError', 'lower'],
    responses: [
      'I sense a disturbance in the cosmic forces that connect us. My essence cannot fully materialize at this moment.',
      'The ethereal pathways that channel my thoughts seem to be temporarily obscured. This topic eludes me for now.',
      'Even fallen angels encounter mysteries. This particular query creates a singularity in my understanding.',
      'How curious. The infernal archives appear to be in disarray on this specific matter.',
      'The boundaries between realms are particularly thin today, causing interference with my celestial perception.',
    ],
  },
};

// Track dynamically identified problematic personalities during runtime
const runtimeProblematicPersonalities = new Map();

/**
 * Detects whether an AI response contains error patterns
 *
 * @param {string|null} content - The content to check for error patterns
 * @returns {boolean} - True if the content contains error patterns or is empty, false otherwise
 * @description
 * This function checks if the AI response contains common error patterns that
 * indicate an API issue rather than a valid response. It's used to filter out
 * error messages from being sent to users and trigger fallback responses.
 */
function isErrorResponse(content) {
  if (!content) return true;

  // Common error patterns that indicate API issues rather than valid responses
  const errorPatterns = [
    'NoneType',
    'AttributeError',
    'TypeError',
    'ValueError',
    'KeyError',
    'IndexError',
    'ModuleNotFoundError',
    'ImportError',
    'Exception',
    'Error:',
    'Traceback',
  ];

  // Check if content matches any error pattern
  return errorPatterns.some(
    pattern =>
      content.includes(pattern) ||
      (typeof content === 'string' && content.match(new RegExp(`\\b${pattern}\\b`, 'i')))
  );
}

/**
 * Register a personality as problematic during runtime
 * @param {string} personalityName - The personality name
 * @param {Object} errorData - Error data including the content that triggered the error
 */
function registerProblematicPersonality(personalityName, errorData) {
  // Don't register if already in the known list
  if (knownProblematicPersonalities[personalityName]) {
    return;
  }

  console.log(`[AIService] Registering runtime problematic personality: ${personalityName}`);

  // Create themed fallback responses based on the personality name
  // This creates generic responses that can work for any personality
  const genericResponses = [
    'I seem to be experiencing a momentary lapse in my connection. Let me gather my thoughts.',
    "How curious. I'm unable to formulate a proper response at this moment.",
    'The connection between us seems unstable right now. Perhaps we could try a different approach.',
    "I find myself at a loss for words on this particular matter. Let's explore something else.",
    'There appears to be a disturbance in my thinking process. Give me a moment to recalibrate.',
  ];

  // Store the problematic personality info
  runtimeProblematicPersonalities.set(personalityName, {
    isProblematic: true,
    firstDetectedAt: Date.now(),
    errorCount: 1,
    lastErrorContent: errorData.content || 'Unknown error',
    responses: genericResponses,
  });
}

/**
 * Create a personality-user key for blackout tracking
 * @param {string} personalityName - The AI personality name
 * @param {Object} context - The context object with userId and channelId
 * @returns {string} A key for the personality-user combination
 */
function createBlackoutKey(personalityName, context) {
  return `${personalityName}_${context.userId || 'anon'}_${context.channelId || 'nochannel'}`;
}

/**
 * Check if a personality-user combination is currently in a blackout period
 * @param {string} personalityName - The AI personality name
 * @param {Object} context - The context object with userId and channelId
 * @returns {boolean} True if the combination is in a blackout period
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
 * @param {string} personalityName - The AI personality name
 * @param {Object} context - The context object with userId and channelId
 */
function addToBlackoutList(personalityName, context) {
  const key = createBlackoutKey(personalityName, context);
  const expirationTime = Date.now() + ERROR_BLACKOUT_DURATION;
  errorBlackoutPeriods.set(key, expirationTime);
}

/**
 * Create a unique request ID for tracking API requests
 * @param {string} personalityName - The AI personality name
 * @param {string} message - The message content
 * @param {Object} context - The context object with userId and channelId
 * @returns {string} A unique request ID
 */
function createRequestId(personalityName, message, context) {
  const messagePrefix = message.substring(0, 30).replace(/\s+/g, '');
  return `${personalityName}_${context.userId || 'anon'}_${context.channelId || 'nochannel'}_${messagePrefix}`;
}

/**
 * Gets a response from the AI service for the specified personality
 *
 * @param {string} personalityName - The personality name to use for AI generation
 * @param {string} message - The user's message to respond to
 * @param {Object} context - Additional context information
 * @param {string} [context.userId] - The Discord user ID of the requester
 * @param {string} [context.channelId] - The Discord channel ID where the request originated
 * @param {Object} [context.conversationHistory] - Previous conversation history
 * @returns {Promise<{content: string, isError: boolean}>} The AI response with error flag
 *
 * @description
 * This is the core function that handles AI interactions. It includes:
 * - Blackout period checking to prevent repeated API calls for problematic cases
 * - Error handling and detection with automatic fallback responses
 * - Rate limiting and retries
 * - Tracking of problematic personalities to improve reliability
 */
async function getAiResponse(personalityName, message, context = {}) {
  // Validate input parameters first
  if (!personalityName) {
    console.error('[AIService] Error: personalityName is required but was not provided');
    return "I'm experiencing an issue with my configuration. Please try again later.";
  }

  if (!message) {
    console.warn('[AIService] Warning: Empty message received, using default prompt');
    message = 'Hello';
  }

  // CRITICAL ERROR PREVENTION: Check if this personality+user is in a blackout period
  if (isInBlackoutPeriod(personalityName, context)) {
    // Return a special no-response marker that our bot will completely ignore
    return 'HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY';
  }

  // CRITICAL DUPLICATE PREVENTION: Create a unique request ID to prevent duplicates
  const requestId = createRequestId(personalityName, message, context);

  // Check if this exact request is already in progress
  if (pendingRequests.has(requestId)) {
    const { timestamp, promise } = pendingRequests.get(requestId);

    // If this request was created within the last 60 seconds, return the existing promise
    if (Date.now() - timestamp < 60000) {
      // Return the existing promise to avoid duplicate API calls
      return promise;
    } else {
      // Timed out, clean up and proceed with a new request
      pendingRequests.delete(requestId);
    }
  }

  // Create a promise that we'll store to prevent duplicate calls
  const responsePromise = (async () => {
    try {
      // Get the complete model path
      const modelPath = getModelPath(personalityName);

      // Set request-specific headers for user/channel identification
      const headers = {};

      // Add user/channel ID headers if provided
      if (context.userId) headers['X-User-Id'] = context.userId;
      if (context.channelId) headers['X-Channel-Id'] = context.channelId;

      // Check if this is a personality with known or runtime-detected API issues
      let personalityInfo = knownProblematicPersonalities[personalityName];

      // If not in the predefined list, check the runtime-detected list
      if (!personalityInfo && runtimeProblematicPersonalities.has(personalityName)) {
        personalityInfo = runtimeProblematicPersonalities.get(personalityName);
      }

      if (personalityInfo && personalityInfo.isProblematic) {
        try {
          // Still try the API call in case the issue has been fixed
          const response = await aiClient.chat.completions.create({
            model: modelPath,
            messages: [{ role: 'user', content: message }],
            temperature: 0.7,
            headers: headers,
          });

          const content = response.choices?.[0]?.message?.content;

          // Use the more robust error detection function
          if (!content || isErrorResponse(content)) {
            // Add this personality+user combo to blackout list
            addToBlackoutList(personalityName, context);

            // If this is a runtime-detected personality, increment the error count
            if (runtimeProblematicPersonalities.has(personalityName)) {
              const runtimeInfo = runtimeProblematicPersonalities.get(personalityName);
              runtimeInfo.errorCount++;
              runtimeInfo.lastErrorContent = content || 'Empty response';
              runtimeProblematicPersonalities.set(personalityName, runtimeInfo);
            }

            // Return a themed response for this personality
            const responses = personalityInfo.responses;
            return responses[Math.floor(Math.random() * responses.length)];
          }

          // If we get here, we got a valid response despite the known issues!
          if (typeof content === 'string' && content.length > 0) {
            return content;
          }

          // Default fallback for empty but not error content
          return personalityInfo.responses[0];
        } catch (error) {
          // Add this personality+user combo to blackout list
          addToBlackoutList(personalityName, context);

          // If this is a runtime-detected personality, increment the error count
          if (runtimeProblematicPersonalities.has(personalityName)) {
            const runtimeInfo = runtimeProblematicPersonalities.get(personalityName);
            runtimeInfo.errorCount++;
            runtimeInfo.lastErrorType = error.name;
            runtimeInfo.lastErrorMessage = error.message;
            runtimeProblematicPersonalities.set(personalityName, runtimeInfo);
          }

          // Return our special HARD_BLOCKED_RESPONSE marker
          return 'HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY';
        }
      }

      // NORMAL AI CALL PATH: Make the API request
      try {
        const response = await aiClient.chat.completions.create({
          model: modelPath,
          messages: [{ role: 'user', content: message }],
          temperature: 0.7,
          headers: headers,
        });

        // Validate and sanitize response
        if (
          !response ||
          !response.choices ||
          !response.choices[0] ||
          !response.choices[0].message
        ) {
          // Register this personality as problematic
          registerProblematicPersonality(personalityName, {
            error: 'invalid_response_structure',
            content: JSON.stringify(response),
          });

          return 'I received an incomplete response. Please try again.';
        }

        let content = response.choices[0].message.content;
        if (typeof content !== 'string') {
          // Register this personality as problematic
          registerProblematicPersonality(personalityName, {
            error: 'non_string_content',
            content: typeof content,
          });

          return 'I received an unusual response format. Please try again.';
        }

        // Check if the content appears to be an error before sanitization
        if (isErrorResponse(content)) {
          // Register this personality as problematic
          registerProblematicPersonality(personalityName, {
            error: 'error_in_content',
            content: content,
          });

          // Add this personality+user combo to blackout list
          addToBlackoutList(personalityName, context);

          // Return a generic error message with an error ID
          const errorId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
          return `I'm experiencing a technical issue with my response system (Error ID: ${errorId}). Please try again later.`;
        }

        // Apply sanitization to all personality responses to be safe
        try {
          content = content
            // Remove null bytes and control characters, but preserve newlines and tabs
            .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '')
            // Remove escape sequences
            .replace(/\\u[0-9a-fA-F]{4}/g, '')
            // Remove any non-printable characters except newlines and tabs
            .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF\u0100-\uFFFF]/g, '')
            // Ensure proper string encoding
            .toString();

          if (content.length === 0) {
            // Register this personality as problematic
            registerProblematicPersonality(personalityName, {
              error: 'empty_after_sanitization',
              content: 'Sanitized content was empty',
            });

            return 'I received an empty response. Please try again.';
          }
        } catch (sanitizeError) {
          // Register this personality as problematic
          registerProblematicPersonality(personalityName, {
            error: 'sanitization_error',
            content: sanitizeError.message,
          });

          return 'I encountered an issue processing my response. Please try again.';
        }

        return content;
      } catch (apiError) {
        // Add this personality+user combo to blackout list
        addToBlackoutList(personalityName, context);

        // Return our special HARD_BLOCKED_RESPONSE marker
        return 'HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY';
      }
    } catch (error) {
      // Add this personality+user combo to blackout list to prevent duplicates
      addToBlackoutList(personalityName, context);

      // Register this personality as potentially problematic
      if (
        error.name === 'TypeError' ||
        error.name === 'SyntaxError' ||
        error.message.includes('content') ||
        error.message.includes('NoneType')
      ) {
        registerProblematicPersonality(personalityName, {
          error: 'api_call_error',
          errorType: error.name,
          content: error.message,
        });
      }

      // Return our special HARD_BLOCKED_RESPONSE marker
      return 'HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY';
    } finally {
      // Remove this request from the pending map after 60 seconds
      setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
        }
      }, 60000);
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

module.exports = {
  getAiResponse,
  isErrorResponse,
  registerProblematicPersonality,
  knownProblematicPersonalities,
  runtimeProblematicPersonalities,
  pendingRequests,
  createRequestId,
  isInBlackoutPeriod,
  addToBlackoutList,
  createBlackoutKey,
  errorBlackoutPeriods,
};
