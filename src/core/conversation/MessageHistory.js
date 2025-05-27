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
    logger.debug(`[MessageHistory] Attempting to identify personality by webhook username: "${webhookUsername}"`);
    
    try {
      // Import personality manager to get list of personalities
      // This is a circular dependency, so we import it lazily
      const { listPersonalitiesForUser } = require('../../personalityManager');
      const allPersonalities = listPersonalitiesForUser();
      
      if (!allPersonalities || !Array.isArray(allPersonalities)) {
        logger.error(`[MessageHistory] listPersonalitiesForUser returned invalid data: ${JSON.stringify(allPersonalities)}`);
        return null;
      }
      
      logger.debug(`[MessageHistory] Checking ${allPersonalities.length} personalities for match with: ${webhookUsername}`);
      
      // Helper function to safely get lowercase version of a string
      const safeToLowerCase = str => {
        if (!str) return '';
        return String(str).toLowerCase();
      };
      
      // Look for exact match first
      for (const personality of allPersonalities) {
        if (!personality) continue;
        
        if (personality.displayName && personality.displayName === webhookUsername) {
          logger.debug(`[MessageHistory] Found personality match by display name: ${personality.fullName}`);
          return personality.fullName;
        }
      }
      
      // Try case-insensitive match
      const webhookUsernameLower = safeToLowerCase(webhookUsername);
      for (const personality of allPersonalities) {
        if (!personality || !personality.displayName) continue;
        
        const displayNameLower = safeToLowerCase(personality.displayName);
        
        // Exact match (case-insensitive)
        if (displayNameLower === webhookUsernameLower) {
          logger.debug(`[MessageHistory] Found personality match by case-insensitive display name: ${personality.fullName}`);
          return personality.fullName;
        }
        
        // Check if it matches our webhook naming pattern: "DisplayName | suffix"
        const webhookPattern = new RegExp(`^${personality.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|`, 'i');
        if (webhookPattern.test(webhookUsername)) {
          logger.debug(`[MessageHistory] Found personality match by webhook naming pattern: ${personality.fullName}`);
          return personality.fullName;
        }
      }
      
      logger.debug(`[MessageHistory] No personality found matching webhook username: "${webhookUsername}"`);
      return null;
      
    } catch (error) {
      logger.error(`[MessageHistory] Error looking up personality by webhook username: ${error.message}`);
      return null;
    }
  }
}

module.exports = MessageHistory;