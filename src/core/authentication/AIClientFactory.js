/**
 * AIClientFactory - Creates and manages AI service clients
 *
 * Handles:
 * - Creating OpenAI clients with appropriate authentication
 * - User-specific client creation
 * - Webhook bypass authentication
 * - Default client management
 */

const { OpenAI } = require('openai');
const logger = require('../../logger');

class AIClientFactory {
  constructor(serviceApiKey, serviceApiBaseUrl) {
    this.serviceApiKey = serviceApiKey;
    this.serviceApiBaseUrl = serviceApiBaseUrl;
    this.defaultClient = null;
    this.userClients = new Map(); // Cache user-specific clients
    
  }

  /**
   * Initialize the factory and create default client
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Create default client with service API key
      this.defaultClient = new OpenAI({
        apiKey: this.serviceApiKey,
        baseURL: this.serviceApiBaseUrl,
      });

      logger.info('[AIClientFactory] Initialized default AI client');
    } catch (error) {
      logger.error('[AIClientFactory] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Get the default AI client
   * @returns {Object} The default OpenAI client
   */
  getDefaultClient() {
    if (!this.defaultClient) {
      throw new Error('AIClientFactory not initialized. Call initialize() first.');
    }
    return this.defaultClient;
  }

  /**
   * Create an AI client for a specific user
   * @param {string} userId - The Discord user ID
   * @param {string} userToken - The user's auth token
   * @param {boolean} isWebhook - Whether this is for a webhook request
   * @returns {Promise<Object>} The configured OpenAI client
   */
  async createUserClient(userId, userToken, isWebhook = false) {
    try {
      // Check cache first
      const cacheKey = `${userId}-${isWebhook}`;
      if (this.userClients.has(cacheKey)) {
        logger.debug(`[AIClientFactory] Returning cached client for user ${userId}`);
        return this.userClients.get(cacheKey);
      }

      // Build headers based on authentication type
      const headers = {};
      
      if (userToken) {
        headers['X-User-Auth'] = userToken;
        logger.debug(`[AIClientFactory] Creating client with user token for ${userId}`);
      }

      if (isWebhook) {
        headers['Tzurot-Webhook-Bypass'] = 'true';
        logger.debug(`[AIClientFactory] Adding webhook bypass header for ${userId}`);
      }

      // Create new client with appropriate headers
      const client = new OpenAI({
        apiKey: this.serviceApiKey,
        baseURL: this.serviceApiBaseUrl,
        defaultHeaders: headers,
      });

      // Cache the client for reuse
      this.userClients.set(cacheKey, client);
      
      logger.info(`[AIClientFactory] Created new AI client for user ${userId} (webhook: ${isWebhook})`);
      return client;
    } catch (error) {
      logger.error(`[AIClientFactory] Failed to create user client for ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get or create an AI client based on authentication context
   * @param {Object} options - Client options
   * @param {string} options.userId - The Discord user ID
   * @param {string} options.userToken - The user's auth token (optional)
   * @param {boolean} options.isWebhook - Whether this is for a webhook request
   * @param {boolean} options.useDefault - Force use of default client
   * @returns {Promise<Object>} The appropriate OpenAI client
   */
  async getClient({ userId, userToken, isWebhook = false, useDefault = false }) {
    // Use default client if requested or no user context
    if (useDefault || (!userId && !userToken && !isWebhook)) {
      return this.getDefaultClient();
    }

    // Create user-specific client
    return this.createUserClient(userId, userToken, isWebhook);
  }

  /**
   * Clear cached client for a user
   * @param {string} userId - The Discord user ID
   */
  clearUserClient(userId) {
    // Clear both webhook and non-webhook versions
    this.userClients.delete(`${userId}-true`);
    this.userClients.delete(`${userId}-false`);
    logger.debug(`[AIClientFactory] Cleared cached clients for user ${userId}`);
  }

  /**
   * Clear all cached clients
   */
  clearAllClients() {
    this.userClients.clear();
    logger.info(`[AIClientFactory] Cleared all cached clients`);
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return {
      cachedClients: this.userClients.size,
      hasDefaultClient: !!this.defaultClient,
    };
  }
}

module.exports = AIClientFactory;