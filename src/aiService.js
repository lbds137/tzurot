const { getModelPath, botPrefix } = require('../config');
const logger = require('./logger');
const { MARKERS, DEFAULTS } = require('./constants');
// aiAuth utility removed - using DDD authentication directly
const aiRequestManager = require('./utils/aiRequestManager');
const { formatApiMessages } = require('./utils/aiMessageFormatter');
const webhookUserTracker = require('./utils/webhookUserTracker');
const { trackError, ErrorCategory } = require('./utils/errorTracker');
const {
  isErrorResponse,
  analyzeErrorAndGenerateMessage,
  handleApiError,
} = require('./utils/aiErrorHandler');
const { getPersonalityDataService } = require('./services/PersonalityDataService');
const { createFeatureFlags } = require('./application/services/FeatureFlags');


// Check if user is authenticated using DDD system
async function isUserAuthenticated(userId) {
  if (!userId) return false;

  try {
    const { getApplicationBootstrap } = require('./application/bootstrap/ApplicationBootstrap');
    const bootstrap = getApplicationBootstrap();
    const authService = bootstrap.getApplicationServices().authenticationService;
    const status = await authService.getAuthenticationStatus(userId);
    return status.isAuthenticated;
  } catch (error) {
    logger.error('[AIService] Error checking user authentication:', error);
    return false;
  }
}

// Get an AI client for a specific user using DDD authentication
async function getAiClientForUser(userId, context = {}) {
  try {
    if (!userId) {
      logger.debug('[AIService] No userId provided, using default client');
      return null; // No user-specific auth needed
    }

    const { getApplicationBootstrap } = require('./application/bootstrap/ApplicationBootstrap');
    const bootstrap = getApplicationBootstrap();
    const authService = bootstrap.getApplicationServices().authenticationService;

    // Get user authentication status
    const authStatus = await authService.getAuthenticationStatus(userId);

    if (!authStatus.isAuthenticated || !authStatus.user?.token) {
      logger.debug(`[AIService] User ${userId} is not authenticated or has no token`);
      return null;
    }

    // Get AI client from DDD authentication system
    const client = await authService.createAIClient(userId, context);
    return client;
  } catch (error) {
    logger.error(`[AIService] Error getting AI client for user ${userId}:`, error);
    return null;
  }
}

// Request management is now handled by aiRequestManager module

// Error detection and handling is now handled by aiErrorHandler module

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
 * The function returns either a valid AI response or an error message prefixed with
 * BOT_ERROR_MESSAGE that should be displayed as a bot message rather than a webhook message.
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

  // CRITICAL: Store a placeholder immediately to prevent race conditions
  // This must happen BEFORE creating the async work
  const placeholderPromise = Promise.resolve();
  aiRequestManager.storePendingRequest(requestId, placeholderPromise);

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
      let userAuthenticated = false;
      if (!shouldBypassAuth && userId) {
        userAuthenticated = await isUserAuthenticated(userId);
      }

      if (!shouldBypassAuth && (!userId || !userAuthenticated)) {
        logger.warn(
          `[AIService] Unauthenticated user attempting to access AI service: ${userId || 'unknown'}`
        );
        // Return special marker for bot-level error message, not from the personality
        return `${MARKERS.BOT_ERROR_MESSAGE}⚠️ Authentication required. Please use \`${botPrefix} auth start\` to begin authentication.`;
      }

      // NORMAL AI CALL PATH: Make the API request
      logger.info(`[AIService] Using normal handling path for personality: ${personalityName}`);
      try {
        return await handleNormalPersonality(personalityName, message, context, modelPath, headers);
      } catch (apiError) {
        // Check if this is an authentication error
        if (apiError.message && apiError.message.includes('Authentication required')) {
          return `${MARKERS.BOT_ERROR_MESSAGE}⚠️ Authentication required. Please use \`${botPrefix} auth start\` to begin authentication.`;
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
            modelPath: modelPath || 'unknown',
          },
          isCritical: true,
        });

        addToBlackoutList(personalityName, context);

        // Return a user-friendly error message instead of blocking
        logger.info(`[AIService] Returning error message after API error for ${personalityName}`);

        // Delegate to error handler for API error messages
        const errorMessage = await handleApiError(apiError, personalityName, context);
        return { content: errorMessage, metadata: null };
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
        messagePreview =
          typeof message === 'string'
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
          hasConversationHistory: !!context.conversationHistory,
        },
        isCritical: true,
      });

      addToBlackoutList(personalityName, context);

      // Return a user-friendly error message instead of blocking
      logger.info(`[AIService] Returning error message after general error for ${personalityName}`);
      return `${MARKERS.BOT_ERROR_MESSAGE}⚠️ An unexpected error occurred. Please try again later.`;
    } finally {
      // Clean up immediately when the request completes (success or error)
      logger.debug(
        `[AIService] Cleaning up pending request for ${personalityName} (ID: ${requestId})`
      );
      aiRequestManager.removePendingRequest(requestId);
    }
  })();

  // Update the placeholder with the actual promise
  // This ensures any duplicate requests that arrive while we're setting up
  // will get the real promise instead of the placeholder
  aiRequestManager.storePendingRequest(requestId, responsePromise);

  // Return the promise that will resolve to the API response
  return responsePromise;
}


