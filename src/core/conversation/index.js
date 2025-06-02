/**
 * Conversation module exports
 *
 * This module provides conversation management functionality for the bot,
 * including tracking active conversations, managing auto-responses,
 * channel activations, and message history.
 */

// Export the main ConversationManager API
module.exports = require('./ConversationManager');

// Also export individual classes for testing or advanced usage
module.exports.ConversationTracker = require('./ConversationTracker');
module.exports.AutoResponder = require('./AutoResponder');
module.exports.ChannelActivation = require('./ChannelActivation');
module.exports.ConversationPersistence = require('./ConversationPersistence');
module.exports.MessageHistory = require('./MessageHistory');
