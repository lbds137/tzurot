/**
 * AI Service Authentication
 *
 * This file now serves as a backward-compatible wrapper around the new
 * AIClientFactory in core/authentication/
 */

const logger = require('../logger');

// Lazy-loaded dependencies
let authManager = null;

/**
 * Get the auth manager instance
 * @returns {Object} The auth manager
 */
function getAuthManager() {
  if (!authManager) {
    throw new Error('Auth manager not initialized. Call initAiClient() with authManager first.');
  }
  return authManager;
}

/**
 * Initialize the default AI client
 * @param {Object} authManagerInstance - The auth manager instance
 * @returns {Promise<void>}
 */
async function initAI(authManagerInstance) {
  if (!authManagerInstance) {
    throw new Error('Auth manager instance is required');
  }
  authManager = authManagerInstance;
  logger.info('[AIAuth] AI client initialized with auth manager');
}

/**
 * Get the default AI client
 * @returns {Object} The default OpenAI client
 */
function getAI() {
  const manager = getAuthManager();
  if (!manager) {
    throw new Error('Auth system not initialized. Call initAuth() first.');
  }
  return manager.aiClientFactory.getDefaultClient();
}

/**
 * Get an AI client for a specific user/context
 * @param {Object} options - Options for client creation
 * @param {string} options.userId - Discord user ID
 * @param {boolean} options.isWebhook - Whether this is for webhook usage
 * @returns {Promise<Object>} The configured OpenAI client
 */
async function getAIForUser({ userId, isWebhook = false }) {
  const manager = getAuthManager();
  if (!manager) {
    throw new Error('Auth system not initialized. Call initAuth() first.');
  }

  try {
    const client = await manager.getAIClient({ userId, isWebhook });
    logger.debug(`[AIAuth] Got AI client for user ${userId} (webhook: ${isWebhook})`);
    return client;
  } catch (error) {
    logger.error(`[AIAuth] Failed to get AI client for user ${userId}:`, error);
    // Fall back to default client
    return manager.aiClientFactory.getDefaultClient();
  }
}

/**
 * Legacy method name for backward compatibility
 * @param {string} userId - Discord user ID
 * @param {Object} context - Context object with isWebhook flag
 * @returns {Promise<Object>} The configured OpenAI client
 */
async function getAiClientForUser(userId, context = {}) {
  return getAIForUser({ userId, isWebhook: context.isWebhook });
}

module.exports = {
  initAI,
  initAiClient: initAI, // Legacy alias
  getAI,
  getAIForUser,
  getAiClientForUser, // Legacy method
};
