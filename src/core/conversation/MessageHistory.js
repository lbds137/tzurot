const logger = require('../../logger');

/**
 * MessageHistory - Manages message history and personality lookups
 *
 * This module provides functionality to find personalities based on message IDs
 * and webhook usernames.
 */
class MessageHistory {
  constructor(conversationTracker) {
    this.conversationTracker = conversationTracker;
  }

  /**
   * Get personality from a message ID
   * @param {string} messageId - Discord message ID
   * @param {Object} [options] - Additional options
   * @param {string} [options.webhookUsername] - Username of the webhook for fallback detection
   * @returns {Promise<string|null>} The personality name or null if not found
   */
  async getPersonalityFromMessage(messageId, options = {}) {
    logger.debug(`[MessageHistory] Searching for personality for message ID: ${messageId}`);

    // First, try to get from conversation tracker
    const conversationData = this.conversationTracker.getConversationByMessageId(messageId);

    if (conversationData) {
      return conversationData.personalityName;
    }

    // If not found and webhook username is provided, try fallback
    if (options.webhookUsername) {
      return await this._getPersonalityFromWebhookUsername(options.webhookUsername);
    }

    logger.debug(`[MessageHistory] No personality found for message ID: ${messageId}`);
    return null;
  }

  /**
   * Try to identify personality from webhook username
   * @private
   * @param {string} webhookUsername - The webhook's username
   * @returns {string|null} The personality name or null if not found
   */
  async _getPersonalityFromWebhookUsername(webhookUsername) {
    logger.debug(
      `[MessageHistory] Attempting to identify personality by webhook username: "${webhookUsername}"`
    );

    try {
      // Use DDD system to get personalities
      const {
        getApplicationBootstrap,
      } = require('../../application/bootstrap/ApplicationBootstrap');
      const bootstrap = getApplicationBootstrap();
      const service = bootstrap.getPersonalityApplicationService();

      logger.debug('[MessageHistory] Using DDD system to lookup personalities');

      // Extract the base name from webhook username (before the pipe character)
      let webhookBaseName = webhookUsername;
      const pipeIndex = webhookUsername.indexOf('|');
      if (pipeIndex > 0) {
        webhookBaseName = webhookUsername.substring(0, pipeIndex).trim();
        logger.debug(
          `[MessageHistory] Extracted base name from webhook: "${webhookBaseName}" (from "${webhookUsername}")`
        );
      }

      // Try different variations to find the personality
      // The service.getPersonality method in DDD should handle both names and aliases
      const variations = [
        webhookUsername, // Full webhook name
        webhookBaseName, // Base name without suffix
        webhookBaseName.toLowerCase(), // Lowercase base name (most likely to be an alias)
        webhookUsername.toLowerCase(), // Lowercase full name
      ];

      for (const variation of variations) {
        const personality = await service.getPersonality(variation);
        if (personality) {
          logger.debug(
            `[MessageHistory] Found personality match through DDD service for "${variation}": ${personality.fullName}`
          );
          return personality.fullName;
        }
      }

      logger.debug(
        '[MessageHistory] No match found through DDD service after trying all variations'
      );
      return null;
    } catch (error) {
      logger.error(
        `[MessageHistory] Error looking up personality by webhook username: ${error.message}`
      );
      return null;
    }
  }
}

module.exports = MessageHistory;