// Message formatting function moved to utils/aiMessageFormatter.js

async function handleNormalPersonality(personalityName, message, context, modelPath, headers) {
  logger.info(`[AIService] Making API request for normal personality: ${personalityName}`);
  logger.debug(`[AIService] Using model path: ${modelPath}`);

  // Extract user name and proxy message flag from context if available
  const userName = context.userName || 'a user';
  const isProxyMessage = context.isProxyMessage || false;

  // Debug logging for proxy messages
  if (isProxyMessage || context.message?.webhookId) {
    logger.info(
      `[AIService] Processing potential proxy message - userName: "${userName}", isProxyMessage: ${isProxyMessage}, webhookId: ${context.message?.webhookId}`
    );
  }

  // Format the message content properly for the API
  // Note: disableContextMetadata can be passed through context if needed
  const messages = await formatApiMessages(
    message,
    personalityName,
    userName,
    isProxyMessage,
    context.message || null,
    context.disableContextMetadata || false
  );

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

  // Check if enhanced context is enabled via feature flag
  let enhancedMessages = messages;
  const featureFlags = createFeatureFlags();

  if (featureFlags.isEnabled('features.enhanced-context')) {
    // Only use enhanced context if feature flag is enabled (for external services)
    const personalityDataService = getPersonalityDataService();

    try {
      const hasBackupData = await personalityDataService.hasBackupData(personalityName);

      if (hasBackupData) {
        logger.info(`[AIService] Using enhanced context for ${personalityName}`);

        // Build contextual prompt with personality data and conversation history
        const userMessage = messages[messages.length - 1].content;
        const contextualData = await personalityDataService.buildContextualPrompt(
          personalityName,
          userId,
          userMessage,
          { prompt: null } // Will be populated from backup data
        );

        if (contextualData.hasExtendedContext) {
          enhancedMessages = contextualData.messages;
          logger.debug(
            `[AIService] Added ${contextualData.context.history.length} history items to context`
          );
        }
      }
    } catch (contextError) {
      logger.warn(`[AIService] Error loading enhanced context: ${contextError.message}`);
      // Fall back to regular messages
    }
  } else {
    logger.debug(`[AIService] Enhanced context feature flag is disabled, using standard messages`);
  }

  const response = await aiClient.chat.completions.create({
    model: modelPath,
    messages: enhancedMessages,
    temperature: 0.7,
    headers: headers,
  });

  logger.debug(`[AIService] Received response for ${personalityName}`);
  // Validate and sanitize response
  if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
    logger.error(`[AIService] Invalid response structure from ${personalityName}`);
    // Use personality error handler for empty/invalid responses
    const errorMessage = await analyzeErrorAndGenerateMessage('', personalityName, context, addToBlackoutList);
    return { content: errorMessage, metadata: null };
  }

  let content = response.choices[0].message.content;
  if (typeof content !== 'string') {
    logger.error(`[AIService] Non-string content from ${personalityName}: ${typeof content}`);
    // Use personality error handler for non-string content
    const errorMessage = await analyzeErrorAndGenerateMessage(
      content,
      personalityName,
      context,
      addToBlackoutList
    );
    return { content: errorMessage, metadata: null };
  }

  // Check if the content appears to be an error before sanitization
  if (isErrorResponse(content)) {
    // Delegate error analysis and message generation to error handler
    const errorMessage = await analyzeErrorAndGenerateMessage(
      content,
      personalityName,
      context,
      addToBlackoutList
    );
    return { content: errorMessage, metadata: null };
  }

  // Check for empty content
  if (content.length === 0) {
    logger.error(`[AIService] Empty content received from ${personalityName}`);
    // Use personality error handler for empty content
    const errorMessage = await analyzeErrorAndGenerateMessage('', personalityName, context, addToBlackoutList);
    return { content: errorMessage, metadata: null };
  }

  // Extract metadata if available
  let metadata = null;
  if (response.usage && response.usage.metadata) {
    metadata = response.usage.metadata;
    logger.debug(`[AIService] Response metadata: ${JSON.stringify(metadata)}`);
  }

  logger.info(
    `[AIService] Successfully generated response for ${personalityName} (${content.length} chars)`
  );
  
  // Return both content and metadata
  return {
    content: content,
    metadata: metadata
  };
}

module.exports = {
  getAiResponse,
  getAiClientForUser,

  // Export for testing
  handleNormalPersonality,

  // Re-export from aiErrorHandler for backward compatibility
  isErrorResponse,

  // Re-export from aiRequestManager for backward compatibility
  createRequestId,
  isInBlackoutPeriod,
  addToBlackoutList,
  createBlackoutKey,
  prepareRequestHeaders,
  get pendingRequests() {
    return aiRequestManager.pendingRequests;
  },
  get errorBlackoutPeriods() {
    return aiRequestManager.errorBlackoutPeriods;
  },

  // Re-export from aiMessageFormatter for backward compatibility
  formatApiMessages,
};
