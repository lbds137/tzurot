const logger = require('../../logger');

/**
 * MessageHistory - Manages message history and personality lookups
 *
 * This module provides functionality to find personalities based on message IDs
 * and webhook usernames, supporting legacy formats and fallback mechanisms.
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
   * @returns {string|null} The personality name or null if not found
   */
  getPersonalityFromMessage(messageId, options = {}) {
    logger.debug(`[MessageHistory] Searching for personality for message ID: ${messageId}`);

    // First, try to get from conversation tracker
    const conversationData = this.conversationTracker.getConversationByMessageId(messageId);

    if (conversationData) {
      return conversationData.personalityName;
    }

    // If not found and webhook username is provided, try fallback
    if (options.webhookUsername) {
      return this._getPersonalityFromWebhookUsername(options.webhookUsername);
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
  _getPersonalityFromWebhookUsername(webhookUsername) {
    logger.debug(
      `[MessageHistory] Attempting to identify personality by webhook username: "${webhookUsername}"`
    );

    try {
      // Import personality manager to get list of personalities
      // This is a circular dependency, so we import it lazily
      const { getAllPersonalities } = require('../../core/personality');
      const allPersonalities = getAllPersonalities();

      if (!allPersonalities || !Array.isArray(allPersonalities)) {
        logger.error(
          `[MessageHistory] getAllPersonalities returned invalid data: ${JSON.stringify(allPersonalities)}`
        );
        return null;
      }

      logger.debug(
        `[MessageHistory] Checking ${allPersonalities.length} personalities for match with: ${webhookUsername}`
      );

      // Helper function to safely get lowercase version of a string
      const safeToLowerCase = str => {
        if (!str) return '';
        return String(str).toLowerCase();
      };
      
      // Extract the base name from webhook username (before the pipe character)
      let webhookBaseName = webhookUsername;
      const pipeIndex = webhookUsername.indexOf('|');
      if (pipeIndex > 0) {
        webhookBaseName = webhookUsername.substring(0, pipeIndex).trim();
        logger.debug(
          `[MessageHistory] Extracted base name from webhook: "${webhookBaseName}" (from "${webhookUsername}")`
        );
      }
      const webhookBaseNameLower = safeToLowerCase(webhookBaseName);

      // Look for exact match first
      for (const personality of allPersonalities) {
        if (!personality) continue;

        // Try exact match with full webhook username
        if (personality.displayName && personality.displayName === webhookUsername) {
          logger.debug(
            `[MessageHistory] Found personality match by display name: ${personality.fullName}`
          );
          return personality.fullName;
        }
        
        // Try match with extracted base name (before pipe)
        if (personality.displayName && personality.displayName === webhookBaseName) {
          logger.debug(
            `[MessageHistory] Found personality match by extracted base name: ${personality.fullName}`
          );
          return personality.fullName;
        }
      }

      // Try case-insensitive match
      const webhookUsernameLower = safeToLowerCase(webhookUsername);
      for (const personality of allPersonalities) {
        if (!personality || !personality.displayName) continue;

        const displayNameLower = safeToLowerCase(personality.displayName);

        // Exact match with full username (case-insensitive)
        if (displayNameLower === webhookUsernameLower) {
          logger.debug(
            `[MessageHistory] Found personality match by case-insensitive display name: ${personality.fullName}`
          );
          return personality.fullName;
        }
        
        // Match with extracted base name (case-insensitive)
        if (displayNameLower === webhookBaseNameLower) {
          logger.debug(
            `[MessageHistory] Found personality match by case-insensitive base name: ${personality.fullName}`
          );
          return personality.fullName;
        }

        // Check if it matches our webhook naming pattern: "DisplayName | suffix"
        const webhookPattern = new RegExp(
          `^${personality.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|`,
          'i'
        );
        if (webhookPattern.test(webhookUsername)) {
          logger.debug(
            `[MessageHistory] Found personality match by webhook naming pattern: ${personality.fullName}`
          );
          return personality.fullName;
        }
      }

      logger.debug(
        `[MessageHistory] No personality found matching webhook username: "${webhookUsername}"`
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
