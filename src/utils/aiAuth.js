/**
 * AI Authentication Module
 * 
 * Handles authentication and client creation for AI service requests.
 * This module manages both default and user-specific AI clients with proper auth tokens.
 */

const { OpenAI } = require('openai');
const { getApiEndpoint } = require('../../config');
const logger = require('../logger');
const auth = require('../auth');
const webhookUserTracker = require('./webhookUserTracker');

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
  logger.info('[AIAuth] Default AI client initialized');
}

/**
 * Get the default AI client instance
 * @returns {OpenAI} The default AI client
 */
function getDefaultClient() {
  if (!_defaultAiClient) {
    throw new Error('[AIAuth] Default AI client not initialized. Call initAiClient() first.');
  }
  return _defaultAiClient;
}

/**
 * Create an AI client with specific authentication headers
 * @param {Object} headers - Headers to include in the client
 * @returns {OpenAI} A new OpenAI client instance
 */
function createAiClient(headers = {}) {
  return new OpenAI({
    apiKey: auth.API_KEY,
    baseURL: getApiEndpoint(),
    defaultHeaders: headers,
  });
}

/**
 * Check if authentication should be bypassed for a webhook message
 * @param {Object} context - The context object containing message information
 * @returns {boolean} True if auth should be bypassed
 */
function shouldBypassAuth(context) {
  if (context.message && context.message.webhookId) {
    return webhookUserTracker.shouldBypassNsfwVerification(context.message);
  }
  return false;
}

/**
 * Get an AI client for a specific user, using their auth token if available
 * @param {string} userId - The Discord user ID
 * @param {Object} context - Additional context (e.g., message information)
 * @returns {OpenAI|null} - An OpenAI client instance with appropriate auth, or null if no auth available
 */
function getAiClientForUser(userId, context = {}) {
  // Check if this is a webhook message that should bypass authentication
  if (shouldBypassAuth(context)) {
    logger.info(`[AIAuth] Bypassing authentication for webhook message in AI client creation`);

    // For webhook users that bypass auth, use the default client with no user-specific token
    return createAiClient({
      'X-App-ID': auth.APP_ID,
    });
  }

  // If user has a valid token, create a client with their token
  if (userId && auth.hasValidToken(userId)) {
    const userToken = auth.getUserToken(userId);
    logger.debug(`[AIAuth] Using user-specific auth token for user ${userId}`);

    // Return a client with the user's auth token
    return createAiClient({
      'X-App-ID': auth.APP_ID,
      'X-User-Auth': userToken,
    });
  }

  // SECURITY UPDATE: For unauthenticated users, we should NOT use the owner's API key
  // Instead, return null to indicate auth is required
  logger.warn(
    `[AIAuth] User ${userId || 'unknown'} is not authenticated and cannot use the AI service`
  );
  return null;
}

/**
 * Check if a user has valid authentication
 * @param {string} userId - The Discord user ID
 * @param {Object} context - Additional context
 * @returns {boolean} True if the user is authenticated or auth can be bypassed
 */
function hasValidAuth(userId, context = {}) {
  // Check bypass first
  if (shouldBypassAuth(context)) {
    return true;
  }
  
  // Check user token
  return !!(userId && auth.hasValidToken(userId));
}

module.exports = {
  initAiClient,
  getDefaultClient,
  createAiClient,
  getAiClientForUser,
  shouldBypassAuth,
  hasValidAuth,
};